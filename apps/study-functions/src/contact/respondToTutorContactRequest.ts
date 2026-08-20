import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { escapeHtml, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import type { StudyUser, TutorProfile } from '@ejm/study-core';
import { respondTutorContactRequestSchema } from '../validation/contact.js';

export const respondToTutorContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondTutorContactRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { requestId, action } = parsed.data;

    const requestRef = db.collection('studyContactRequests').doc(requestId);
    const now = new Date();

    // ── Guardian auth extension (DECLINE-ONLY) ──
    // Resolve a guardian caller from a peek; the transaction below still gates
    // authoritatively. A guardian protects — they never accept on the kid's
    // behalf (accepting would share the kid's contact details).
    let guardianActor = false;
    const peek = (await requestRef.get()).data();
    const tutorUserId = (peek?.tutorUserId as string | undefined) ?? uid;
    if (peek && peek.tutorUserId !== uid && (await isActiveGuardianOf(uid, tutorUserId))) {
      if (action !== 'decline') {
        throw new HttpsError(
          'permission-denied',
          'A guardian can decline on behalf of the kid, never accept.',
          { code: 'guardian/decline-only' },
        );
      }
      guardianActor = true;
    }

    // Load → check → update atomically; on accept, also unlock the family in the
    // tutor's approvedFamilies within the same transaction. arrayUnion works
    // inside tx.update.
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Request not found');
      }
      const data = snap.data()!;
      // A TUTOR-INITIATED request is the family's to answer (issue #207 PR4).
      // Without this the tutor who opened it passes the tutorUserId check
      // below and could accept their own request -- writing the family into
      // their approvedFamilies and unlocking contact with no consent from the
      // family at all. respondToFamilyContactRequest is the only door for it.
      if (data.initiatedBy === 'tutor') {
        throw new HttpsError(
          'permission-denied',
          'This request is waiting for the family to answer',
        );
      }
      if (data.tutorUserId !== uid && !guardianActor) {
        throw new HttpsError('permission-denied', 'You are not the tutor for this request');
      }
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This request is no longer pending');
      }

      const newStatus = action === 'accept' ? 'accepted' : 'declined';
      tx.update(requestRef, { status: newStatus, respondedAt: now, updatedAt: now });

      if (action === 'accept') {
        tx.update(db.collection('users').doc(uid), {
          'profiles.tutor.approvedFamilies': FieldValue.arrayUnion(data.familyId),
        });
      }

      return { familyId: data.familyId as string, subject: data.subject as string, level: data.level as string };
    });

    // ── Notify the family (after the transaction commits) ──
    // Keyed on the TUTOR, not the caller — for a guardian decline the family
    // must see the tutor's name, never the guardian's.
    const tutorDoc = await db.collection('users').doc(tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    const tutor: TutorProfile | undefined = tutorUser?.profiles?.tutor;
    const tutorName = `${tutorUser?.firstName || ''} ${tutorUser?.lastName || ''}`.trim() || 'A tutor';

    if (action === 'accept') {
      const contactEmail = tutor?.contactEmail;
      const contactPhone = tutor?.contactPhone;
      const whatsapp = tutor?.whatsapp;
      const contactBlock = [
        contactEmail ? `<p><strong>Email:</strong> ${escapeHtml(contactEmail)}</p>` : '',
        contactPhone ? `<p><strong>Phone:</strong> ${escapeHtml(contactPhone)}</p>` : '',
        whatsapp ? `<p><strong>WhatsApp:</strong> ${escapeHtml(whatsapp)}</p>` : '',
      ].join('');

      await notifyAllParents({
        familyId: result.familyId,
        prefCategory: 'confirmed',
        app: 'study',
        type: 'study_request_accepted',
        title: 'Tutoring request accepted',
        body: `${tutorName} accepted your tutoring request.`,
        emailSubject: `Tutoring request accepted — ${tutorName}`,
        emailBody: `
          <p><strong>${escapeHtml(tutorName)}</strong> accepted your tutoring request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
          ${contactBlock}
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { requestId },
      });
    } else {
      await notifyAllParents({
        familyId: result.familyId,
        prefCategory: 'cancelled',
        app: 'study',
        type: 'study_request_declined',
        title: 'Tutoring request declined',
        body: `${tutorName} declined your tutoring request.`,
        emailSubject: `Tutoring request declined — ${tutorName}`,
        emailBody: `
          <p><strong>${escapeHtml(tutorName)}</strong> declined your tutoring request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
          <p>You can search for other available tutors.</p>
          <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
        `,
        data: { requestId },
      });
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        tutorUserId,
        'A parent of your family declined a tutoring contact request for you.',
        { requestId },
      );
    }

    await writeUserActivity(uid, action === 'accept' ? 'tutor_contact_request_accepted' : 'tutor_contact_request_declined', { requestId, ...(guardianActor ? { actorRole: 'guardian' } : {}) });

    return { success: true };
  },
);
