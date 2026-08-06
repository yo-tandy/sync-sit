import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ageFromDob } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { GUARDIAN_SUCCESS } from './shared.js';
import { iso } from './oversight.js';

/**
 * The admin GDPR audit view: EVERY guardian link (any status — revoked links
 * remain auditable consent records) joined with the child summary and the
 * supervising family's name. Full-collection scan: guardianLinks is bounded
 * by the number of supervised accounts (hundreds at most at EJM scale), so a
 * scan is fine and needs no index.
 */
export const listSupervisedAccounts = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const linksSnap = await db.collection('guardianLinks').get();
    const accounts = await Promise.all(
      linksSnap.docs.map(async (linkDoc) => {
        const link = linkDoc.data();
        const [childSnap, familySnap] = await Promise.all([
          db.collection('users').doc(link.childUid as string).get(),
          db.collection('families').doc(link.familyId as string).get(),
        ]);
        const child = childSnap.data() ?? {};
        const dob = child.dateOfBirth?.toDate?.() ?? null;
        return {
          childUid: link.childUid,
          child: {
            firstName: child.firstName ?? null,
            lastName: child.lastName ?? null,
            email: child.email ?? null,
            status: child.status ?? null,
            age: dob ? ageFromDob(dob) : null,
            identityLocked: child.identityLocked === true,
          },
          familyId: link.familyId,
          familyName: familySnap.data()?.familyName ?? null,
          link: {
            status: link.status,
            origin: link.origin,
            createdByParentUid: link.createdByParentUid,
            requestedAt: iso(link.requestedAt),
            confirmedAt: iso(link.confirmedAt),
            revokedAt: iso(link.revokedAt),
            revokedByUid: link.revokedByUid ?? null,
          },
          consent: {
            tosVersion: link.consent?.tosVersion ?? null,
            privacyVersion: link.consent?.privacyVersion ?? null,
            supervisionAgreementVersion: link.consent?.supervisionAgreementVersion ?? null,
            approvedAt: iso(link.consent?.approvedAt),
            approvedByUid: link.consent?.approvedByUid ?? null,
          },
        };
      }),
    );
    accounts.sort((a, b) => String(a.familyName ?? '').localeCompare(String(b.familyName ?? '')));
    return { accounts };
  },
);

/**
 * The governance alert queue (conflicting claims, identity mismatches,
 * orphaned minors, forced revocations). Full scan + in-memory filter — an
 * "unreviewed" filter on a missing field cannot be a Firestore query anyway.
 */
export const listAdminAlerts = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);
    const { onlyUnreviewed } = request.data as { onlyUnreviewed?: boolean };

    const snap = await db.collection('adminAlerts').get();
    const alerts = snap.docs
      .filter((d) => !onlyUnreviewed || !d.data().reviewedAt)
      .map((d) => {
        const a = d.data();
        return {
          alertId: d.id,
          type: a.type,
          data: a.data ?? {},
          createdAt: iso(a.createdAt),
          reviewedAt: iso(a.reviewedAt),
          reviewedByUid: a.reviewedByUid ?? null,
        };
      })
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return { alerts };
  },
);

/** Mark an alert handled. Rules keep adminAlerts client-read-only; this callable is the only write path. */
export const reviewAdminAlert = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);
    const { alertId } = request.data as { alertId?: string };
    if (!alertId || typeof alertId !== 'string') {
      throw new HttpsError('invalid-argument', 'alertId is required');
    }
    const ref = db.collection('adminAlerts').doc(alertId);
    if (!(await ref.get()).exists) {
      throw new HttpsError('not-found', 'Alert not found');
    }
    await ref.update({ reviewedAt: new Date(), reviewedByUid: request.auth.uid });
    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'guardian.review_admin_alert',
      details: { alertId },
    });
    return GUARDIAN_SUCCESS;
  },
);
