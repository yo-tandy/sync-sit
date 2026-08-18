import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { escapeHtml } from '@ejm/shared-functions/config/email.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { respondTutorEndorsementSchema } from '../validation/endorsement.js';

export const respondToTutorEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondTutorEndorsementSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid parameters',
      );
    }
    const { referenceId, action } = parsed.data;

    const refDoc = db.collection('references').doc(referenceId);

    // Load → check → update atomically. On accept we ALSO increment the tutor's
    // server-owned endorsementCount in the same transaction, so the denormalized
    // counter searchTutors reads can never drift from the reference it counts.
    // Nothing decrements here: 'removed' only happens pre-approval via dismiss
    // (which never incremented). If a future admin-moderation flow ever removes
    // an already-approved endorsement, THAT flow owns the matching decrement.
    const submittedByFamilyId = await db.runTransaction(async (tx) => {
      const snap = await tx.get(refDoc);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Endorsement not found');
      }
      const ref = snap.data()!;

      if (ref.tutorUserId !== uid) {
        throw new HttpsError('permission-denied', 'Only the endorsed tutor can respond to this endorsement');
      }
      if (ref.type !== 'family_submitted') {
        throw new HttpsError('failed-precondition', 'Only family-submitted endorsements can be responded to');
      }
      if (ref.status !== 'private') {
        throw new HttpsError('failed-precondition', 'Endorsement is no longer pending');
      }

      if (action === 'accept') {
        tx.update(refDoc, {
          status: 'approved',
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.collection('users').doc(uid), {
          'profiles.tutor.endorsementCount': FieldValue.increment(1),
        });
      } else {
        tx.update(refDoc, {
          status: 'removed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return (ref.submittedByFamilyId as string | undefined) ?? null;
    });

    await writeUserActivity(
      uid,
      action === 'accept' ? 'tutor_endorsement_accepted' : 'tutor_endorsement_dismissed',
      { referenceId, submittedByFamilyId },
    );

    // Notify the submitting family of the outcome (issue #168 Phase 0). The
    // flow is family submits -> tutor responds; without this the family never
    // learns whether their endorsement was published. Gated by each parent's
    // notifPrefs.references, branded for study. A dismissal reads neutrally —
    // it does not say the tutor rejected it.
    // Wrapped so a notify failure can never fail the callable: the transaction
    // above has already committed, and a rejection here would leave the tutor's
    // UI reporting an error for an action that succeeded (a retry then hits the
    // status guard with failed-precondition). The result must reflect the
    // committed state.
    if (submittedByFamilyId) {
      try {
        const tutorSnap = await db.collection('users').doc(uid).get();
        const tutorFirstName = (tutorSnap.data()?.firstName as string | undefined) || 'the tutor';
        // The tutor controls firstName; escape it where it crosses into email
        // HTML delivered to the family's inbox. Push/in-app title and body are
        // plain-text contexts and stay unescaped.
        const safeTutorFirstName = escapeHtml(tutorFirstName);
        if (action === 'accept') {
          await notifyAllParents({
            familyId: submittedByFamilyId,
            prefCategory: 'references',
            app: 'study',
            type: 'tutor_endorsement_published',
            title: 'Endorsement published',
            body: `Your endorsement for ${tutorFirstName} is now visible on their profile.`,
            emailSubject: `Your endorsement for ${safeTutorFirstName} is published`,
            emailBody: `<p>Your endorsement for <strong>${safeTutorFirstName}</strong> is now visible on their profile.</p>`,
            data: { referenceId },
          });
        } else {
          await notifyAllParents({
            familyId: submittedByFamilyId,
            prefCategory: 'references',
            app: 'study',
            type: 'tutor_endorsement_declined',
            title: 'Endorsement update',
            body: `Your endorsement for ${tutorFirstName} was not published.`,
            emailSubject: 'About your endorsement',
            emailBody: `<p>Your endorsement for <strong>${safeTutorFirstName}</strong> was not published.</p>`,
            data: { referenceId },
          });
        }
      } catch (err) {
        console.error('respondToTutorEndorsement: family notify failed after commit:', err);
      }
    }

    return { ok: true };
  },
);
