import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

export const addPreferredBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { babysitterUserId } = request.data as { babysitterUserId: string };

    if (!babysitterUserId) {
      throw new HttpsError('invalid-argument', 'babysitterUserId is required');
    }

    // Verify caller is a parent with a family
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = callerDoc.data();
    if (!caller || caller.role !== 'parent' || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can manage preferred babysitters');
    }

    // Verify babysitter exists and is a babysitter
    const babysitterDoc = await db.collection('users').doc(babysitterUserId).get();
    if (!babysitterDoc.exists || babysitterDoc.data()?.role !== 'babysitter') {
      throw new HttpsError('not-found', 'Babysitter not found');
    }

    // Load family for name
    const familyDoc = await db.collection('families').doc(caller.familyId).get();
    const familyName = familyDoc.data()?.familyName || '';
    const parentName = `${caller.firstName || ''} ${(caller.lastName || '').toUpperCase()}`.trim();

    // Add to family's preferred list (idempotent via arrayUnion)
    await db.collection('families').doc(caller.familyId).update({
      preferredBabysitters: FieldValue.arrayUnion(babysitterUserId),
    });

    // Check if a sharing request already exists for this pair
    const existingRequest = await db.collection('contactSharingRequests')
      .where('babysitterUserId', '==', babysitterUserId)
      .where('familyId', '==', caller.familyId)
      .limit(1)
      .get();

    if (existingRequest.empty) {
      const now = new Date();

      // Create the sharing request directly
      const requestRef = await db.collection('contactSharingRequests').add({
        babysitterUserId,
        familyId: caller.familyId,
        familyName,
        parentName,
        status: 'pending',
        createdAt: now,
      });
      await requestRef.update({ requestId: requestRef.id });

      // Send notifications to babysitter
      const babysitter = babysitterDoc.data()!;
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
        data: { requestId: requestRef.id, familyId: caller.familyId },
        read: false,
        channels: ['email', 'push'],
        createdAt: now,
      });
    }

    return { success: true };
  }
);
