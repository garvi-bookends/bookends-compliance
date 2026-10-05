// The Vercel Function behind every /api/* request (vercel.json rewrites them here). The website itself is public/.
import { handleApi } from '../src/api.js';
import { appEnv } from '../src/platform.js';

async function handler(request) {
  // The rewrite passes the original path as ?__path=; put it back so the app sees /api/<path>.
  const url = new URL(request.url);
  const path = url.searchParams.get('__path');
  if (path != null) {
    url.pathname = `/api/${path}`;
    url.searchParams.delete('__path');
    request = new Request(url, request);
  }
  return handleApi(request, appEnv());
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
