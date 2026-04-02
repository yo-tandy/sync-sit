import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { sendAdminNotification } from '../config/email.js';

interface DeleteUserInput {
  targetUserId: string;
}

/**
 * GDPR-compliant hard delete: removes all user personal data from Firestore,
 * anonymizes appointment references, and deletes the Firebase Auth account.
 */
export const deleteUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as DeleteUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const userRef = db.collection('users').doc(targetUserId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;
    const role = userData.role;
    const familyId = userData.familyId || null;
    const email = userData.email || '';

    // 1. Cancel active/pending appointments and anonymize user references
    const babysitterAppts = await db
      .collection('appointments')
      .where('babysitterUserId', '==', targetUserId)
      .get();

    const familyAppts = familyId
      ? await db
          .collection('appointments')
          .where('familyId', '==', familyId)
          .get()
      : { docs: [] as any[] };

    const batch1 = db.batch();
    let cancelledCount = 0;

    for (const appt of babysitterAppts.docs) {
      const data = appt.data();
      const updates: Record<string, any> = {
        babysitterUserId: 'deleted',
      };
      if (data.status === 'pending' || data.status === 'confirmed') {
        updates.status = 'cancelled';
        updates.statusReason = 'account_deleted';
        cancelledCount++;
      }
      batch1.update(appt.ref, updates);
    }

    // For family appointments, only anonymize if this is the last parent
    let isLastParent = false;
    if (familyId && role === 'parent') {
      const familyDoc = await db.collection('families').doc(familyId).get();
      const parentIds: string[] = familyDoc.data()?.parentIds || [];
      isLastParent = parentIds.length <= 1;

      if (isLastParent) {
        for (const appt of (familyAppts as any).docs) {
          const data = appt.data();
          const updates: Record<string, any> = {};
          if (data.status === 'pending' || data.status === 'confirmed') {
            updates.status = 'cancelled';
            updates.statusReason = 'account_deleted';
            cancelledCount++;
          }
          if (Object.keys(updates).length > 0) {
            batch1.update(appt.ref, updates);
          }
        }
      }
    }

    if (babysitterAppts.docs.length > 0 || cancelledCount > 0) {
      await batch1.commit();
    }

    // 2. Delete all notifications for this user
    const notifications = await db
      .collection('notifications')
      .where('recipientUserId', '==', targetUserId)
      .get();

    if (notifications.docs.length > 0) {
      const batch2 = db.batch();
      for (const doc of notifications.docs) {
        batch2.delete(doc.ref);
      }
      await batch2.commit();
    }

    // 3. If babysitter: delete schedule and overrides
    if (role === 'babysitter') {
      const scheduleRef = db.collection('schedules').doc(targetUserId);

      // Delete overrides subcollection
      const overrides = await scheduleRef.collection('overrides').get();
      if (overrides.docs.length > 0) {
        const batch3 = db.batch();
        for (const doc of overrides.docs) {
          batch3.delete(doc.ref);
        }
        await batch3.commit();
      }

      // Delete schedule doc
      await scheduleRef.delete();
    }

    // 4. If parent and last parent: delete family doc + kids subcollection
    if (familyId && role === 'parent') {
      const familyRef = db.collection('families').doc(familyId);

      if (isLastParent) {
        // Delete kids subcollection
        const kids = await familyRef.collection('kids').get();
        if (kids.docs.length > 0) {
          const batch4 = db.batch();
          for (const doc of kids.docs) {
            batch4.delete(doc.ref);
          }
          await batch4.commit();
        }

        // Delete family document
        await familyRef.delete();
      } else {
        // Remove this parent from the family's parentIds array
        const familyDoc = await familyRef.get();
        const parentIds: string[] = familyDoc.data()?.parentIds || [];
        await familyRef.update({
          parentIds: parentIds.filter((id) => id !== targetUserId),
        });
      }
    }

    // 5. Delete the user document from Firestore
    await userRef.delete();

    // 6. Delete the Firebase Auth account entirely
    try {
      await adminAuth.deleteUser(targetUserId);
    } catch (err: any) {
      // Auth account may not exist (e.g. already deleted)
      if (err.code !== 'auth/user-not-found') {
        throw err;
      }
    }

    // 7. Write audit log (only stores uid, not personal data)
    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_user',
      targetUserId,
      details: {
        role,
        email,
        cancelledAppointments: cancelledCount,
        familyDeleted: isLastParent && !!familyId,
      },
    });

    await sendAdminNotification(
      `User deleted: ${email}`,
      `<p>Admin deleted a user account.</p>
       <p><strong>Name:</strong> ${userData.firstName || ''} ${userData.lastName || ''}</p>
       <p><strong>Email:</strong> ${email}</p>
       <p><strong>Role:</strong> ${role}</p>
       <p><strong>Cancelled appointments:</strong> ${cancelledCount}</p>
       <p><strong>Family deleted:</strong> ${isLastParent && !!familyId ? 'Yes' : 'No'}</p>`
    );

    return { success: true, cancelledAppointments: cancelledCount };
  }
);
