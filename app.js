// Simple local portfolio app (no external APIs)

const STORAGE_KEYS = {
  holdings: "portfolio_holdings_v1",
  usdJpy: "portfolio_usdjpy_v1",
  settings: "portfolio_settings_v1",
};

const defaultFx = 150.0;
const currencyFmtJPY = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });
const currencyFmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** @typedef {{ id:string, market:'US'|'JP', symbol:string, name?:string, shares:number, price:number, avgCost?:number }} Holding */

/** @type {Holding[]} */
let holdings = [];
let usdJpy = defaultFx;
let settings = {
  autoFetchOnLoad: true,
  intervalMinutes: 60,
  lastPricesAt: null,
  lastFxAt: null,
};

// Elements
const usdJpyInput = document.getElementById("usdJpyInput");
const saveFxBtn = document.getElementById("saveFxBtn");
const resetDataBtn = document.getElementById("resetDataBtn");

const autoFetchChk = document.getElementById("autoFetchChk");
const intervalInput = document.getElementById("intervalInput");
const refreshNowBtn = document.getElementById("refreshNowBtn");
const lastPricesAtEl = document.getElementById("lastPricesAt");
const lastFxAtEl = document.getElementById("lastFxAt");

const addForm = document.getElementById("addForm");
const holdingsTable = document.getElementById("holdingsTable");
const tbody = holdingsTable.querySelector("tbody");
const totalUsJpyEl = document.getElementById("totalUsJpy");
const totalJpJpyEl = document.getElementById("totalJpJpy");
const totalAllJpyEl = document.getElementById("totalAllJpy");

const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");

// Add form elements for auto price
const addMarketSel = addForm.querySelector('select[name="market"]');
const addSymbolInput = addForm.querySelector('input[name="symbol"]');
const addNameInput = addForm.querySelector('input[name="name"]');
const addSharesInput = addForm.querySelector('input[name="shares"]');
const addPricePreview = document.getElementById('addPricePreview');
const addValuePreview = document.getElementById('addValuePreview');
const fetchAddPriceBtn = document.getElementById('fetchAddPriceBtn');
let addDraftPrice = NaN;
let addNameTouched = false;
addNameInput.addEventListener('input', () => { addNameTouched = true; });

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function loadState() {
  try {
    const fxStr = localStorage.getItem(STORAGE_KEYS.usdJpy);
    if (fxStr) usdJpy = parseFloat(fxStr);

    const raw = localStorage.getItem(STORAGE_KEYS.holdings);
    if (raw) {
      /** @type {Holding[]} */
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) holdings = parsed;
    }

    const settingsStr = localStorage.getItem(STORAGE_KEYS.settings);
    if (settingsStr) {
      const parsed = JSON.parse(settingsStr);
      settings = { ...settings, ...(parsed || {}) };
    }
  } catch (e) {
    console.warn("Failed to load state:", e);
  }

  // If empty, provide a small sample to get started (can be deleted by user)
  if (holdings.length === 0) {
    holdings = [
      { id: uid(), market: "US", symbol: "AAPL", name: "Apple", shares: 10, price: 180.0 },
      { id: uid(), market: "US", symbol: "MSFT", name: "Microsoft", shares: 5, price: 420.0 },
      { id: uid(), market: "JP", symbol: "7203", name: "トヨタ自動車", shares: 20, price: 3200 },
    ];
  }
  // Upgrade existing holdings to include avgCost
  for (const h of holdings) {
    if (typeof h.avgCost !== 'number' || !isFinite(h.avgCost)) h.avgCost = 0;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEYS.usdJpy, String(usdJpy));
  localStorage.setItem(STORAGE_KEYS.holdings, JSON.stringify(holdings));
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function formatPrice(market, price) {
  return market === "US" ? currencyFmtUSD.format(price) : currencyFmtJPY.format(price);
}

function calcValueJpy(h) {
  if (h.market === "US") return h.shares * h.price * usdJpy;
  return h.shares * h.price; // JP is already JPY
}

function calcPlJpy(h) {
  const avg = Number(h.avgCost || 0);
  if (!isFinite(avg)) return 0;
  if (h.market === "US") return (h.price - avg) * h.shares * usdJpy;
  return (h.price - avg) * h.shares;
}

function render() {
  usdJpyInput.value = String(usdJpy);
  autoFetchChk.checked = !!settings.autoFetchOnLoad;
  intervalInput.value = String(settings.intervalMinutes);
  lastPricesAtEl.textContent = settings.lastPricesAt ? formatDateTime(settings.lastPricesAt) : "-";
  lastFxAtEl.textContent = settings.lastFxAt ? formatDateTime(settings.lastFxAt) : "-";

  tbody.innerHTML = "";
  let totalUS = 0;
  let totalJP = 0;

  for (const h of holdings) {
    const tr = document.createElement("tr");

    const marketTd = document.createElement("td");
    marketTd.textContent = h.market === "US" ? "米国" : "日本";
    tr.appendChild(marketTd);

    const symbolTd = document.createElement("td");
    symbolTd.textContent = h.symbol;
    tr.appendChild(symbolTd);

    const nameTd = document.createElement("td");
    nameTd.textContent = h.name || "";
    tr.appendChild(nameTd);

    const sharesTd = document.createElement("td");
    sharesTd.className = "num";
    const sharesInput = document.createElement("input");
    sharesInput.type = "number";
    sharesInput.className = "inline-input";
    sharesInput.step = "0.0001";
    sharesInput.min = "0";
    sharesInput.value = String(h.shares);
    sharesInput.addEventListener("change", () => {
      h.shares = clampNum(parseFloat(sharesInput.value), 0);
      saveState();
      render();
    });
    sharesTd.appendChild(sharesInput);
    tr.appendChild(sharesTd);

    // Avg cost (manual input per share, local currency)
    const avgTd = document.createElement("td");
    avgTd.className = "num";
    const avgWrap = document.createElement("div");
    avgWrap.style.display = "flex";
    avgWrap.style.justifyContent = "flex-end";
    avgWrap.style.gap = "8px";
    const avgInput = document.createElement("input");
    avgInput.type = "number";
    avgInput.className = "inline-input";
    avgInput.step = "0.0001";
    avgInput.min = "0";
    avgInput.value = String(Number(h.avgCost || 0));
    avgInput.addEventListener("change", () => {
      h.avgCost = clampNum(parseFloat(avgInput.value), 0);
      saveState();
      // no full rerender needed but keep consistent
      render();
    });
    const avgUnit = document.createElement("span");
    avgUnit.className = "chip";
    avgUnit.textContent = h.market === "US" ? "USD" : "JPY";
    avgWrap.appendChild(avgInput);
    avgWrap.appendChild(avgUnit);
    avgTd.appendChild(avgWrap);
    tr.appendChild(avgTd);

    const priceTd = document.createElement("td");
    priceTd.className = "num";
    const priceWrap = document.createElement("div");
    priceWrap.style.display = "flex";
    priceWrap.style.justifyContent = "flex-end";
    priceWrap.style.gap = "8px";

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.className = "inline-input";
    priceInput.step = "0.0001";
    priceInput.min = "0";
    priceInput.value = String(h.price);
    priceInput.addEventListener("change", () => {
      h.price = clampNum(parseFloat(priceInput.value), 0);
      saveState();
      render();
    });

    const unit = document.createElement("span");
    unit.className = "chip";
    unit.textContent = h.market === "US" ? "USD" : "JPY";

    priceWrap.appendChild(priceInput);
    priceWrap.appendChild(unit);
    priceTd.appendChild(priceWrap);
    tr.appendChild(priceTd);

    const valTd = document.createElement("td");
    valTd.className = "num";
    const valueJpy = calcValueJpy(h);
    valTd.textContent = currencyFmtJPY.format(valueJpy);
    tr.appendChild(valTd);

    const plTd = document.createElement("td");
    plTd.className = "num";
    const avgForPl = Number(h.avgCost || 0);
    if (avgForPl > 0) {
      const plJpy = calcPlJpy(h);
      plTd.textContent = currencyFmtJPY.format(plJpy);
    } else {
      plTd.textContent = "-";
    }
    tr.appendChild(plTd);

    if (h.market === "US") totalUS += valueJpy; else totalJP += valueJpy;

    const delTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn-danger";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => {
      holdings = holdings.filter(x => x.id !== h.id);
      saveState();
      render();
    });
    delTd.appendChild(delBtn);
    tr.appendChild(delTd);

    tbody.appendChild(tr);
  }

  totalUsJpyEl.textContent = currencyFmtJPY.format(totalUS);
  totalJpJpyEl.textContent = currencyFmtJPY.format(totalJP);
  totalAllJpyEl.textContent = currencyFmtJPY.format(totalUS + totalJP);

  // refresh add-form previews as state may change (usdJpy etc)
  if (typeof updateAddFormPreviews === 'function') {
    try { updateAddFormPreviews(); } catch {}
  }
}

function clampNum(n, min = 0) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
}

function upgradeHoldingsSchema() {
  for (const h of holdings) {
    if (typeof h.avgCost !== 'number' || !isFinite(h.avgCost)) h.avgCost = 0;
  }
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return "-";
  }
}

// Data sources
const FX_URLS = [
  () => `https://api.exchangerate.host/latest?base=USD&symbols=JPY`,
  () => `https://open.er-api.com/v6/latest/USD`,
];

function buildCorsCandidates(url) {
  return [
    url,
    `https://r.jina.ai/${url}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
}

const FETCH_TIMEOUT_MS = 8000;
async function fetchWithCors(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const candidates = buildCorsCandidates(url);
  let lastErr;
  for (const u of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(u, { ...(options || {}), signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr || new Error("fetch failed");
}

function normalizeStooqSymbol(symbol, market) {
  const s = String(symbol || "").trim().toLowerCase();
  if (!s) return null;
  // If user already provided suffix, honor it. Also map common aliases.
  if (s.includes(".")) {
    if (s.endsWith(".t")) return s.replace(/\.t$/, ".jp");
    if (s.endsWith(".tyo")) return s.replace(/\.tyo$/, ".jp");
    return s;
  }
  return market === "JP" ? `${s}.jp` : `${s}.us`;
}

function mapToStooqSymbol(h) {
  return normalizeStooqSymbol(h.symbol, h.market);
}

function normalizeYahooSymbol(symbol, market) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!s) return null;
  if (s.includes(".")) return s; // respect given suffix like 3350.T or AAPL
  return market === "JP" ? `${s}.T` : s;
}

function mapToYahooSymbol(h) {
  return normalizeYahooSymbol(h.symbol, h.market);
}

async function fetchUsdJpy() {
  for (const buildUrl of FX_URLS) {
    try {
      const res = await fetchWithCors(buildUrl());
      if (!res.ok) throw new Error("FX http error " + res.status);
      const data = await res.json();
      const rate = (data && data.rates && (typeof data.rates.JPY === "number" ? data.rates.JPY : parseFloat(data.rates.JPY))) || null;
      if (rate != null && isFinite(rate)) {
        usdJpy = rate;
        settings.lastFxAt = new Date().toISOString();
        saveState();
        return rate;
      }
    } catch (e) {
      console.warn("FX fetch failed, trying next source", e);
      continue;
    }
  }
  throw new Error("FX fetch failed");
}

async function fetchStooqQuotes(uniqueSymbols) {
  if (uniqueSymbols.length === 0) return new Map();
  const sParam = uniqueSymbols.join(",");
  const url = `https://stooq.com/q/l/?s=${sParam}&f=sd2t2ohlcvn&h&e=csv`;
  const res = await fetchWithCors(url);
  if (!res.ok) throw new Error("quotes http error " + res.status);
  const text = await res.text();
  const rows = parseCSV(text);
  // Expect header row followed by rows
  const header = rows.shift() || [];
  const idx = Object.fromEntries(header.map((k, i) => [k.toLowerCase(), i]));
  const map = new Map();
  for (const r of rows) {
    if (!r || r.length === 0) continue;
    const symbol = r[idx.symbol] || r[0];
    const closeStr = r[idx.close] ?? r[idx.c] ?? r[6];
    const name = r[idx.name] ?? "";
    const price = Number(closeStr);
    if (symbol && isFinite(price)) {
      map.set(String(symbol).toLowerCase(), { price, name });
    }
  }
  return map;
}

async function fetchYahooQuotes(symbols) {
  if (!symbols || symbols.length === 0) return new Map();
  const unique = Array.from(new Set(symbols.map(s => String(s).toUpperCase())));
  const map = new Map();
  // Try v7 batch endpoint first
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(unique.join(","))}`;
    const res = await fetchWithCors(url);
    const maybeJson = await res.text();
    let data;
    try { data = JSON.parse(maybeJson); } catch {
      const idx = maybeJson.indexOf('{');
      if (idx >= 0) data = JSON.parse(maybeJson.slice(idx));
    }
    const results = (data && data.quoteResponse && Array.isArray(data.quoteResponse.result)) ? data.quoteResponse.result : [];
    for (const it of results) {
      const key = String(it.symbol || "").toUpperCase();
      const name = it.shortName || it.longName || it.displayName || "";
      const candidates = [it.regularMarketPrice, it.regularMarketPreviousClose, it.postMarketPrice, it.preMarketPrice, it.bid, it.ask];
      const price = candidates.find(v => typeof v === 'number' && isFinite(v));
      if (key && price != null && isFinite(price)) {
        map.set(key, { price: Number(price), name });
      }
    }
  } catch (e) {
    console.warn('yahoo v7 fetch failed', e);
  }
  // Fallback per-symbol via v8 chart (works better via CORS proxies)
  const need = unique.filter(s => !map.has(s));
  for (const s of need) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1d`;
      const res = await fetchWithCors(url);
      const text = await res.text();
      let json = text;
      const marker = 'Markdown Content:';
      const idx = json.indexOf(marker);
      if (idx >= 0) json = json.slice(idx + marker.length).trim();
      const data = JSON.parse(json);
      const r0 = data?.chart?.result?.[0];
      const meta = r0?.meta || {};
      const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : r0?.indicators?.quote?.[0]?.close?.[0];
      const name = meta.shortName || meta.longName || '';
      if (price != null && isFinite(price)) {
        map.set(s, { price: Number(price), name });
      }
    } catch (e) {
      console.warn('yahoo v8 fetch failed for', s, e);
    }
  }
  return map;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.map(line => {
    // Simple CSV parser sufficient for stooq format
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; continue; }
        if (ch === '"') { inQ = false; continue; }
        cur += ch;
      } else {
        if (ch === '"') { inQ = true; continue; }
        if (ch === ',') { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  });
}

// Helpers for Add form auto price
function stooqSymbolFor(market, symbol) {
  return normalizeStooqSymbol(symbol, market);
}

async function fetchSingleQuote(market, symbol) {
  const sy = normalizeYahooSymbol(symbol, market);
  const ss = normalizeStooqSymbol(symbol, market);
  // Try Yahoo first for better freshness
  try {
    if (sy) {
      const ymap = await fetchYahooQuotes([sy]);
      const yq = ymap.get(String(sy).toUpperCase());
      if (yq && isFinite(yq.price)) return yq;
    }
  } catch {}
  try {
    if (ss) {
      const smap = await fetchStooqQuotes([ss]);
      const sq = smap.get(String(ss).toLowerCase());
      if (sq && isFinite(sq.price)) return sq;
    }
  } catch {}
  return null;
}

let addPriceFailed = false;
function updateAddFormPreviews() {
  const market = addMarketSel.value === 'JP' ? 'JP' : 'US';
  const shares = clampNum(parseFloat(addSharesInput.value), 0);
  if (addPriceFailed) {
    addPricePreview.textContent = '取得失敗';
  } else if (isFinite(addDraftPrice)) {
    addPricePreview.textContent = market === 'US' ? `${currencyFmtUSD.format(addDraftPrice)} (USD)` : `${currencyFmtJPY.format(addDraftPrice)}`;
  } else {
    addPricePreview.textContent = '-';
  }
  if (isFinite(addDraftPrice) && shares > 0) {
    const valJpy = market === 'US' ? addDraftPrice * shares * usdJpy : addDraftPrice * shares;
    addValuePreview.textContent = currencyFmtJPY.format(valJpy);
  } else {
    addValuePreview.textContent = '-';
  }
}

async function updatePricesAndFx() {
  const stooqSymbols = Array.from(new Set(holdings.map(mapToStooqSymbol).filter(Boolean)));
  const yahooSymbols = Array.from(new Set(holdings.map(mapToYahooSymbol).filter(Boolean)));
  try {
    const [stooqMap, yahooMap] = await Promise.all([
      fetchStooqQuotes(stooqSymbols).catch(e => { console.warn('stooq error', e); return new Map(); }),
      fetchYahooQuotes(yahooSymbols).catch(e => { console.warn('yahoo error', e); return new Map(); }),
      // FX in parallel (non-blocking of price applying)
      fetchUsdJpy().catch(e => console.warn("FX fetch error", e)),
    ]).then((arr) => [arr[0], arr[1]]);

    let changed = false;
    for (const h of holdings) {
      const keyS = mapToStooqSymbol(h);
      const keyY = mapToYahooSymbol(h);
      const qy = keyY ? yahooMap.get(String(keyY).toUpperCase()) : null;
      const qs = keyS ? stooqMap.get(String(keyS).toLowerCase()) : null;
      const q = qy || qs;
      if (q && isFinite(q.price)) {
        if ((h.name == null || h.name === "") && q.name && typeof q.name === "string") {
          h.name = q.name;
        }
        if (h.price !== q.price) { h.price = q.price; changed = true; }
      }
    }
    settings.lastPricesAt = new Date().toISOString();
    if (changed) saveState(); else localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    render();
  } catch (e) {
    console.warn("Price fetch failed", e);
    settings.lastPricesAt = "取得に失敗";
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
    render();
  }
}

// Event wiring
saveFxBtn.addEventListener("click", () => {
  const v = parseFloat(usdJpyInput.value);
  usdJpy = clampNum(v, 0);
  saveState();
  render();
});

resetDataBtn.addEventListener("click", () => {
  if (!confirm("ローカルのデータを初期化しますか？（元に戻せません）")) return;
  localStorage.removeItem(STORAGE_KEYS.holdings);
  localStorage.removeItem(STORAGE_KEYS.usdJpy);
  holdings = [];
  usdJpy = defaultFx;
  loadState();
  saveState();
  render();
});

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(addForm);
  const market = String(form.get("market"));
  const symbol = String(form.get("symbol")).trim();
  const name = String(form.get("name") || "").trim();
  const shares = clampNum(parseFloat(String(form.get("shares"))), 0);

  if (!symbol) return;

  // Ensure price fetched
  if (!Number.isFinite(addDraftPrice)) {
    try {
      const q = await fetchSingleQuote(market === 'JP' ? 'JP' : 'US', symbol);
      if (q && isFinite(q.price)) {
        addDraftPrice = q.price;
        if (!name && q.name && typeof q.name === 'string') addNameInput.value = q.name;
      }
    } catch {}
  }
  if (!Number.isFinite(addDraftPrice)) {
    // no price, abort
    updateAddFormPreviews();
    return;
  }

  /** @type {Holding} */
  const holding = { id: uid(), market: market === "JP" ? "JP" : "US", symbol, name: addNameInput.value.trim() || name, shares, price: addDraftPrice };
  holdings.push(holding);
  saveState();
  addForm.reset();
  addDraftPrice = NaN;
  updateAddFormPreviews();
  render();
});

exportBtn.addEventListener("click", () => {
  const payload = {
    usdJpy,
    holdings,
    exportedAt: new Date().toISOString(),
    note: "Local portfolio export v1",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data.usdJpy === "number") usdJpy = data.usdJpy;
    if (Array.isArray(data.holdings)) holdings = data.holdings.filter(Boolean);
    upgradeHoldingsSchema();
    saveState();
    render();
  } catch (e) {
    alert("JSONの読み込みに失敗しました");
    console.error(e);
  } finally {
    importInput.value = "";
  }
});

autoFetchChk.addEventListener("change", () => {
  settings.autoFetchOnLoad = !!autoFetchChk.checked;
  saveState();
});

intervalInput.addEventListener("change", () => {
  const mins = Math.max(1, Math.floor(parseFloat(intervalInput.value) || settings.intervalMinutes));
  settings.intervalMinutes = mins;
  intervalInput.value = String(mins);
  saveState();
  setupInterval();
});

refreshNowBtn.addEventListener("click", () => {
  updatePricesAndFx();
});

async function refreshAddPrice() {
  const market = addMarketSel.value === 'JP' ? 'JP' : 'US';
  const symbol = addSymbolInput.value.trim();
  if (!symbol) { addDraftPrice = NaN; addPriceFailed = false; updateAddFormPreviews(); return; }
  try {
    addPricePreview.textContent = '取得中...';
    addPriceFailed = false;
    const q = await fetchSingleQuote(market, symbol);
    if (q && isFinite(q.price)) {
      addDraftPrice = q.price;
      if ((!addNameTouched || !addNameInput.value) && q.name && typeof q.name === 'string') addNameInput.value = q.name;
    } else {
      addDraftPrice = NaN;
      addPriceFailed = true;
    }
  } catch (e) {
    console.warn('add price fetch failed', e);
    addDraftPrice = NaN;
    addPriceFailed = true;
  } finally {
    updateAddFormPreviews();
  }
}

fetchAddPriceBtn.addEventListener('click', () => { refreshAddPrice(); });
addSymbolInput.addEventListener('change', () => { addNameTouched = false; refreshAddPrice(); });
addMarketSel.addEventListener('change', () => { addNameTouched = false; refreshAddPrice(); });
addSharesInput.addEventListener('input', () => { updateAddFormPreviews(); });

let intervalHandle = null;
function setupInterval() {
  if (intervalHandle) clearInterval(intervalHandle);
  const ms = Math.max(1, settings.intervalMinutes) * 60 * 1000;
  intervalHandle = setInterval(() => {
    updatePricesAndFx();
  }, ms);
}

// Init
loadState();
saveState();
render();

if (settings.autoFetchOnLoad) {
  // kick off fetch (non-blocking)
  updatePricesAndFx();
}
setupInterval();
