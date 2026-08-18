import { useEffect } from 'react';
import { create } from 'zustand';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { VISIBLE_NOTIFICATION_TYPES } from '@/lib/notificationRouting';

/**
 * In-app notification surface (issue #127, UX F13).
 *
 * ONE realtime subscription per app, shared by the bell badge and the
 * /notifications page (module-level listener + zustand state, mirroring
 * authStore's user-doc watcher). The query is recipient-only — rules constrain
 * reads by recipientUserId (firestore.rules), and a where-in over 25+ types is
 * impractical — so the app-type filter runs CLIENT-SIDE on the fetched window:
 * a sit-only notification must not light study's bell.
 *
 * Writes are rules-pinned: the recipient may update ONLY the `read` key
 * (create/delete are server-only), so markRead/markAllRead send exactly
 * `{ read: true }` and nothing else.
 */

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  // Timestamp in production; emulator-written rows can arrive as a plain
  // Date (see the RequestsPage formatDate note in study).
  createdAt?: { toDate: () => Date } | Date | null;
}

interface NotificationsState {
  /** Visible-type notifications, newest first; null until the first snapshot (and on error). */
  notifications: AppNotification[] | null;
  /** Unread among the VISIBLE types — never the raw collection count. */
  unreadCount: number;
  loadError: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/** Fetch window: the newest 50 docs for the recipient, filtered client-side. */
const NOTIFICATIONS_WINDOW = 50;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  notifications: null,
  unreadCount: 0,
  loadError: false,

  markRead: async (id: string) => {
    const { notifications, unreadCount } = get();
    const target = notifications?.find((n) => n.id === id);
    if (!target || target.read) return;
    // Optimistic flip — the snapshot echo confirms it, and a failed write is
    // only a stale-until-next-snapshot badge, never lost data.
    set({
      notifications: notifications!.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, unreadCount - 1),
    });
    try {
      // ONLY the read key — the recipient's update rule allows nothing else.
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (err) {
      console.warn('markRead failed', err);
    }
  },

  markAllRead: async () => {
    const { notifications } = get();
    const unread = (notifications ?? []).filter((n) => !n.read);
    if (unread.length === 0) return;
    set({
      notifications: notifications!.map((n) => (n.read ? n : { ...n, read: true })),
      unreadCount: 0,
    });
    try {
      const batch = writeBatch(db);
      for (const n of unread) {
        // ONLY the read key — the recipient's update rule allows nothing else.
        batch.update(doc(db, 'notifications', n.id), { read: true });
      }
      await batch.commit();
    } catch (err) {
      console.warn('markAllRead failed', err);
    }
  },
}));

let notifUnsub: (() => void) | null = null;
let watchedUid: string | null = null;

/**
 * Idempotently (re)target the single notifications listener at `uid`
 * (null detaches and resets). Exported for tests; components go through
 * useNotifications().
 */
export function watchNotifications(uid: string | null): void {
  if (uid === watchedUid) return;
  if (notifUnsub) {
    notifUnsub();
    notifUnsub = null;
  }
  watchedUid = uid;
  if (!uid) {
    useNotificationsStore.setState({ notifications: null, unreadCount: 0, loadError: false });
    return;
  }
  try {
    notifUnsub = onSnapshot(
      query(
        collection(db, 'notifications'),
        where('recipientUserId', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(NOTIFICATIONS_WINDOW),
      ),
      (snap) => {
        const visible = snap.docs
          // Spread BEFORE id so a stray `id` field in the doc can't shadow the doc id.
          .map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as AppNotification)
          .filter((n) => VISIBLE_NOTIFICATION_TYPES.has(n.type));
        useNotificationsStore.setState({
          notifications: visible,
          unreadCount: visible.filter((n) => !n.read).length,
          loadError: false,
        });
      },
      () => {
        // Error posture: empty bell (count 0); the page shows its loadError line.
        useNotificationsStore.setState({ notifications: null, unreadCount: 0, loadError: true });
      },
    );
  } catch (err) {
    // A synchronous subscribe failure must never crash the app bar that
    // mounts the bell — same posture as the listener's error callback.
    console.warn('notifications subscribe failed', err);
    useNotificationsStore.setState({ notifications: null, unreadCount: 0, loadError: true });
  }
}

let consumerCount = 0;

/**
 * The one entry point for components (bell + page). Attaches the shared
 * listener for the signed-in uid; the LAST consumer's unmount detaches it
 * (sign-out unmounts the guarded layouts, so the listener never outlives the
 * session).
 */
export function useNotifications(): NotificationsState {
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;
  useEffect(() => {
    consumerCount += 1;
    watchNotifications(uid);
    return () => {
      consumerCount -= 1;
      if (consumerCount === 0) watchNotifications(null);
    };
  }, [uid]);
  return useNotificationsStore();
}
