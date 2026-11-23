const cacheName = 'interval-timer-v17';
const recordings = ['ready', 'go', 'rest', 'run', 'walk', 'hold', 'relax', 'complete', 'next',
  'one', 'two', 'three', 'three-seconds', 'five-seconds'];
const shell = ['./index.html', './style.css', './app.mjs', './timer.mjs', './voice.mjs', './icon.svg',
  './favicon.ico', './favicon-16.png', './favicon-32.png',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png', './maskable-192.png', './maskable-512.png',
  './manifest.webmanifest', './welcome-sports.jpg', ...recordings.map((name) => './voice/' + name + '.wav')];
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(shell.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((name) =>
      name.startsWith('interval-timer-') && name !== cacheName).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const cached = await caches.open(cacheName);
    return (await cached.match(request.mode === 'navigate' ? './index.html' : request)) || Response.error();
  }));
});
