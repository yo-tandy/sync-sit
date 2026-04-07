import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../config/firebase.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

/**
 * Firestore trigger: when a new family-submitted reference is created,
 * notify the babysitter via email and push (if preferences allow).
 */
export const notifyOnNewReference = onDocumentCreated(
  { document: 'references/{referenceId}', region: 'europe-west1' },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    // Only notify for family-submitted references
    if (data.type !== 'family_submitted') return;

    const babysitterUserId = data.babysitterUserId;
    if (!babysitterUserId) return;

    // Load babysitter user doc
    const babysitterDoc = await db.collection('users').doc(babysitterUserId).get();
    const babysitter = babysitterDoc.data();
    if (!babysitter) return;

    // Check notification preferences
    const refsPrefs = babysitter.notifPrefs?.references || { push: true, email: true };
    const submitterName = data.submittedByName || data.refName || 'A family';

    // Send email
    if (refsPrefs.email && babysitter.email) {
      const emailBody = `
        <p><strong>${submitterName}</strong> has submitted a reference for you on Sync/Sit.</p>
        <p>Go to your References page to review it and choose whether to publish it on your profile.</p>
        <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter/references" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View References</a></p>
      `;
      await sendNotificationEmail(
        babysitter.email,
        `New reference from ${submitterName}`,
        emailBody
      );
    }

    // Send push
    if (refsPrefs.push) {
      await sendPushNotification(
        babysitterUserId,
        'New reference received',
        `${submitterName} has submitted a reference for you.`,
        { type: 'reference_received' }
      );
    }

    // Create in-app notification
    await db.collection('notifications').add({
      recipientUserId: babysitterUserId,
      type: 'reference_received',
      title: 'New reference received',
      body: `${submitterName} has submitted a reference for you.`,
      data: { referenceId: event.params.referenceId },
      read: false,
      channels: ['email', 'push'],
      emailSent: refsPrefs.email,
      pushSent: false,
      createdAt: new Date(),
    });
  }
);
