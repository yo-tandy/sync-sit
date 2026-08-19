import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import { getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile } from '@ejm/study-core';
import { submitTutorEndorsementSchema } from '../validation/endorsement.js';

export const submitTutorEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = submitTutorEndorsementSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid endorsement parameters',
      );
    }
    const { tutorUserId, referenceText, refName, subject } = parsed.data;

    // ── Caller gate: parent in a family. NO verified-family requirement — the
    // approvedFamilies membership below is a stronger relationship gate. ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as User | undefined;
    const callerParent = getParentProfile(callerUser);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents in a family can submit endorsements');
    }
    const familyId = callerParent.familyId;

    // ── Not-self ──
    if (tutorUserId === uid) {
      throw new HttpsError('invalid-argument', 'Cannot endorse yourself');
    }

    // ── Tutor profile must exist ──
    const tutorDoc = await db.collection('users').doc(tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    const tutor: TutorProfile | undefined = tutorUser?.profiles?.tutor;
    if (!tutorDoc.exists || !tutor) {
      throw new HttpsError('not-found', 'Tutor not found');
    }

    // ── Relationship gate: family must have an accepted contact request ──
    if (!(tutor.approvedFamilies || []).includes(familyId)) {
      throw new HttpsError('permission-denied', 'Endorsements require an accepted contact request');
    }

    // ── Dedup: one endorsement per (family, tutor). Equality filters only. ──
    const dup = await db.collection('references')
      .where('appSource', '==', 'study')
      .where('tutorUserId', '==', tutorUserId)
      .where('submittedByFamilyId', '==', familyId)
      .limit(1)
      .get();
    if (!dup.empty) {
      throw new HttpsError('already-exists', 'You have already endorsed this tutor');
    }

    // ── Write the endorsement into the shared references collection, keyed by
    // tutorUserId + appSource:'study' (NO babysitterUserId). The sit trigger
    // notifyOnNewReference early-returns for such docs
    // (apps/functions/src/references/onReferenceCreated.ts:19-20), so we notify
    // the tutor inline below rather than relying on it. ──
    const familySnap = await db.collection('families').doc(familyId).get();
    const isEjmFamily = !!familySnap.data()?.verification?.isFullyVerified;
    const submittedByName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();

    const refDoc = db.collection('references').doc();
    const payload: Record<string, unknown> = {
      referenceId: refDoc.id,
      type: 'family_submitted',
      appSource: 'study',
      status: 'private',
      tutorUserId,
      submittedByUserId: uid,
      submittedByFamilyId: familyId,
      submittedByName,
      refName: refName.trim(),
      referenceText: referenceText.trim(),
      subject: subject ?? null,
      isEjmFamily,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await refDoc.set(payload);

    // ── Notify the tutor inline (see trigger note above) ──
    const refsPrefs = tutorUser?.notifPrefs?.references || { push: true, email: true };
    const submitterLabel = submittedByName || refName.trim() || 'A family';
    const now = new Date();
    // Record the actual send outcomes, not assumptions.
    let emailSent = false;
    if (refsPrefs.email !== false && tutorUser?.email) {
      emailSent = await sendNotificationEmail(
        tutorUser.email,
        `New endorsement from ${submitterLabel}`,
        `
          <p><strong>${escapeHtml(submitterLabel)}</strong> has submitted an endorsement for you on Sync/Study.</p>
          <p>Review it on your Endorsements page and choose whether to publish it on your profile.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor/endorsements" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Endorsements</a></p>
        `,
        'study',
      );
    }
    let pushSent = false;
    if (refsPrefs.push !== false) {
      pushSent = await sendPushNotification(
        tutorUserId,
        'New endorsement received',
        `${submitterLabel} has submitted an endorsement for you.`,
        { referenceId: refDoc.id, type: 'tutor_endorsement_received' },
        'study',
      );
    }
    await db.collection('notifications').add({
      recipientUserId: tutorUserId,
      type: 'tutor_endorsement_received',
      title: 'New endorsement received',
      body: `${submitterLabel} has submitted an endorsement for you.`,
      data: { referenceId: refDoc.id },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(uid, 'tutor_endorsement_submitted', { tutorUserId, referenceId: refDoc.id });

    return { referenceId: refDoc.id };
  },
);
