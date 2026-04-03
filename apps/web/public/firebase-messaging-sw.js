/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDyYp2GQdH-8h16B6XNx3sdI8tdDcY1tEw',
  authDomain: 'sync-sit.firebaseapp.com',
  projectId: 'sync-sit',
  storageBucket: 'sync-sit.firebasestorage.app',
  messagingSenderId: '652129443234',
  appId: '1:652129443234:web:b1addb8ca9204154aba6fb',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Only show notification if no app window is focused (avoid duplicates)
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
    const hasFocusedClient = windowClients.some((client) => client.focused);
    if (hasFocusedClient) return; // foreground handler will show in-app toast

    const { title, body } = payload.notification || {};
    if (title) {
      return self.registration.showNotification(title, {
        body: body || '',
        icon: '/favicon.png',
        badge: '/favicon.png',
        data: payload.data,
      });
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      if (windowClients.length > 0) {
        windowClients[0].focus();
      } else {
        clients.openWindow('/');
      }
    })
  );
});
