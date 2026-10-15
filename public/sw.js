// Lets the app open, and an audit be carried on, with no network.
// Network first for everything (so a deploy or a saved change shows straight away); the last good copy is used only
// when the network fails or hangs. Sending things (POST, PUT…) is never touched: the app keeps its own outbox for audits.
const SHELL = 'bk-shell-v1';
const API = 'bk-api-v1'; // signed-in data; app.js deletes it on sign-out
const FONTS = 'bk-fonts-v1';
const SHELL_FILES = ['/', '/app.js', '/app.css', '/rules.js', '/icon.svg', '/manifest.webmanifest'];
const SLOW_MS = 3500; // on a weak signal, fall back to the saved copy after this long (the network copy still refreshes it)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, API, FONTS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function networkFirst(req, cacheName, key = req) {
  return caches.open(cacheName).then(async (cache) => {
    const saved = await cache.match(key);
    const live = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(key, res.clone()).catch(() => {}); // fonts come back opaque
      return res;
    });
    if (!saved) return live;
    const slow = new Promise((resolve) => setTimeout(() => resolve(saved), SLOW_MS));
    return Promise.race([live.catch(() => saved), slow]);
  });
}

/** Fonts never change once published: the copy on the phone is used straight away, the network only the first time. */
function cacheFirst(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => (await cache.match(req)) || fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) {
      // photos are cached by the browser already; sign-in must always be live
      if (/^\/api\/(files|auth)\//.test(url.pathname)) return;
      e.respondWith(networkFirst(req, API));
      return;
    }
    // the page itself, whatever the address, is the one page at /
    if (req.mode === 'navigate') { e.respondWith(networkFirst(req, SHELL, '/')); return; }
    e.respondWith(networkFirst(req, SHELL, url.pathname));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(cacheFirst(req, FONTS));
});

// Phone and computer notifications for alerts (sent once a day by the server; see cronAlerts in src/api.js).
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Bookends Compliance', {
    body: m.body || '', icon: '/icon.svg', badge: '/icon.svg', tag: m.tag, data: { url: m.url || '#/' },
  }));
});
// Tapping one opens the fix or licence: in an open tab of the app if there is one, otherwise in a new one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`/${e.notification.data?.url || '#/'}`, self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
    const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
    return tab ? tab.navigate(url).then((t) => (t || tab).focus()) : self.clients.openWindow(url);
  }));
});
