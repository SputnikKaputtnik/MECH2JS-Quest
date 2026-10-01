/* global BUILD_ID */
// Only the app shell is cached here. Private game data live separately in OPFS.
const PREFIX = 'mw2-quest-shell-';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/quest-shell.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Offline manifest missing');
    const manifest = await response.json();
    if (manifest.id !== BUILD_ID) throw new Error('Build changed during install; retry');
    const cache = await caches.open(PREFIX + manifest.id);
    await cache.addAll(manifest.files);
    await cache.put('/quest-shell.json', new Response(JSON.stringify(manifest)));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data === 'activate-installed-build') void self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/mw2/') || url.pathname === '/quest-install.json' || url.pathname === '/quest-shell.json') return;
  event.respondWith((async () => {
    const cache = await caches.open(PREFIX + BUILD_ID);
    const match = await cache.match(event.request.mode === 'navigate' ? '/index.html' : url.pathname);
    if (match) return match;
    try { const response = await fetch(event.request); if (response.ok) return response; } catch { /* offline */ }
    return new Response('Offline-Datei fehlt. Mit USB erneut über ?setup installieren.', {status:503});
  })());
});
