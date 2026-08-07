import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { hashInviteToken, newInviteToken } from '../guardian/shared.js';

/** Handoff codes live 60 seconds — long enough for one redirect, nothing else. */
const APP_HANDOFF_TTL_MS = 60_000;

const redeemInputSchema = z.object({ code: z.string().min(1).max(128) });

/**
 * ONE generic error for every way a code can be bad (malformed, unknown,
 * expired, already used, minted by a since-blocked user). The code is an
 * unauthenticated capability — its failure reason must not disclose which
 * of those it was.
 */
function invalidHandoff(): HttpsError {
  return new HttpsError(
    'not-found',
    'This link has expired. Switch apps again from the other app.',
    { code: 'handoff/invalid-code' },
  );
}

/**
 * Mint a one-time cross-app session-handoff code. The raw code travels only
 * in the response (and then in a URL fragment client-side); the doc stores
 * its sha256, same token hygiene as kidInvites.
 */
export const createAppHandoffCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const user = (await db.collection('users').doc(uid).get()).data();
    if (user?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Your account is not active.');
    }

    const code = newInviteToken();
    const now = new Date();
    await db.collection('appHandoffCodes').add({
      uid,
      tokenHash: hashInviteToken(code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + APP_HANDOFF_TTL_MS),
    });
    await writeUserActivity(uid, 'app_handoff_created', {});
    return { code };
  },
);

/**
 * Redeem a handoff code for a custom sign-in token on the other app's origin.
 * Unauthenticated by design — the code is the capability.
 */
export const redeemAppHandoffCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const parsed = redeemInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw invalidHandoff();
    }

    const snap = await db
      .collection('appHandoffCodes')
      .where('tokenHash', '==', hashInviteToken(parsed.data.code))
      .limit(1)
      .get();
    if (snap.empty) {
      throw invalidHandoff();
    }
    const ref = snap.docs[0].ref;

    // Consume in a transaction: re-read, then DELETE — the delete IS the
    // consume, so of two concurrent redeems exactly one sees the doc. An
    // already-expired doc is also deleted (opportunistic hygiene) but never
    // redeems.
    const consumed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return null;
      tx.delete(ref);
      const data = fresh.data()!;
      if (data.expiresAt.toDate().getTime() < Date.now()) return null;
      return { uid: data.uid as string };
    });
    if (!consumed) {
      throw invalidHandoff();
    }

    // The minter must still be an active user — a blocked user's pre-minted
    // code fails exactly like a bad code (they learn nothing).
    const user = (await db.collection('users').doc(consumed.uid).get()).data();
    if (user?.status !== 'active') {
      throw invalidHandoff();
    }

    const token = await adminAuth.createCustomToken(consumed.uid);
    await writeUserActivity(consumed.uid, 'app_handoff_redeemed', {});
    return { token };
  },
);
