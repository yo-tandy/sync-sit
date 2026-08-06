import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface ExportUserDataInput {
  targetUserId: string;
}

/**
 * Export all data related to a user: profile, family, appointments,
 * notifications, and audit logs targeting them.
 */
export const exportUserData = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as ExportUserDataInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const userDoc = await db.collection('users').doc(targetUserId).get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;

    // Collect all related data in parallel
    const familyId = getParentProfile(userData as User)?.familyId || null;
    const [familySnap, babysitterApptsSnap, familyApptsSnap, notificationsSnap, auditLogsSnap] =
      await Promise.all([
        // Family doc if user is a parent
        familyId
          ? db.collection('families').doc(familyId).get()
          : Promise.resolve(null),
        // Appointments as babysitter
        db
          .collection('appointments')
          .where('babysitterUserId', '==', targetUserId)
          .get(),
        // Appointments as family member (query by familyId)
        familyId
          ? db
              .collection('appointments')
              .where('familyId', '==', familyId)
              .get()
          : Promise.resolve({ docs: [] } as any),
        // Notifications
        db
          .collection('notifications')
          .where('recipientUserId', '==', targetUserId)
          .get(),
        // Audit logs targeting this user
        db
          .collection('auditLogs')
          .where('targetUserId', '==', targetUserId)
          .get(),
      ]);

    const family = familySnap && familySnap.exists ? { id: familySnap.id, ...familySnap.data() } : null;

    const appointments = [
      ...babysitterApptsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      ...familyApptsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })),
    ];

    // Deduplicate appointments (user could be both babysitter and family in edge cases)
    const uniqueAppointments = Array.from(
      new Map(appointments.map((a) => [a.id, a])).values()
    );

    const notifications = notificationsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const auditLogs = auditLogsSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Guardian data (governance PR 2): the user's own link (as a child), the
    // links their family holds (as a parent), and the kid invites they
    // created or that are addressed to their email.
    const emailLower = (userData.email || '').toLowerCase();
    const [ownLinkSnap, familyLinksSnap, createdInvitesSnap, addressedInvitesSnap] =
      await Promise.all([
        db.collection('guardianLinks').doc(targetUserId).get(),
        familyId
          ? db.collection('guardianLinks').where('familyId', '==', familyId).get()
          : Promise.resolve({ docs: [] } as any),
        db.collection('kidInvites').where('createdByParentUid', '==', targetUserId).get(),
        emailLower
          ? db.collection('kidInvites').where('kidEmailLower', '==', emailLower).get()
          : Promise.resolve({ docs: [] } as any),
      ]);

    const guardianLinks = Array.from(
      new Map(
        [
          ...(ownLinkSnap.exists ? [{ id: ownLinkSnap.id, ...ownLinkSnap.data() }] : []),
          ...familyLinksSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })),
        ].map((l: any) => [l.id, l]),
      ).values(),
    );

    const kidInvites = Array.from(
      new Map(
        [
          ...createdInvitesSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })),
          ...addressedInvitesSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })),
        ].map((i: any) => [i.id, i]),
      ).values(),
    );

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'export_user_data',
      targetUserId,
    });

    return {
      user: { id: userDoc.id, ...userData },
      family,
      appointments: uniqueAppointments,
      notifications,
      auditLogs,
      guardianLinks,
      kidInvites,
    };
  }
);
