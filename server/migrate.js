import 'dotenv/config'; import fs from 'node:fs'; import { pool } from './db.js';
for (const f of fs.readdirSync('migrations').sort()) { await pool.query(fs.readFileSync(`migrations/${f}`, 'utf8')); console.log('applied', f); }
await pool.end();
