// Тез Оқу 2026-10-06-да tezoqu.kz-ке көшті. Бұл service worker ескі мекенжайдағы
// (nurbolna.github.io/tez-oqu) кэшті тазалап, өзін өшіреді және ашық беттерді жаңа сайтқа жібереді.
// fetch өңдегіші жоқ — барлық сұрау желіге кетеді (index.html енді tezoqu.kz-ке бағыттайды).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tez-oqu-')).map((k) => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await self.registration.unregister();
    clients.forEach((c) => { try { c.navigate('https://tezoqu.kz/'); } catch (err) {} });
  })());
});
