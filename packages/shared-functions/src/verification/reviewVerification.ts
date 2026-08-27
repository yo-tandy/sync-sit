import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';

interface ReviewInput {
  verificationId: string;
  decision: 'approved' | 'rejected';
  rejectionReason?: string;
}

export const reviewVerification = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { verificationId, decision, rejectionReason } = request.data as ReviewInput;

    if (!verificationId || !decision) {
      throw new HttpsError('invalid-argument', 'Missing verificationId or decision');
    }

    if (decision === 'rejected' && !rejectionReason) {
      throw new HttpsError('invalid-argument', 'Rejection reason is required');
    }

    const verificationRef = db.collection('verifications').doc(verificationId);
    const verificationDoc = await verificationRef.get();

    if (!verificationDoc.exists) {
      throw new HttpsError('not-found', 'Verification not found');
    }

    const verificationData = verificationDoc.data()!;
    const familyId = verificationData.familyId;

    // Legacy docs from the retired tutor_identity flow have no familyId.
    // Refuse them BEFORE any mutation: without this, the doc would be
    // approved/rejected and the family recompute below would then throw on
    // an undefined familyId, leaving a mutated doc with no audit entry.
    if (!familyId) {
      throw new HttpsError(
        'failed-precondition',
        'This verification is not linked to a family and cannot be reviewed',
      );
    }

    // Update verification doc
    const now = new Date();
    await verificationRef.update({
      status: decision,
      reviewedByAdminId: request.auth.uid,
      reviewedAt: now,
      ...(decision === 'rejected' && { rejectionReason }),
    });

    // Recompute family verification status
    const allVerifications = await db.collection('verifications')
      .where('familyId', '==', familyId)
      .get();

    let identityStatus: string = 'not_submitted';
    let enrollmentStatus: string = 'not_submitted';
    let isEjmFamily = false;
    // When each type's contributing rejection was decided — feeds the
    // pre/post-grant ordering below. The doc being decided RIGHT NOW is
    // stamped Infinity: this review is by construction after any grant.
    let identityRejectedAtMs: number | null = null;
    let enrollmentRejectedAtMs: number | null = null;

    const reviewedAtMs = (d: Record<string, unknown>): number | null => {
      const v = d.reviewedAt as { toMillis?: () => number } | Date | undefined;
      if (!v) return null;
      if (v instanceof Date) return v.getTime();
      return typeof v.toMillis === 'function' ? v.toMillis() : null;
    };

    for (const doc of allVerifications.docs) {
      const d = doc.data();
      const isCurrent = doc.id === verificationId;
      const docStatus = isCurrent ? decision : d.status;
      const rejMs = isCurrent ? Infinity : reviewedAtMs(d);

      if (d.type === 'identity') {
        if (docStatus === 'approved') identityStatus = 'approved';
        else if (docStatus === 'pending' && identityStatus !== 'approved') identityStatus = 'pending';
        else if (docStatus === 'rejected' && identityStatus === 'not_submitted') {
          identityStatus = 'rejected';
          identityRejectedAtMs = rejMs;
        }
      }

      if (d.type === 'ejm_enrollment') {
        if (docStatus === 'approved') {
          enrollmentStatus = 'approved';
          isEjmFamily = true;
        }
        else if (docStatus === 'pending' && enrollmentStatus !== 'approved') enrollmentStatus = 'pending';
        else if (docStatus === 'rejected' && enrollmentStatus === 'not_submitted') {
          enrollmentStatus = 'rejected';
          enrollmentRejectedAtMs = rejMs;
        }
      }
    }

    // A community approval vouches for BOTH types (approveCommunityCode sets
    // them together), so it is a verification in its own right — not a
    // placeholder that documents overwrite. Recomputing from documents alone
    // would revoke it for any type the family has no live document for: the
    // family re-uploads next year's enrollment certificate, an admin approves
    // it, and their identity standing silently reverts to not_submitted.
    //
    // So the grant is the baseline, and documents only move a type off it when
    // an admin actually DECIDED that type after the grant. Two consequences,
    // both of which cost a bug to learn (PR #220 review):
    //
    // - `pending` is not a decision. A live pending doc of the OTHER type used
    //   to skip the baseline, dropping a community-verified family to
    //   isFullyVerified: false (and clearing isEjmFamily) for the whole window
    //   between upload and review — an outcome no admin chose.
    // - `rejected` is a decision, but only a POST-grant one counts. A
    //   rejection that predates the grant was already overridden by it. The
    //   ordering is explicit: the grant stamps communityApprovedAt, and a
    //   rejection whose reviewedAt predates it is treated as undecided here.
    //   supersedeOpenVerifications closes pre-grant docs at grant time too,
    //   but the recompute must not LEAN on that write having succeeded — it
    //   is deliberately non-fatal in approveCommunityCode, and a swallowed
    //   failure there must degrade to a stale queue entry, not to a family
    //   silently un-verified by a later approval (PR #220 review).
    //
    //   Legacy grants (pre-#220, no communityApprovedAt) fall back to the
    //   supersede-based ordering: a surviving rejection wins. A rejection
    //   with no readable reviewedAt is treated as post-grant — failing
    //   toward "the admin's decision stands" on the side that gates access.
    //
    //   Known limit, deliberate: a POST-grant rejection is durable only
    //   while its row survives. submitVerification deletes all prior docs of
    //   a type on re-upload, so a family can replace a post-grant-rejected
    //   doc and the grant then covers the type again while the replacement
    //   awaits review. The grant DID vouch for that type independently, so
    //   this is accepted rather than accidental; revisit if re-upload churn
    //   becomes an abuse pattern.
    const familyRef = db.collection('families').doc(familyId);
    const priorVerification = (await familyRef.get()).data()?.verification;
    const communityApprovedBy = priorVerification?.communityApprovedBy;
    const grantAt = priorVerification?.communityApprovedAt as
      | { toMillis?: () => number }
      | Date
      | undefined;
    const grantAtMs =
      grantAt instanceof Date
        ? grantAt.getTime()
        : typeof grantAt?.toMillis === 'function'
          ? grantAt.toMillis()
          : null;

    // "No post-grant admin decision for this type": never decided, decided
    // by nobody yet (pending), or decided BEFORE the grant that overrode it.
    const undecided = (s: string, rejMs: number | null) =>
      s === 'not_submitted' ||
      s === 'pending' ||
      (s === 'rejected' && grantAtMs !== null && rejMs !== null && rejMs < grantAtMs);

    if (communityApprovedBy) {
      if (undecided(identityStatus, identityRejectedAtMs)) identityStatus = 'approved';
      if (undecided(enrollmentStatus, enrollmentRejectedAtMs)) {
        enrollmentStatus = 'approved';
        isEjmFamily = true;
      }
    }

    const isFullyVerified = identityStatus === 'approved' && enrollmentStatus === 'approved';

    await familyRef.update({
      verification: {
        identityStatus,
        enrollmentStatus,
        isFullyVerified,
        isEjmFamily,
        // Carrying these forward is what keeps the grant durable across
        // repeated document rounds — communityApprovedAt included, or the
        // ordering above would be lost on the first recompute.
        ...(communityApprovedBy ? { communityApprovedBy } : {}),
        ...(communityApprovedBy && priorVerification?.communityApprovedAt
          ? { communityApprovedAt: priorVerification.communityApprovedAt }
          : {}),
      },
    });

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: decision === 'approved' ? 'approve_verification' : 'reject_verification',
      targetUserId: verificationData.uploadedByUserId,
      details: { verificationId, type: verificationData.type, decision, rejectionReason: rejectionReason || null },
    });

    return { success: true, isFullyVerified };
  }
);
