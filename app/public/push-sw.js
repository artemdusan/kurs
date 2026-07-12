// Doklejane do wygenerowanego service workera (workbox importScripts).
// Push przychodzi bez payloadu (patrz worker/src/index.js) — treść na stałe.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload-less push */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '🔥 Hiszpański czeka!', {
      body: data.body || 'Nie było dziś sesji — zrób krótką powtórkę, żeby nie stracić serii.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'kurs-reminder',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
