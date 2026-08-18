importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Static file — Vite env is not available here, so the production config is
// hardcoded, exactly like apps/web/public/firebase-messaging-sw.js. These are
// public client-side values (same ones the CI build steps inject as VITE_*).
// study-web reuses the sit web-app registration (see the CI workflow comment:
// a dedicated app registration for sync-study is a follow-up), so the values
// match the sit SW; the app-level token split lives in Firestore
// (fcmTokensStudy vs fcmTokens), not in this registration.
firebase.initializeApp({
  apiKey: 'AIzaSyDyYp2GQdH-8h16B6XNx3sdI8tdDcY1tEw',
  authDomain: 'sync-sit.firebaseapp.com',
  projectId: 'sync-sit',
  storageBucket: 'sync-sit.firebasestorage.app',
  messagingSenderId: '652129443234',
  appId: '1:652129443234:web:b1addb8ca9204154aba6fb',
});

const messaging = firebase.messaging();

// The notification payload is auto-displayed by the browser — do nothing here.
// This handler only exists to prevent the default FCM background handler from
// showing a second notification.
messaging.onBackgroundMessage(() => {
  // no-op: browser already shows the notification from the payload
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
