import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ageFromDob } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { requireFamilyParent } from './shared.js';
import { iso, profileSummary } from './oversight.js';

/**
 * The supervising family's dashboard: every guardian link of the family (any
 * status — a pending claim shows as "awaiting the kid's confirmation", a
 * revoked link stays visible as a labelled row) plus the family's un-redeemed
 * pending invites. The list reveals only what the family already knows;
 * consent-gated depth lives in getGovernedChildDetail.
 */
export const getGovernedChildren = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const { familyId } = await requireFamilyParent(request.auth.uid);

    // Single-field equality — no composite index needed.
    const linksSnap = await db.collection('guardianLinks').where('familyId', '==', familyId).get();

    const today = new Date().toISOString().slice(0, 10);
    const windowEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const children = await Promise.all(
      linksSnap.docs.map(async (linkDoc) => {
        const link = linkDoc.data();
        const childUid = link.childUid as string;
        const child = (await db.collection('users').doc(childUid).get()).data() ?? {};
        const dob = child.dateOfBirth?.toDate?.() ?? null;

        return {
          childUid,
          firstName: child.firstName ?? null,
          lastName: child.lastName ?? null,
          photoUrl: child.photoUrl ?? null,
          status: child.status ?? null,
          age: dob ? ageFromDob(dob) : null,
          link: {
            status: link.status,
            origin: link.origin,
            requestedAt: iso(link.requestedAt),
            confirmedAt: iso(link.confirmedAt),
            revokedAt: iso(link.revokedAt),
          },
          profiles: {
            babysitter: profileSummary(child.profiles?.babysitter),
            tutor: profileSummary(child.profiles?.tutor),
          },
          upcoming: await upcomingCounts(childUid, today, windowEnd),
        };
      }),
    );
    children.sort((a, b) => (a.firstName ?? '').localeCompare(b.firstName ?? ''));

    // Equality-only filters (familyId + status) — served by merged single-field
    // indexes, no composite needed. Non-pending invites are history, not rows.
    const invitesSnap = await db
      .collection('kidInvites')
      .where('familyId', '==', familyId)
      .where('status', '==', 'pending')
      .get();
    const invites = invitesSnap.docs.map((d) => {
      const inv = d.data();
      return {
        inviteId: d.id,
        kidEmail: inv.kidEmailLower,
        firstName: inv.firstName,
        lastName: inv.lastName,
        status: inv.status,
        createdAt: iso(inv.createdAt),
        expiresAt: iso(inv.expiresAt),
        resentAt: iso(inv.resentAt),
      };
    });

    return { children, invites };
  },
);

/**
 * Confirmed commitments in [today, today+30d]. Sit has no composite index on
 * (babysitterUserId, status, date), so that query stays equality-only and the
 * date window is filtered in memory (bounded by one child's appointments).
 * Study reuses the existing (tutorUserId, status, date) composite indexes on
 * study-sessions and the instances collection group — no new indexes.
 */
async function upcomingCounts(childUid: string, today: string, windowEnd: string) {
  const [aptSnap, oneTimeSnap, instancesSnap] = await Promise.all([
    db
      .collection('appointments')
      .where('babysitterUserId', '==', childUid)
      .where('status', '==', 'confirmed')
      .get(),
    db
      .collection('study-sessions')
      .where('tutorUserId', '==', childUid)
      .where('status', '==', 'confirmed')
      .where('date', '>=', today)
      .where('date', '<=', windowEnd)
      .get(),
    db
      .collectionGroup('instances')
      .where('tutorUserId', '==', childUid)
      .where('status', '==', 'scheduled')
      .where('date', '>=', today)
      .where('date', '<=', windowEnd)
      .get(),
  ]);
  const sitAppointments = aptSnap.docs.filter((d) => {
    const date = d.data().date;
    return typeof date === 'string' && date >= today && date <= windowEnd;
  }).length;
  return { sitAppointments, studySessions: oneTimeSnap.size + instancesSnap.size };
}
