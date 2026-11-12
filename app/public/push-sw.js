// Doklejane do wygenerowanego service workera (workbox importScripts).
// Push przychodzi bez payloadu (patrz worker/src/index.js), więc treść dobieramy
// tutaj według lokalnej godziny: rano zachęta, o 19:00 przypomnienie, po 21:00
// ostrzeżenie o serii. Przy okazji zapalamy znacznik na ikonie aplikacji.
function reminderText(hour) {
  if (hour < 12) return { title: '☀️ Buenos días!', body: 'Dwie minuty hiszpańskiego na dobry początek dnia?' };
  if (hour >= 21) return { title: '🔥 Seria kończy się o północy', body: 'Jedna szybka sesja i seria zostaje z tobą.' };
  return { title: '🔥 Hiszpański czeka!', body: 'Dziś jeszcze bez nauki — krótka sesja wystarczy.' };
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload-less push */
  }
  const text = reminderText(new Date().getHours());
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || text.title, {
        body: data.body || text.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'kurs-reminder',
        data: { url: '/?start=quick' },
      }),
      // znacznik na ikonie znika, gdy aplikacja odnotuje dzisiejszą naukę
      self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
