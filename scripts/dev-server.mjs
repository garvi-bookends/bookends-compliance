// Local server: the website from public/ and the same API as on Vercel, on http://localhost:8787.
//   npm run dev          this computer only
//   npm run dev:wifi     also phones on the same Wi-Fi (http://<this computer's IP>:8787)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { handleApi } from '../src/api.js';
import { appEnv } from '../src/platform.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.argv.includes('--wifi') ? '0.0.0.0' : '127.0.0.1';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const env = appEnv();

async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(url, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]])),
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
    });
    const response = await handleApi(request, env);
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Something went wrong on the server' }));
  }
}).listen(PORT, HOST, () => {
  console.log(`Ready on http://localhost:${PORT}${HOST === '0.0.0.0' ? ' (and on this computer\'s Wi-Fi address)' : ''}`);
  console.log(`Photos: ${process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : `folder ${process.env.FILES_DIR || '.data/files'}`}`);
});
