import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { ageFromDob, getUserRole, getParentProfile, type User } from '@ejm/shared-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { escapeHtml, sendAdminNotification } from '../config/email.js';

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
    const role = getUserRole(userData as User);
    const familyId = getParentProfile(userData as User)?.familyId || null;
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
    let batch1Ops = 0;
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
      batch1Ops++;
    }

    // For family appointments, only anonymize if this is the last parent
    let isLastParent = false;
    if (familyId && role === 'parent') {
      const familyDoc = await db.collection('families').doc(familyId).get();
      const parentIds: string[] = familyDoc.data()?.parentIds || [];
      isLastParent = parentIds.length <= 1;

      // Walk every family appointment.
      //   - Always anonymize `createdByUserId` if the deleted user was the
      //     creator, regardless of whether they are the last parent. Without
      //     this, a deleted co-parent's UID lingers on appointments the
      //     remaining co-parent still owns. (GDPR leak.)
      //   - Only cancel active appointments if this is the last parent —
      //     otherwise the family still exists and can honor them.
      for (const appt of (familyAppts as any).docs) {
        const data = appt.data();
        const updates: Record<string, any> = {};
        if (data.createdByUserId === targetUserId) {
          updates.createdByUserId = 'deleted';
        }
        if (isLastParent && (data.status === 'pending' || data.status === 'confirmed')) {
          updates.status = 'cancelled';
          updates.statusReason = 'account_deleted';
          cancelledCount++;
        }
        if (Object.keys(updates).length > 0) {
          batch1.update(appt.ref, updates);
          batch1Ops++;
        }
      }
    }

    if (batch1Ops > 0) {
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

    // 4-bis. Guardian cleanup (governance PR 2).
    // As a CHILD: their link and the invites addressed to them are personal
    // data — remove both.
    await db.collection('guardianLinks').doc(targetUserId).delete();
    if (email) {
      const ownInvites = await db
        .collection('kidInvites')
        .where('kidEmailLower', '==', email.toLowerCase())
        .get();
      for (const doc of ownInvites.docs) {
        await doc.ref.delete();
      }
    }

    // As a PARENT: supervision is family-level, so a remaining co-parent
    // keeps every link untouched — only the deleted parent's uid is
    // anonymized off the invites they created (mirroring the appointment
    // createdByUserId anonymization above). When the LAST parent goes, the
    // family's supervision ends: every ACTIVE link is revoked and the
    // governedBy mirror removed; an under-15 child must not keep operating
    // unsupervised, so their account is hard-blocked (status is the ban
    // gate, matching blockUser semantics) and admin is alerted to resolve.
    // The dead family's pending invites are cancelled — redeeming one would
    // mint a link to a family that no longer exists.
    if (familyId && role === 'parent') {
      if (!isLastParent) {
        const createdInvites = await db
          .collection('kidInvites')
          .where('createdByParentUid', '==', targetUserId)
          .get();
        for (const doc of createdInvites.docs) {
          await doc.ref.update({ createdByParentUid: 'deleted' });
        }
      } else {
        const familyLinks = await db
          .collection('guardianLinks')
          .where('familyId', '==', familyId)
          .get();
        const now = new Date();
        for (const linkDoc of familyLinks.docs) {
          if (linkDoc.data().status !== 'active') continue;
          const childUid = linkDoc.data().childUid;
          await linkDoc.ref.update({
            status: 'revoked',
            revokedAt: now,
            revokedByUid: request.auth.uid,
          });
          const childRef = db.collection('users').doc(childUid);
          const child = (await childRef.get()).data();
          if (!child) continue;
          const dob = child.dateOfBirth?.toDate?.() ?? null;
          // A missing DOB cannot prove 15+, so it is treated as a minor.
          const isMinor = !dob || ageFromDob(dob) < 15;
          const childUpdates: Record<string, unknown> = {
            governedBy: FieldValue.delete(),
            updatedAt: now,
          };
          if (isMinor) {
            childUpdates.status = 'blocked';
          }
          await childRef.update(childUpdates);
          if (isMinor) {
            try {
              await adminAuth.updateUser(childUid, { disabled: true });
            } catch (err: any) {
              if (err.code !== 'auth/user-not-found') throw err;
            }
            await db.collection('adminAlerts').add({
              type: 'guardian_orphaned_minor',
              createdAt: now,
              data: { childUid, familyId, deletedParentUid: targetUserId },
            });
          }
        }
        const familyInvites = await db
          .collection('kidInvites')
          .where('familyId', '==', familyId)
          .get();
        for (const doc of familyInvites.docs) {
          const updates: Record<string, unknown> = {};
          if (doc.data().status === 'pending') updates.status = 'cancelled';
          if (doc.data().createdByParentUid === targetUserId) {
            updates.createdByParentUid = 'deleted';
          }
          if (Object.keys(updates).length > 0) {
            await doc.ref.update(updates);
          }
        }
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
        // A user may hold no profile at all (e.g. a governed kid deleted
        // before enrolling) — undefined is not a Firestore value.
        role: role ?? null,
        email,
        cancelledAppointments: cancelledCount,
        familyDeleted: isLastParent && !!familyId,
      },
    });

    await sendAdminNotification(
      `User deleted: ${email}`,
      `<p>Admin deleted a user account.</p>
       <p><strong>Name:</strong> ${escapeHtml(userData.firstName || '')} ${escapeHtml(userData.lastName || '')}</p>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Role:</strong> ${role}</p>
       <p><strong>Cancelled appointments:</strong> ${cancelledCount}</p>
       <p><strong>Family deleted:</strong> ${isLastParent && !!familyId ? 'Yes' : 'No'}</p>`
    );

    return { success: true, cancelledAppointments: cancelledCount };
  }
);
