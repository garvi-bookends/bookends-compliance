import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { get, put } from '@vercel/blob';

// Audit photos, proof of fixes and licence scans. Two stores with the same two calls:
//   put(key, bytes, contentType)   and   get(key) → { body, type } | null
// Vercel Blob (private) when BLOB_READ_WRITE_TOKEN is set (production); otherwise a folder on disk (local development).

const TYPE_OF = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

export function blobFiles(token) {
  return {
    async put(key, body, type) {
      await put(key, Buffer.from(body), { access: 'private', contentType: type, addRandomSuffix: false, allowOverwrite: true, token });
    },
    async get(key) {
      const r = await get(key, { access: 'private', token });
      if (!r || !r.stream) return null;
      return { body: r.stream, type: r.blob.contentType };
    },
  };
}

export function diskFiles(root) {
  return {
    async put(key, body) {
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(body));
    },
    async get(key) {
      try {
        return { body: await readFile(join(root, key)), type: TYPE_OF[key.split('.').pop()] };
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

export const filesFromEnv = (e = process.env) => (e.BLOB_READ_WRITE_TOKEN ? blobFiles(e.BLOB_READ_WRITE_TOKEN) : diskFiles(e.FILES_DIR || '.data/files'));
