// Service worker : reçoit les messages poussés par l'Action GitHub et les affiche en notification,
// même quand l'appli est fermée.

const ICONE = 'icones/icone-192.png';
const BADGE = 'icones/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { corps: event.data ? event.data.text() : '' };
  }
  const options = {
    body: message.corps || '',
    icon: ICONE,
    badge: BADGE,
    lang: 'fr',
    data: { url: message.url || './' },
  };
  if (message.tag) {
    options.tag = message.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(message.titre || 'Rappel', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const ouverte = fenetres.find((f) => f.url.startsWith(self.registration.scope));
      if (ouverte) {
        await ouverte.focus();
        // navigate() échoue si la page n'est pas encore contrôlée par ce service worker : on la laisse telle quelle.
        if (ouverte.url !== url) await ouverte.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
