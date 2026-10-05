// Applies migrations-pg/*.sql to the PostgreSQL database in DATABASE_URL (from .env), oldest first, each once.
// Creates the database itself if it does not exist yet. Run with: npm run db:migrate
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { pgConfig } from '../src/db.js';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.'); process.exit(1); }

const target = new URL(url);
const dbName = decodeURIComponent(target.pathname.slice(1));
try {
  const probe = new pg.Client(pgConfig(url));
  await probe.connect();
  await probe.end();
} catch (e) {
  if (e.code !== '3D000') throw e; // 3D000: database does not exist
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new pg.Client(pgConfig(admin.toString()));
  await c.connect();
  await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  await c.end();
  console.log(`Created database ${dbName}`);
}

const dir = new URL('../migrations-pg/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const db = new pg.Client(pgConfig(url));
await db.connect();
await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  process.stdout.write(`Applying ${f} … `);
  try {
    await db.query('BEGIN');
    await db.query(readFileSync(new URL(f, dir), 'utf8'));
    await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    await db.query('COMMIT');
    console.log('done');
    applied += 1;
  } catch (e) {
    await db.query('ROLLBACK');
    console.log('failed');
    console.error(e.message);
    process.exitCode = 1;
    break;
  }
}
console.log(applied ? `${applied} migration(s) applied to ${dbName}.` : `${dbName} is up to date.`);
await db.end();
