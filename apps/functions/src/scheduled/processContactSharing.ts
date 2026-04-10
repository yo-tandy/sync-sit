import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../config/firebase.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

/**
 * Runs every minute. Processes pending contact sharing notifications.
 * After a parent adds a babysitter to favorites, a pending doc is created with notifyAt = now + 60s.
 * This function picks up docs where notifyAt has passed, verifies the babysitter is still
 * in the family's favorites, and sends a notification asking to share contact info.
 */
export const processContactSharing = onSchedule(
  { schedule: 'every 1 minutes', region: 'europe-west1', timeZone: 'Europe/Paris' },
  async () => {
    const now = new Date();

    const pendingSnap = await db.collection('contactSharingPending')
      .where('processed', '==', false)
      .where('notifyAt', '<=', now)
      .limit(20)
      .get();

    if (pendingSnap.empty) return;

    for (const pendingDoc of pendingSnap.docs) {
      const data = pendingDoc.data();
      const { babysitterUserId, familyId, familyName, parentName } = data;

      try {
        // Verify babysitter is still in the family's favorites
        const familyDoc = await db.collection('families').doc(familyId).get();
        const preferred: string[] = familyDoc.data()?.preferredBabysitters || [];

        if (!preferred.includes(babysitterUserId)) {
          // Parent removed the favorite before the delay — skip
          await pendingDoc.ref.delete();
          continue;
        }

        // Check if a request already exists (idempotent)
        const existingSnap = await db.collection('contactSharingRequests')
          .where('babysitterUserId', '==', babysitterUserId)
          .where('familyId', '==', familyId)
          .limit(1)
          .get();

        if (!existingSnap.empty) {
          // Already has a request — mark as processed and skip
          await pendingDoc.ref.update({ processed: true });
          continue;
        }

        // Create the sharing request
        const requestRef = await db.collection('contactSharingRequests').add({
          babysitterUserId,
          familyId,
          familyName,
          parentName,
          status: 'pending',
          createdAt: now,
        });
        await requestRef.update({ requestId: requestRef.id });

        // Send notification to babysitter
        const babysitterDoc = await db.collection('users').doc(babysitterUserId).get();
        const babysitter = babysitterDoc.data();

        if (babysitter) {
          const title = 'New favorite!';
          const body = `${parentName} from the ${familyName} family added you to their favorites! Would you like to share your contact information with them?`;

          // Push notification
          await sendPushNotification(babysitterUserId, title, body, {
            type: 'contact_sharing_request',
            requestId: requestRef.id,
          });

          // Email notification
          if (babysitter.email) {
            await sendNotificationEmail(
              babysitter.email,
              `${parentName} from the ${familyName} family added you to their favorites!`,
              `<p><strong>${parentName}</strong> from the <strong>${familyName}</strong> family added you to their favorite babysitters!</p>
               <p>Would you like to share your contact information with them?</p>
               <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter/families" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Respond</a></p>`
            );
          }

          // In-app notification
          await db.collection('notifications').add({
            recipientUserId: babysitterUserId,
            type: 'contact_sharing_request',
            title,
            body,
            data: { requestId: requestRef.id, familyId },
            read: false,
            channels: ['email', 'push'],
            createdAt: now,
          });
        }

        // Mark as processed
        await pendingDoc.ref.update({ processed: true });
      } catch (err) {
        console.error(`Failed to process contact sharing pending ${pendingDoc.id}:`, err);
        // Don't mark as processed — will retry next run
      }
    }
  }
);
