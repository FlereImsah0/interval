const cacheName = 'interval-timer-v2';
const shell = ['./index.html', './style.css', './app.mjs', './timer.mjs', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((name) =>
    name.startsWith('interval-timer-') && name !== cacheName).map((name) => caches.delete(name)))));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const cached = await caches.open(cacheName);
    return (await cached.match(request.mode === 'navigate' ? './index.html' : request)) || Response.error();
  }));
});
