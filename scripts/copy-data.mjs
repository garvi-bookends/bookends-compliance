// Copies every row into the PostgreSQL database in DATABASE_URL (e.g. Supabase), replacing what it holds.
//   npm run db:copy -- --from-pg "postgres://postgres:PASSWORD@localhost:5432/bookends_compliance"   another PostgreSQL
//   npm run db:copy -- --from-d1-remote    the old live Cloudflare D1 database (needs `npx wrangler login`)
//   npm run db:copy -- --from-d1-local     the old local D1 that `wrangler dev` used (.wrangler/state)
// Run `npm run db:migrate` first so the tables exist. Photos are copied separately (npm run photos:copy).
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { pgConfig } from '../src/db.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1] ?? ''; };
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL (where to copy to) is not set.'); process.exit(1); }

/** A source answers: does table t exist, and what are its rows. */
async function openSource() {
  const fromPg = arg('--from-pg');
  if (fromPg) {
    if (new URL(fromPg).toString() === new URL(process.env.DATABASE_URL).toString()) { console.error('Source and target are the same database.'); process.exit(1); }
    const c = new pg.Client(pgConfig(fromPg));
    await c.connect();
    return {
      has: async (t) => (await c.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [t])).rowCount > 0,
      rows: async (t) => (await c.query(`SELECT * FROM ${t}`)).rows,
      close: () => c.end(),
    };
  }
  let db;
  if (process.argv.includes('--from-d1-remote')) {
    const out = join(mkdtempSync(join(tmpdir(), 'bk-d1-')), 'export.sql');
    console.log('Exporting the live D1 database …');
    execFileSync('npx', ['wrangler', 'd1', 'export', 'bookends-compliance', '--remote', '--output', out], { stdio: 'inherit', shell: true });
    db = new DatabaseSync(':memory:');
    db.exec(readFileSync(out, 'utf8'));
  } else if (process.argv.includes('--from-d1-local')) {
    const dir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
    const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (!file) { console.error(`No local D1 database in ${dir}`); process.exit(1); }
    db = new DatabaseSync(join(dir, file), { readOnly: true });
  } else {
    console.error('Say where to copy from: --from-pg <url>, --from-d1-remote or --from-d1-local');
    process.exit(1);
  }
  return {
    has: async (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t),
    rows: async (t) => db.prepare(`SELECT * FROM ${t}`).all(),
    close: async () => db.close(),
  };
}

// Parents before children, so foreign keys hold while inserting.
const TABLES = ['sites', 'templates', 'template_items', 'audits', 'audit_responses', 'findings', 'licences', 'activity', 'users', 'alert_dismissals'];
const src = await openSource();
const db = new pg.Client(pgConfig(process.env.DATABASE_URL));
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  for (const t of TABLES) {
    if (!(await src.has(t))) { console.log(`${t}: not in the source, skipped`); continue; }
    const pgCols = new Set((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [t])).rows.map((r) => r.column_name));
    const rows = await src.rows(t);
    if (!rows.length) { console.log(`${t}: 0 rows`); continue; }
    const cols = Object.keys(rows[0]).filter((c) => pgCols.has(c));
    // An old D1 users table may predate usernames (D1 migration 0006): the e-mail became the username there.
    const value = (r, c) => (t === 'users' && c === 'username' ? String(r.username ?? r.email).toLowerCase() : r[c]);
    if (t === 'users' && !cols.includes('username')) cols.push('username');
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const params = [];
      const tuples = chunk.map((r) => `(${cols.map((c) => { params.push(value(r, c) ?? null); return `$${params.length}`; }).join(', ')})`);
      await db.query(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${tuples.join(', ')}`, params);
    }
    console.log(`${t}: ${rows.length} rows`);
  }
  for (const t of TABLES) {
    if (t === 'audit_responses' || t === 'alert_dismissals') continue;
    await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT max(id) FROM ${t}), 0) + 1, false)`);
  }
  await db.query('COMMIT');
  console.log('Copied.');
} catch (e) {
  await db.query('ROLLBACK');
  console.error('Nothing was changed:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
  await src.close();
}
