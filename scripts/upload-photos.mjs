// Loads the audit photos in data/photos into the FILES KV namespace.
//   node scripts/upload-photos.mjs --local     (dev)
//   node scripts/upload-photos.mjs --remote    (production)
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const where = process.argv.includes('--remote') ? '--remote' : '--local';
const dir = new URL('../data/photos/', import.meta.url);
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const files = readdirSync(dir).filter((f) => TYPES[f.split('.').pop()]);
const bulk = files.map((f) => ({
  key: `evidence/import/${f}`,
  value: readFileSync(new URL(f, dir)).toString('base64'),
  base64: true,
  metadata: { type: TYPES[f.split('.').pop()], by: 'import' },
}));
const out = join(mkdtempSync(join(tmpdir(), 'bk-photos-')), 'bulk.json');
writeFileSync(out, JSON.stringify(bulk));
console.log(`Uploading ${bulk.length} photos (${where.slice(2)})…`);
execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', out, '--binding', 'FILES', where], { stdio: 'inherit' });
