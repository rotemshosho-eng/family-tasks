// Keeps the app opening even without internet. Same-origin files only; Firebase handles its own data cache.
const CACHE = 'family-tasks-v93';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'firebase-config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first, so updates pushed to GitHub show up right away; cache when offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: always ask GitHub whether the file changed, so phones get updates right away
    fetch(e.request, { cache: 'no-cache' }).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// Push notifications sent by the notifier (GitHub Actions → Firebase Cloud Messaging, data-only messages).
self.addEventListener('push', e => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch (err) { j = { data: { title: 'קופצי', body: e.data ? e.data.text() : '' } }; }
  const d = j.data || j.notification || j;
  const title = d.title || 'קופצי';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', dir: 'rtl', lang: 'he',
    data: { link: d.link || self.registration.scope }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(link);
  }));
});
