import express from 'express';
import helmet from 'helmet';
import Database from 'better-sqlite3';
import { z } from 'zod';
import crypto from 'node:crypto';

const app=express();
const db=new Database(process.env.DB_PATH||'trip.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS trips(id TEXT PRIMARY KEY, share_token TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'100kb'}));

const payloadSchema=z.object({schedule:z.object({start:z.string(),end:z.string(),budget:z.enum(['save','standard','reward'])}),participants:z.array(z.object({id:z.string(),name:z.string().max(40),weights:z.record(z.number()),ratings:z.record(z.number()),veto:z.record(z.boolean()).optional(),must:z.record(z.boolean()).optional()})).min(1).max(12),locked:z.string().nullable().optional()});
const writeSchema=z.object({token:z.string().min(20).optional(),payload:payloadSchema});

app.get('/health',(_req,res)=>res.json({ok:true}));
app.post('/api/trips',(req,res)=>{const parsed=writeSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_payload'});const id=crypto.randomUUID();const token=crypto.randomBytes(24).toString('base64url');const now=new Date().toISOString();db.prepare('INSERT INTO trips VALUES(?,?,?,?,?)').run(id,token,JSON.stringify(parsed.data.payload),now,now);res.status(201).json({id,token});});
app.get('/api/trips/:id',(req,res)=>{const row=db.prepare('SELECT payload,updated_at FROM trips WHERE id=?').get(req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.json({payload:JSON.parse(row.payload),updatedAt:row.updated_at});});
app.put('/api/trips/:id',(req,res)=>{const parsed=writeSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_payload'});const now=new Date().toISOString();const result=db.prepare('UPDATE trips SET payload=?,updated_at=? WHERE id=? AND share_token=?').run(JSON.stringify(parsed.data.payload),now,req.params.id,parsed.data.token||'');if(!result.changes)return res.status(403).json({error:'forbidden'});res.json({ok:true,updatedAt:now});});
app.delete('/api/trips/:id',(req,res)=>{const token=req.header('x-share-token')||'';const result=db.prepare('DELETE FROM trips WHERE id=? AND share_token=?').run(req.params.id,token);if(!result.changes)return res.status(403).json({error:'forbidden'});res.status(204).end();});

const port=Number(process.env.PORT||3000);app.listen(port,()=>console.log(`long-weekend-api listening on ${port}`));