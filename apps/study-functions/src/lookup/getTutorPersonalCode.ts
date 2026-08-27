import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import type { StudyUser, TutorProfile } from '@ejm/study-core';

// How many fresh random candidates to try when one collides. With 8 hex
// chars (2^32 values) a single collision is already ~vanishingly unlikely at
// any plausible tutor population; five misses in a row means something is
// systematically wrong (broken RNG, a flooded collection) and deserves an
// error over an infinite loop.
const MAX_MINT_ATTEMPTS = 5;

/**
 * getTutorPersonalCode (issue #235, parity A2): returns the caller's stable
 * personal code, minting one on first call.
 *
 * The code is the study twin of sit's "add a babysitter you already know"
 * entry point: a tutor hands it to a family offline, and the family resolves
 * it via lookupTutor instead of hunting through search results.
 *
 * Design decisions, and why they sit here:
 * - SERVER-minted, never client-chosen. profiles.tutor.personalCode is
 *   pinned immutable against owner writes in firestore.rules
 *   (tutorIdentityUnchanged) for the same reason: a client picking its own
 *   code could squat a memorable one, or deliberately collide with another
 *   tutor's to hijack their offline referrals.
 * - 8 hex chars, not the community code's 6: community codes expire in 24h,
 *   this one is PERMANENT, so it gets a larger space against idle
 *   enumeration (every lookup is authenticated, verified-family-gated and
 *   audit-logged besides — see lookupTutor).
 * - NOT gated on `searchable`. The visibility gate lives in lookupTutor at
 *   RESOLVE time (sit's fix/lookup-babysitter-searchable lesson: check the
 *   flag when it matters, not only when the artifact was created). Gating
 *   the mint too would buy nothing — the tutor could mint while visible and
 *   hide afterwards — while making the account page's code section flicker
 *   with the toggle. The account page instead warns a hidden tutor that
 *   their code will not resolve.
 * - Mint-on-first-read (no enrollment backfill): existing tutors get a code
 *   the first time they open the account page, new tutors likewise. One
 *   mint path to reason about.
 */
export const getTutorPersonalCode = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as StudyUser | undefined;
    if (!callerDoc.exists || callerUser?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Only active tutors have a personal code');
    }
    const tutor: TutorProfile | undefined = callerUser.profiles?.tutor;
    if (!tutor) {
      throw new HttpsError('permission-denied', 'Only tutors have a personal code');
    }
    if (!tutor.enrollmentComplete) {
      throw new HttpsError('failed-precondition', 'Complete your tutor enrollment first');
    }

    // Already minted: idempotent fast path.
    if (tutor.personalCode) {
      return { code: tutor.personalCode };
    }

    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
      const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();

      // Cross-tutor uniqueness: lookupTutor resolves by equality query, so a
      // duplicated code would make BOTH tutors unresolvable (lookupTutor
      // treats an ambiguous match as not-found rather than guessing). The
      // check-then-write is not transactional — Firestore transactions
      // cannot carry a query — but the 2^32 space makes the race window
      // (two tutors minting the same candidate in the same instant)
      // negligible, and the failure mode is the safe one above, not a
      // privilege leak.
      const clash = await db.collection('users')
        .where('profiles.tutor.personalCode', '==', candidate)
        .limit(1)
        .get();
      if (!clash.empty) continue;

      // SELF-race (two tabs minting concurrently) is the realistic one, and
      // it would strand one tab holding a code the doc no longer carries. A
      // transaction on the caller's own doc closes it: whoever writes first
      // wins, the loser returns the winner's code.
      const code = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(db.collection('users').doc(uid));
        const existing = (fresh.data() as StudyUser | undefined)?.profiles?.tutor?.personalCode;
        if (existing) return existing;
        tx.update(db.collection('users').doc(uid), {
          'profiles.tutor.personalCode': candidate,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return candidate;
      });

      if (code === candidate) {
        await writeUserActivity(uid, 'tutor_personal_code_generated', { code });
      }
      return { code };
    }

    throw new HttpsError('internal', 'Could not generate a code — please try again');
  },
);
