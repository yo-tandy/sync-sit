import { HttpsError } from 'firebase-functions/v2/https';
import type { OfferDoc, OfferStatus } from '@ejm/do-core';
import { db } from '../config/firebase.js';

/**
 * Shared caller/offer plumbing for the sync-do offer callables (plan §4.2,
 * §6.2, §6.4, §8). Same charter as taskAccess.ts: everything here touches
 * firebase-admin, so it stays out of do-core (a leaf package the frontends
 * consume).
 */

/** The LIVE offer statuses — the set `offerCount` counts (§4.1). */
export const OFFER_LIVE_STATUSES: readonly OfferStatus[] = [
  'pending',
  'pending_guardian',
];

/**
 * Charset-bound a caller-supplied offerId BEFORE it reaches `.doc()` — the
 * validTaskId rationale (a `/` addresses an arbitrary subcollection).
 * `offerId == `${taskId}_${doerUserId}`` (§4.2): both halves are safe-charset
 * ids, so the composite fits the same class, just longer.
 */
export function validOfferId(offerId: unknown): string {
  if (
    typeof offerId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,260}$/.test(offerId)
  ) {
    throw new HttpsError('invalid-argument', 'offerId is required');
  }
  return offerId;
}

/** Read a caller's user doc and enforce the platform ban gate. */
export async function loadActiveCaller(
  uid: string,
): Promise<Record<string, unknown>> {
  const callerDoc = await db.collection('users').doc(uid).get();
  const callerData = (callerDoc.data() ?? {}) as Record<string, unknown>;
  if ((callerData.status as string | undefined) !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active');
  }
  return callerData;
}

/**
 * The doer's photo for the §4.2 offer-card denormalization: canonical root
 * `photoUrl` first (issue #203's shared-identity direction), falling back to
 * the sit/study profile copies a cross-app account may still carry — the
 * same root-??-profile resolution shape `getContact` uses for the contact
 * trio. Name, photo and bio are the WHOLE pre-acceptance disclosure (§6.4):
 * nothing that locates the student.
 */
export function resolveDoerPhotoUrl(
  callerData: Record<string, unknown>,
): string | null {
  const root = callerData.photoUrl;
  if (typeof root === 'string' && root.length > 0) return root;
  const profiles = (callerData.profiles ?? {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  for (const key of ['babysitter', 'tutor'] as const) {
    const v = profiles[key]?.photoUrl;
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** Firestore Timestamp | Date → epoch ms (0 when absent/unreadable). */
export function tsMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number; toDate?: () => Date } | null;
  if (v?.toMillis) return v.toMillis();
  if (v?.toDate) return v.toDate().getTime();
  return 0;
}

/** Read an offer or throw not-found. */
export async function getOfferOrThrow(
  offerId: unknown,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: OfferDoc }> {
  const ref = db.collection('taskOffers').doc(validOfferId(offerId));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Offer not found');
  }
  return { ref, data: snap.data() as OfferDoc };
}
