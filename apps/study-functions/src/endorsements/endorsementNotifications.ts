import { db } from '@ejm/shared-functions/config/firebase.js';
import { escapeHtml } from '@ejm/shared-functions/config/email.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';

export type EndorsementResponseAction = 'accept' | 'dismiss';

/**
 * Post-commit helpers for respondToTutorEndorsement. Everything here runs
 * AFTER the endorsement transaction has committed, so the invariant is:
 * nothing in this module may reject. A rejection would fail the callable for
 * an action that already succeeded — the tutor's UI shows an error and a
 * retry hits the status guard with failed-precondition. Both helpers swallow
 * their own failures with console.error; exported separately from the
 * callable so the swallowing is unit-testable.
 */

/** Best-effort audit write; never rejects. */
export async function recordEndorsementResponseActivity(
  uid: string,
  action: EndorsementResponseAction,
  referenceId: string,
  submittedByFamilyId: string | null,
): Promise<void> {
  try {
    await writeUserActivity(
      uid,
      action === 'accept' ? 'tutor_endorsement_accepted' : 'tutor_endorsement_dismissed',
      { referenceId, submittedByFamilyId },
    );
  } catch (err) {
    console.error('respondToTutorEndorsement: audit write failed after commit:', err);
  }
}

/**
 * Notify the submitting family of the outcome (issue #168 Phase 0). The flow
 * is family submits -> tutor responds; without this the family never learns
 * whether their endorsement was published. Gated by each parent's
 * notifPrefs.shared.references (issue #369 — reputation is the person's,
 * not one marketplace's), branded for study. A dismissal reads neutrally — it
 * does not say the tutor rejected it. Best-effort; never rejects.
 */
export async function notifyEndorsementOutcome(
  tutorUid: string,
  action: EndorsementResponseAction,
  referenceId: string,
  submittedByFamilyId: string,
): Promise<void> {
  try {
    const tutorSnap = await db.collection('users').doc(tutorUid).get();
    const tutorFirstName = (tutorSnap.data()?.firstName as string | undefined) || 'the tutor';
    // The tutor controls firstName; escape it where it crosses into email
    // HTML delivered to the family's inbox. The email SUBJECT is an RFC 5322
    // header (never HTML-decoded) and the push/in-app title and body are
    // plain-text contexts — those use the raw name.
    const safeTutorFirstName = escapeHtml(tutorFirstName);
    if (action === 'accept') {
      await notifyAllParents({
        familyId: submittedByFamilyId,
        prefCategory: 'references',
        app: 'study',
        type: 'tutor_endorsement_published',
        title: 'Endorsement published',
        body: `Your endorsement for ${tutorFirstName} is now visible on their profile.`,
        emailSubject: `Your endorsement for ${tutorFirstName} is published`,
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
