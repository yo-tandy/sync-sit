import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { REFERENCE_PROVIDER_KEYS } from './referenceKeys.js';
import { collectDoUserData } from './doGdpr.js';

interface ExportUserDataInput {
  targetUserId: string;
}

/**
 * Export all data related to a user: profile, family, appointments,
 * notifications, audit logs targeting them, guardian links/invites,
 * references/endorsements (both sides: provider and submitter), and their
 * sync-do tasks/offers with the photo paths those tasks reference.
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

    // References / endorsements (issue #295): a doc in the shared
    // `references` collection is personal data of BOTH parties — the provider
    // it names (babysitter/tutor/doer, see REFERENCE_PROVIDER_KEYS) and the
    // family member who submitted it (submittedByUserId, plus family-level
    // docs via submittedByFamilyId — endorsement text is family-authored, so
    // a parent's export includes their family's endorsements the same way it
    // includes family appointments).
    const [providerRefSnaps, submittedRefsSnap, familyRefsSnap] = await Promise.all([
      Promise.all(
        REFERENCE_PROVIDER_KEYS.map((key) =>
          db.collection('references').where(key, '==', targetUserId).get(),
        ),
      ),
      db.collection('references').where('submittedByUserId', '==', targetUserId).get(),
      familyId
        ? db.collection('references').where('submittedByFamilyId', '==', familyId).get()
        : Promise.resolve({ docs: [] } as any),
    ]);

    const references = Array.from(
      new Map(
        [
          ...providerRefSnaps.flatMap((snap) => snap.docs),
          ...submittedRefsSnap.docs,
          ...familyRefsSnap.docs,
        ].map((doc: any) => [doc.id, { id: doc.id, ...doc.data() }]),
      ).values(),
    );

    // sync-do (plan §11.4): `doTasks` + `taskOffers`, both sides — the
    // family's tasks and the doer's offers — plus the `do-photos` object
    // paths those tasks reference. See `doGdpr.collectDoUserData` for which
    // query covers which side and why the helper's data surfaces here.
    const doData = await collectDoUserData(targetUserId, familyId);

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
      references,
      doTasks: doData.tasks,
      taskOffers: doData.offers,
      doPhotoPaths: doData.photoPaths,
    };
  }
);
