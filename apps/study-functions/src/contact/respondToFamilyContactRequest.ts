import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import type { StudyUser } from '@ejm/study-core';
import { respondFamilyContactRequestSchema } from '../validation/contact.js';
import { resolveNotifPref, computeEffectiveSearchable } from '@ejm/shared-core';

/**
 * respondToFamilyContactRequest (issue #207 PR4): a PARENT answers a
 * tutor-initiated contact request. Deliberately a new callable rather than a
 * branch in respondToTutorContactRequest: that one authorizes the tutor (plus
 * a decline-only guardian extension), and the two authorization models share
 * nothing but the collection name.
 *
 * Accept produces exactly the same terminal state as a tutor accepting a
 * family's request -- familyId in the tutor's approvedFamilies -- so search
 * unlock, booking and propose need no changes at all. The tutor consented by
 * initiating; the family's yes is the missing half. There is no guardian
 * branch: the responder here is a parent, not a kid.
 */
export const respondToFamilyContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = respondFamilyContactRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { requestId, action } = parsed.data;

    const requestRef = db.collection('studyContactRequests').doc(requestId);
    const now = new Date();

    // The responding parent's name is denormalized onto the request on accept
    // (the doc was minted with parentName: '' -- the tutor could not know who
    // would answer). Read outside the transaction: it is display data, not a
    // gate, and the gate below proves membership from the family doc.
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as StudyUser | undefined;
    const parentName = `${callerUser?.firstName || ''} ${callerUser?.lastName || ''}`.trim();

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Request not found');
      }
      const data = snap.data()!;
      // Only the inverted direction: a family-initiated request is the
      // tutor's to answer, through respondToTutorContactRequest.
      if (data.initiatedBy !== 'tutor') {
        throw new HttpsError('permission-denied', 'This request is not yours to answer');
      }
      const familySnap = await tx.get(db.collection('families').doc(data.familyId as string));
      const parentIds = (familySnap.data()?.parentIds as string[] | undefined) ?? [];
      if (!parentIds.includes(uid)) {
        throw new HttpsError('permission-denied', 'You are not a parent of this family');
      }
      if (data.status !== 'pending') {
        throw new HttpsError('failed-precondition', 'This request is no longer pending');
      }

      const accepted = action === 'accept';

      // Every READ first -- Firestore rejects a transaction that reads after
      // writing. Accept proves the tutor doc: this is the one accept path
      // that writes ANOTHER user's doc, and deleteUser removes users/{uid}
      // without touching studyContactRequests (PR #213 review). A bare update
      // on a missing doc rejects with an opaque `internal` and leaves the row
      // stuck pending; a deleted or deactivated tutor should read as what it
      // is. Decline needs no such check -- it never touches the tutor doc.
      const tutorRef = db.collection('users').doc(data.tutorUserId as string);
      if (accepted) {
        const tutorSnap = await tx.get(tutorRef);
        const tutorData = tutorSnap.data();
        // One reason for all three unavailability branches: to the FAMILY
        // they mean the same thing -- this tutor cannot be reached -- and
        // "retry" is never the answer (PR #213 review).
        if (!tutorSnap.exists || tutorData?.status !== 'active') {
          throw new HttpsError(
            'failed-precondition',
            'This tutor is no longer available',
            { reason: 'tutor_unavailable' },
          );
        }
        // Re-check SEARCHABLE here, not only at send: a tutor who hides
        // between sending and being accepted (or whose guardian hides them)
        // would otherwise leave the family with the dead-end links the
        // send-side gate exists to prevent -- searchTutors now filters on
        // profiles.tutor.effectiveSearchable (issue #435 PR2), and its card
        // is the family's only contact-reveal surface (PR #213 review).
        // Calls computeEffectiveSearchable LIVE on the snapshot already being
        // read here, rather than trusting the denormalized field: status was
        // just re-checked immediately above, so a false result is always
        // attributable to searchable/enrollmentComplete on this fresh read --
        // and computing live means this gate can never be tripped by the
        // trigger's write lag or a not-yet-backfilled doc.
        if (!computeEffectiveSearchable(tutorData, tutorData?.profiles?.tutor)) {
          throw new HttpsError(
            'failed-precondition',
            'This tutor is no longer available',
            { reason: 'tutor_unavailable' },
          );
        }
        // ...and that they still OFFER what the family asked for. searchTutors
        // requires searchable AND a matching subject+level, and the family's
        // post-accept surfaces are both built from this request's subject and
        // level -- so a tutor who drops the subject between sending and being
        // accepted produces the identical dead end the searchable re-check
        // exists to prevent (PR #213 review).
        const offerings = (tutorData?.profiles?.tutor?.subjects ?? []) as {
          subject: string;
          levels: string[];
        }[];
        const stillOffers = offerings.some(
          (o) => o.subject === data.subject && (o.levels ?? []).includes(data.level as string),
        );
        if (!stillOffers) {
          throw new HttpsError(
            'failed-precondition',
            'This tutor no longer offers that subject',
            { reason: 'tutor_unavailable' },
          );
        }
      }

      tx.update(requestRef, {
        status: accepted ? 'accepted' : 'declined',
        respondedAt: now,
        updatedAt: now,
        // parentUserId: the responding parent owns the name landing here —
        // createdByUserId is the TUTOR on this inverted shape, so without it
        // the name is unattributable to the identity-correction fan-out
        // (issue #273).
        ...(accepted ? { parentName, parentUserId: uid } : {}),
      });

      if (accepted) {
        // Same unlock the tutor-side accept writes, so every downstream
        // consumer (searchTutors, bookSession, proposeSession) is unchanged.
        tx.update(tutorRef, {
          'profiles.tutor.approvedFamilies': FieldValue.arrayUnion(data.familyId),
        });
      }

      return {
        tutorUserId: data.tutorUserId as string,
        familyName: (data.familyName as string) || '',
        subject: (data.subject as string) || '',
        level: (data.level as string) || '',
      };
    });

    // ── Notify the TUTOR (single recipient, honouring their notifPrefs) ──
    const tutorDoc = await db.collection('users').doc(result.tutorUserId).get();
    const tutorUser = tutorDoc.data() as StudyUser | undefined;
    const accepted = action === 'accept';
    const prefs = resolveNotifPref(
      tutorUser?.notifPrefs,
      'study',
      accepted ? 'confirmed' : 'cancelled',
    );
    const familyLabel = result.familyName || 'The family';
    const title = accepted ? 'Your request was accepted' : 'Your request was declined';
    const body = accepted
      ? `${familyLabel} accepted your request for ${result.subject} (${result.level}).`
      : `${familyLabel} declined your request for ${result.subject} (${result.level}).`;
    const emailBody = accepted
      ? `
        <p><strong>${escapeHtml(familyLabel)}</strong> accepted your request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
        <p>You can now propose a session — your contact details have been shared with them.</p>
        <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `
      : `
        <p><strong>${escapeHtml(familyLabel)}</strong> declined your request for <strong>${escapeHtml(result.subject)} (${escapeHtml(result.level)})</strong>.</p>
        <p>Other families publish searches too — the board is in the app.</p>
        <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;

    let emailSent = false;
    if (prefs.email && tutorUser?.email) {
      emailSent = await sendNotificationEmail(tutorUser.email, title, emailBody, 'study');
    }
    let pushSent = false;
    if (prefs.push) {
      pushSent = await sendPushNotification(
        result.tutorUserId,
        title,
        body,
        { requestId, type: accepted ? 'study_request_accepted' : 'study_request_declined' },
        'study',
      );
    }
    await db.collection('notifications').add({
      recipientUserId: result.tutorUserId,
      type: accepted ? 'study_request_accepted' : 'study_request_declined',
      title,
      body,
      data: { requestId },
      read: false,
      channels: ['email', 'push'],
      emailSent,
      pushSent,
      createdAt: now,
    });

    await writeUserActivity(
      uid,
      accepted ? 'family_contact_request_accepted' : 'family_contact_request_declined',
      { requestId, tutorUserId: result.tutorUserId },
    );

    return { success: true };
  },
);
