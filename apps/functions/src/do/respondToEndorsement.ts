import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isEndorsementAction, type DoEndorsementAction } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { loadActiveCaller } from './offerAccess.js';
import { REFERENCES, validEndorsementId } from './endorsementAccess.js';
import { notifyDoSafely, notifyDoFamilyParents } from './notify.js';
import { buildEndorsementOutcome } from './notifyContent.js';

/**
 * `doRespondToEndorsement` (plan decision 12, §9.2, §13 PR11): the endorsed
 * doer accepts a pending endorsement (→ `approved`, visible on offer cards)
 * or declines it (→ `removed`, hidden everywhere).
 *
 * Mirrors `respondToTutorEndorsement`, including its transaction shape —
 * load → check → update atomically, so two taps cannot both pass the
 * `private` guard — and its post-commit discipline: NOTHING after the
 * transaction may reject the callable, or the doer's UI reports an error for
 * an action that succeeded and the retry then hits the status guard with
 * `failed-precondition`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: increment a denormalized
 * `profiles.doer.endorsementCount`. Study keeps one because `searchTutors`
 * renders a tutor LIST and cannot afford a per-row `references` query; sit
 * keeps none because `searchBabysitters` counts live. sync-do has no doer
 * search or list surface at all — decision 12 rules out a rating and a
 * completed-task count, and the one place endorsements are read (§9.1's
 * offer card) already issues the three per-doer queries whose results it
 * renders in full. A counter here would have no reader, and would still owe
 * the platform a decrement in `deleteUser`'s erasure path
 * (`shared-functions/admin/deleteUser.ts` does exactly that for tutors), a
 * backfill script, and a rules bound on `profiles.doer`. It does not earn
 * its place.
 *
 * VOCABULARY: sync-do says `decline`, not study's `dismiss` — the word the
 * family-facing surfaces already use for the offer path. do-core's
 * `isEndorsementAction` rejects `dismiss` explicitly so a copy-pasted study
 * payload fails loudly rather than taking an undocumented path.
 */
export const doRespondToEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as Record<string, unknown>;
    const referenceId = validEndorsementId(data.referenceId);
    if (!isEndorsementAction(data.action)) {
      throw new HttpsError('invalid-argument', 'action must be accept or decline');
    }
    const action: DoEndorsementAction = data.action;

    // Ban gate before anything else: a suspended account must not be able to
    // publish family-authored text about themselves onto a live offer card.
    const callerData = await loadActiveCaller(uid);
    const doerFirstName = (callerData.firstName as string | undefined) || null;

    const refDoc = db.collection(REFERENCES).doc(referenceId);
    const now = new Date();

    const submittedByFamilyId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(refDoc);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Endorsement not found');
      }
      const ref = snap.data()!;

      // `doerUserId` first: a sit reference or a study endorsement reaching
      // this callable must be refused as someone else's, not mis-handled.
      if (ref.doerUserId !== uid || ref.appSource !== 'do') {
        throw new HttpsError(
          'permission-denied',
          'Only the endorsed student can respond to this endorsement',
        );
      }
      if (ref.type !== 'family_submitted') {
        throw new HttpsError(
          'failed-precondition',
          'Only family-submitted endorsements can be responded to',
        );
      }
      if (ref.status !== 'private') {
        throw new HttpsError(
          'failed-precondition',
          'Endorsement is no longer pending',
          { reason: 'not_pending' },
        );
      }

      if (action === 'accept') {
        tx.update(refDoc, {
          status: 'approved',
          approvedAt: now,
          updatedAt: now,
        });
      } else {
        tx.update(refDoc, { status: 'removed', updatedAt: now });
      }

      return (ref.submittedByFamilyId as string | undefined) ?? null;
    });

    // ── Post-commit, best-effort. See the invariant above. ──
    await notifyDoSafely('respondToEndorsement', async () => {
      if (!submittedByFamilyId) return;
      await notifyDoFamilyParents(submittedByFamilyId, {
        type:
          action === 'accept'
            ? 'doer_endorsement_published'
            : 'doer_endorsement_declined',
        // An outcome the family was waiting for is `confirmed`; a decline is
        // the thing falling through, `cancelled` — the notify.ts / guardian
        // mirror mapping semantics, applied consistently.
        prefCategory: action === 'accept' ? 'confirmed' : 'cancelled',
        content: (lang) =>
          buildEndorsementOutcome(lang, { action, doerFirstName }),
        data: { referenceId },
      });
    });

    try {
      await writeUserActivity(
        uid,
        action === 'accept'
          ? 'do.endorsement_accepted'
          : 'do.endorsement_declined',
        { referenceId, submittedByFamilyId },
      );
    } catch (err) {
      // Same post-commit rule as the notify block: the status change is
      // already durable, so an audit-write failure is logged, never thrown.
      console.error('doRespondToEndorsement: audit write failed after commit:', err);
    }

    return { ok: true, referenceId, status: action === 'accept' ? 'approved' : 'removed' };
  },
);
