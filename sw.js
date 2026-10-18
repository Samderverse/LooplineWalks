/* Loopline Walks service worker.
   When you update any app file, bump VERSION so phones pick up the new copy. */
const VERSION = 'lw-v2';
const SHELL = VERSION + '-shell';
const TILES = 'lw-tiles-2';
const MAX_TILES = 2500;

const SHELL_FILES = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isTile = u => /(^|\.)tile\.openstreetmap\.org$/.test(u.hostname) || /tile-cyclosm\.openstreetmap\.fr$/.test(u.hostname)
  || (u.hostname === 'server.arcgisonline.com' && u.pathname.includes('/tile/'));
const isLive = u => /overpass|routing\.openstreetmap\.de/.test(u.hostname);

let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try {
    const c = await caches.open(TILES); const keys = await c.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
  } finally { trimming = false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isLive(url)) return; // routing and map data always come live (map data is also kept by the app itself)

  if (isTile(url)) {
    // Map tiles: cache first, so areas you've looked at work without signal
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); if (Math.random() < 0.05) trimTiles(); }
        return res;
      } catch (err) { return hit || Response.error(); }
    }));
    return;
  }

  // App files, Leaflet and fonts: serve from cache, refresh in the background
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    if (res) return res;
    if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
