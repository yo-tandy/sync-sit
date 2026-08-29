import { resolveNotifPref, type NotifCategory } from '@ejm/shared-core';
import { db } from './firebase.js';
import { sendNotificationEmail } from './email.js';
import type { NotificationApp } from './email.js';
import { sendPushNotification } from './push.js';

interface ParentNotification {
  familyId: string;
  /** Which notifPrefs category to check (e.g. 'cancelled', 'confirmed') */
  prefCategory: NotifCategory;
  /**
   * Which app's branding the email/push carry (default 'sit') — and, since
   * issue #369, which app BLOCK of `notifPrefs` gates the send. The two are
   * deliberately one value: a preference is answered by the app whose mail
   * actually arrives, so a family cannot mute Sync/Study mail and keep
   * receiving it under a sit-shaped gate. Shared categories (`reminders`,
   * `references`) ignore it and resolve from `notifPrefs.shared`.
   *
   * The guardian callables in ../guardian/ leave it at 'sit' along with their
   * branding: a supervision notice is platform-level and sit is the shell it
   * is sent from.
   */
  app?: NotificationApp;
  /** Notification type stored in the notification doc */
  type: string;
  title: string;
  body: string;
  /** Email subject line */
  emailSubject: string;
  /** HTML email body */
  emailBody: string;
  /** Extra data attached to push + in-app notifications */
  data?: Record<string, string>;
}

/**
 * Send push, email, and in-app notifications to all parents in a family.
 * Respects each parent's individual notification preferences.
 */
export async function notifyAllParents(notification: ParentNotification): Promise<void> {
  const { familyId, prefCategory, type, title, body, emailSubject, emailBody, data, app = 'sit' } = notification;

  const familyDoc = await db.collection('families').doc(familyId).get();
  const parentIds: string[] = familyDoc.data()?.parentIds || [];
  const now = new Date();

  for (const parentId of parentIds) {
    const parentDoc = await db.collection('users').doc(parentId).get();
    const parentData = parentDoc.data();
    if (!parentData) continue;

    const prefs = resolveNotifPref(parentData.notifPrefs, app, prefCategory);

    // Email — record the actual delivery outcome, not an assumption.
    let emailSent = false;
    if (prefs.email && parentData.email) {
      emailSent = await sendNotificationEmail(parentData.email, emailSubject, emailBody, app);
    }

    // Push — record the actual delivery outcome, not an assumption.
    let pushSent = false;
    if (prefs.push) {
      pushSent = await sendPushNotification(parentId, title, body, { ...data, type }, app);
    }

    // In-app notification
    await db.collection('notifications').add({
      recipientUserId: parentId,
      type,
      title,
      body,
      data: data || {},
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });
  }
}
