/* ジョグログ Service Worker
   - アプリ本体はキャッシュから即起動し、裏で最新版を取得（次回起動時に反映）
   - 地図部品（Leaflet）と、一度見た地図画像もキャッシュして圏外で再表示 */
const VERSION = 'joglog-v1';
const SHELL = VERSION + '-shell';
const RUNTIME = VERSION + '-runtime';
const TILES = VERSION + '-tiles';
const MAX_TILES = 1500;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('joglog-') && !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isTile = url => /cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org/.test(url.hostname);
const isLib = url => /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(url.hostname) && /leaflet/.test(url.pathname);

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // アプリ本体：キャッシュを先に返し、裏で更新
  if (req.mode === 'navigate' || (url.origin === location.origin)) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const update = fetch(req).then(res => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(update); return cached; }
      return (await update) || new Response('オフラインです。電波のある場所で一度開いてください。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  // 地図部品：一度取れたらキャッシュを使う
  if (isLib(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // 地図画像：通信できれば最新、圏外なら一度見た画像
  if (isTile(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { cache.put(req, res.clone()); e.waitUntil(trimTiles()); }
        return res;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
  }
});
