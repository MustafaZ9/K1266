/* TEMPORARY test SW for /pushtest/ — validates Web Push delivery. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(self.registration.showNotification(
    data.title || 'Test push',
    { body: data.body || 'Web Push works!', tag: 'interop-test' }
  ));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./push-test.html'));
});
