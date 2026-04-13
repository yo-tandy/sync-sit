import { db } from './firebase.js';
import { sendNotificationEmail } from './email.js';
import { sendPushNotification } from './push.js';

type NotifPrefCategory = 'newRequest' | 'confirmed' | 'cancelled' | 'reminders';

interface ParentNotification {
  familyId: string;
  /** Which notifPrefs category to check (e.g. 'cancelled', 'confirmed') */
  prefCategory: NotifPrefCategory;
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
  const { familyId, prefCategory, type, title, body, emailSubject, emailBody, data } = notification;

  const familyDoc = await db.collection('families').doc(familyId).get();
  const parentIds: string[] = familyDoc.data()?.parentIds || [];
  const now = new Date();

  for (const parentId of parentIds) {
    const parentDoc = await db.collection('users').doc(parentId).get();
    const parentData = parentDoc.data();
    if (!parentData) continue;

    const prefs = parentData.notifPrefs?.[prefCategory];

    // Email
    if (prefs?.email !== false && parentData.email) {
      await sendNotificationEmail(parentData.email, emailSubject, emailBody);
    }

    // Push
    if (prefs?.push !== false) {
      await sendPushNotification(parentId, title, body, { ...data, type });
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
      emailSent: prefs?.email !== false,
      pushSent: false,
      createdAt: now,
    });
  }
}
