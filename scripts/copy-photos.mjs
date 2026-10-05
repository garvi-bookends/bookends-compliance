// Copies photos and scans into the file store the app uses: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise
// the local folder (.data/files). Copying a file that is already there just replaces it, so it is safe to re-run.
//   npm run photos:copy -- --import          the 275 imported audit photos in data/photos
//   npm run photos:copy -- --from-local      files taken while running `npm run dev` on this computer (.data/files)
//   npm run photos:copy -- --from-kv-remote  files taken in the app, from the old live Cloudflare KV store (needs `npx wrangler login`)
//   npm run photos:copy -- --from-kv-local   the same from the old local KV store (.wrangler/state)
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { filesFromEnv } from '../src/files.js';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
const typeOf = (key) => TYPES[key.split('.').pop().toLowerCase()];
const files = filesFromEnv();
console.log(`Copying to ${process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : `folder ${process.env.FILES_DIR || '.data/files'}`}`);

/** [key, () => bytes] for every file to copy. */
let jobs;
if (process.argv.includes('--import')) {
  const dir = new URL('../data/photos/', import.meta.url);
  jobs = readdirSync(dir).filter(typeOf).map((f) => [`evidence/import/${f}`, () => readFileSync(new URL(f, dir))]);
} else if (process.argv.includes('--from-local')) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error('--from-local copies .data/files to Vercel Blob: set BLOB_READ_WRITE_TOKEN first.'); process.exit(1); }
  const root = '.data/files';
  jobs = readdirSync(`${root}/evidence`, { recursive: true }).map((p) => `evidence/${String(p).replace(/\\/g, '/')}`)
    .filter((k) => typeOf(k) && !k.startsWith('evidence/import/')).map((k) => [k, () => readFileSync(`${root}/${k}`)]);
} else if (process.argv.includes('--from-kv-remote') || process.argv.includes('--from-kv-local')) {
  const where = process.argv.includes('--from-kv-remote') ? '--remote' : '--local';
  const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', 'kv', ...args, '--binding', 'FILES', where], { shell: true, maxBuffer: 64 * 1024 * 1024, ...opts });
  // Imported photos (evidence/import/) are the files in data/photos: --import copies those much faster.
  const keys = JSON.parse(wrangler(['key', 'list', '--prefix', 'evidence/'], { encoding: 'utf8' })).map((k) => k.name)
    .filter((k) => typeOf(k) && !k.startsWith('evidence/import/'));
  console.log(`${keys.length} files taken in the app (run --import as well for the imported photos)`);
  jobs = keys.map((k) => [k, () => wrangler(['key', 'get', `"${k}"`])]);
} else {
  console.error('Say what to copy: --import, --from-local, --from-kv-remote or --from-kv-local');
  process.exit(1);
}

let done = 0, failed = 0;
for (const [key, read] of jobs) {
  try {
    await files.put(key, read(), typeOf(key));
    done += 1;
    if (done % 25 === 0) console.log(`  ${done} / ${jobs.length}`);
  } catch (e) {
    failed += 1;
    console.error(`  ${key}: ${e.message}`);
  }
}
console.log(`${done} copied${failed ? `, ${failed} failed (run again to retry)` : ''}.`);
if (failed) process.exitCode = 1;
