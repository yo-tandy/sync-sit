import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { buildMergedOverride } from '@ejm/shared-functions/schedule/sessionOverride.js';
import {
  isActiveGuardianOf,
  notifyChildOfGuardianAction,
} from '@ejm/shared-functions/guardian/guardianAccess.js';
import { SIT_APP_URL } from '@ejm/shared-functions';

/** sit stamps the override docs it creates so its cancel can restore losslessly. */
const SIT_PROVENANCE = { appSource: 'sit', reason: 'appointment' } as const;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface RespondData {
  appointmentId: string;
  action: 'accept' | 'decline';
  blockSchedule?: boolean;
}

export const respondToRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const data = request.data as RespondData;

    if (!data.appointmentId || !data.action) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const appointmentRef = db.collection('appointments').doc(data.appointmentId);
    const appointmentSnap = await appointmentRef.get();

    if (!appointmentSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const appointment = appointmentSnap.data()!;

    // ── Who may respond depends on WHO INITIATED (issue #207 PR3) ──
    // A babysitter-initiated appointment (contactPublishedSearch: the sitter
    // answered the family's published search) is answered by the FAMILY; the
    // babysitter/guardian gate below does not apply to it, and the sitter
    // cannot answer their own request. Everything else is the original
    // family-initiated flow, untouched.
    const familyInitiatedFlow = appointment.initiatedBy !== 'babysitter';
    let guardianActor = false;
    let familyActor = false;
    let familyData: FirebaseFirestore.DocumentData | undefined;

    if (!familyInitiatedFlow) {
      const familySnap = await db.collection('families').doc(appointment.familyId as string).get();
      familyData = familySnap.data();
      const parentIds: string[] = (familyData?.parentIds as string[]) || [];
      if (!parentIds.includes(uid)) {
        throw new HttpsError(
          'permission-denied',
          'Only a parent of this family can respond to this request',
        );
      }
      familyActor = true;
    } else if (appointment.babysitterUserId !== uid) {
      // Verify the caller is the babysitter for this appointment, else a
      // GUARDIAN of the babysitter — DECLINE-ONLY: a guardian protects, they
      // never accept a commitment on the kid's behalf.
      if (await isActiveGuardianOf(uid, appointment.babysitterUserId as string)) {
        if (data.action !== 'decline') {
          throw new HttpsError(
            'permission-denied',
            'A guardian can decline on behalf of the kid, never accept.',
            { code: 'guardian/decline-only' },
          );
        }
        guardianActor = true;
      } else {
        throw new HttpsError('permission-denied', 'You are not the babysitter for this appointment');
      }
    }

    console.log(`[respondToRequest] aptId=${data.appointmentId} action=${data.action} status=${appointment.status} familyId=${appointment.familyId}`);

    if (appointment.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This appointment is no longer pending');
    }

    const now = new Date();

    // ── FAMILY RESPONDER BRANCH (issue #207 PR3) ──────────────────────────
    // Only reachable for a babysitter-initiated appointment (the gate above
    // proved the caller is a parent of its family). It returns early so the
    // family-initiated flow below stays exactly as it was.
    //
    // ACCEPT is where the withheld family PII is disclosed: contactPublishedSearch
    // minted the pending appointment with address/latLng/pets/familyNote/
    // familyPhotoUrl all null, because any active babysitter can initiate. The
    // family's yes is the consent, so the accept fills them in and the doc
    // reaches the SAME terminal state a family-initiated accept reaches
    // (status confirmed + confirmedAt + updatedAt).
    //
    // The babysitter's schedule is deliberately NOT blocked: `blockSchedule`
    // is the babysitter's own choice about their own calendar, and no family
    // may make it for them.
    if (familyActor) {
      const babysitterDoc = await db
        .collection('users')
        .doc(appointment.babysitterUserId as string)
        .get();
      const babysitterUser = babysitterDoc.data() || {};
      const familyName = (familyData?.familyName as string) || (appointment.familyName as string) || 'The family';

      const dateDisplay = appointment.date
        ? `${appointment.date}${appointment.startTime ? ` at ${appointment.startTime}` : ''}${appointment.endTime ? `–${appointment.endTime}` : ''}`
        : 'Recurring schedule';

      const accepted = data.action === 'accept';

      if (accepted) {
        await appointmentRef.update({
          status: 'confirmed',
          confirmedAt: now,
          updatedAt: now,
          // Disclosed on consent — see the block comment above.
          address: (familyData?.address as string) ?? null,
          latLng: (familyData?.latLng as unknown) ?? null,
          pets: (familyData?.pets as string) ?? null,
          familyNote: (familyData?.note as string) ?? null,
          familyPhotoUrl: (familyData?.photoUrl as string) ?? null,
        });
        // The slot is filled: take the search off the board so no further
        // sitters answer it (PR #212 review). Sibling pendings already minted
        // stay for the family to answer -- the family-initiated flow has the
        // same "several requests out, family decides" shape, so declining
        // them is their call, not ours. Withdraw is a delete, matching the
        // family's own withdraw button; a missing doc is fine (expired or
        // already withdrawn).
        const searchId = appointment.publishedSearchId as string | undefined;
        if (searchId) {
          await db.collection('publishedSearches').doc(searchId).delete().catch(() => {});
        }
      } else {
        await appointmentRef.update({
          status: 'rejected',
          // Distinct from 'declined_by_babysitter': the two directions must be
          // tellable apart in history and in the UI.
          statusReason: 'declined_by_family',
          updatedAt: now,
        });
      }

      // Notify the BABYSITTER — single recipient, mirroring
      // sendContactRequest.ts:144-176 for the inverted direction.
      const title = accepted ? 'Your request was accepted' : 'Your request was declined';
      const body = accepted
        ? `${familyName} accepted your request for ${dateDisplay}.`
        : `${familyName} declined your request for ${dateDisplay}.`;
      const emailBody = accepted
        ? `
        <p><strong>${escapeHtml(familyName)}</strong> accepted your request for <strong>${escapeHtml(dateDisplay)}</strong>.</p>
        <p>The address and the family's details are now visible in the app.</p>
        <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `
        : `
        <p><strong>${escapeHtml(familyName)}</strong> declined your request for <strong>${escapeHtml(dateDisplay)}</strong>.</p>
        <p>Other families publish searches too — have a look at the published searches board.</p>
        <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;
      const prefCategory = accepted ? 'confirmed' : 'cancelled';
      const notifType = accepted ? 'published_search_accepted' : 'published_search_declined';

      // Record the actual send outcomes, not assumptions.
      let emailSent = false;
      if (babysitterUser.notifPrefs?.[prefCategory]?.email !== false && babysitterUser.email) {
        emailSent = await sendNotificationEmail(babysitterUser.email as string, title, emailBody);
      }
      let pushSent = false;
      if (babysitterUser.notifPrefs?.[prefCategory]?.push !== false) {
        pushSent = await sendPushNotification(
          appointment.babysitterUserId as string,
          title,
          body,
          { appointmentId: data.appointmentId, type: notifType },
        );
      }
      await db.collection('notifications').add({
        recipientUserId: appointment.babysitterUserId,
        type: notifType,
        title,
        body,
        data: { appointmentId: data.appointmentId },
        read: false,
        channels: ['email', 'push'],
        emailSent,
        pushSent,
        createdAt: now,
      });

      await writeUserActivity(
        uid,
        accepted ? 'appointment_accepted' : 'appointment_declined',
        { appointmentId: data.appointmentId, actorRole: 'family' },
      );

      return { success: true };
    }

    if (data.action === 'accept') {
      await appointmentRef.update({
        status: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
      });

      // Block schedule if requested (one-time only). The claim ANDs the
      // appointment's slots to false in the babysitter's date override AND
      // records a restorable `sessionBlocks` ledger entry (buildMergedOverride,
      // shared with study). This makes the claim per-slot (not a whole-day
      // 'unavailable' block) and lossslessly reversible by cancelAppointment, and
      // lets it coexist with a study claim in one doc for a dual-role uid.
      if (data.blockSchedule && appointment.date && appointment.startTime && appointment.endTime) {
        const startIdx = timeToSlotIndex(appointment.startTime);
        const endIdx = timeToSlotIndex(appointment.endTime);
        const scheduleRef = db.collection('schedules').doc(uid);
        const overrideRef = scheduleRef.collection('overrides').doc(appointment.date);

        // The babysitter's weekly grid for this date's weekday is the merge base
        // for a day with no prior override (mirrors searchBabysitters' day-key
        // derivation). Static config → read once, outside the override tx.
        const scheduleSnap = await scheduleRef.get();
        const dayKey = DAY_KEYS[new Date(`${appointment.date}T00:00:00`).getDay()];
        const weeklySlots: boolean[] = scheduleSnap.data()?.weekly?.[dayKey] ?? [];

        await db.runTransaction(async (tx) => {
          const snap = await tx.get(overrideRef);
          const existing = snap.exists ? snap.data()! : null;
          const merged = buildMergedOverride({
            existing,
            date: appointment.date,
            weeklySlots,
            block: { start: startIdx, end: endIdx },
            entry: { appointmentId: data.appointmentId, startIdx, endIdx },
            ownProvenance: SIT_PROVENANCE,
            now,
          });
          tx.set(overrideRef, merged);
        });
      }

      // Send confirmation notification to family
      const babysitterDoc = await db.collection('users').doc(uid).get();
      const babysitterUser = babysitterDoc.data()!;
      const babysitterName = `${babysitterUser.firstName} ${babysitterUser.lastName}`;

      const dateDisplay = appointment.date
        ? `${appointment.date}${appointment.startTime ? ` at ${appointment.startTime}` : ''}${appointment.endTime ? `–${appointment.endTime}` : ''}`
        : 'Recurring schedule';

      const contactInfo = babysitterUser.email
        ? `<p><strong>Email:</strong> ${escapeHtml(babysitterUser.email)}</p>`
        : '';
      const phoneInfo = babysitterUser.phone
        ? `<p><strong>Phone:</strong> ${escapeHtml(babysitterUser.phone)}</p>`
        : '';

      const acceptEmailBody = `
        <p><strong>${escapeHtml(babysitterName)}</strong> has accepted your babysitting request for <strong>${escapeHtml(dateDisplay)}</strong>.</p>
        ${contactInfo}
        ${phoneInfo}
        <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;

      if (appointment.familyId) {
        await notifyAllParents({
          familyId: appointment.familyId,
          prefCategory: 'confirmed',
          type: 'request_accepted',
          title: 'Babysitting confirmed',
          body: `${babysitterName} has accepted your babysitting request.`,
          emailSubject: `Babysitting confirmed — ${babysitterName}`,
          emailBody: acceptEmailBody,
          data: { appointmentId: data.appointmentId },
        });
      }

    } else {
      // Decline
      await appointmentRef.update({
        status: 'rejected',
        statusReason: 'declined_by_babysitter',
        updatedAt: now,
      });

      // Load babysitter name for notification — keyed on the BABYSITTER, not
      // the caller, so a guardian decline shows the kid's name to the family.
      const babysitterDoc = await db
        .collection('users')
        .doc(appointment.babysitterUserId as string)
        .get();
      const babysitterUser = babysitterDoc.data()!;
      const babysitterName = `${babysitterUser.firstName} ${babysitterUser.lastName}`;

      const declineDateDisplay = appointment.date
        ? `${appointment.date}${appointment.startTime ? ` at ${appointment.startTime}` : ''}${appointment.endTime ? `–${appointment.endTime}` : ''}`
        : 'Recurring schedule';

      const declineEmailBody = `
        <p><strong>${escapeHtml(babysitterName)}</strong> has declined your babysitting request for <strong>${escapeHtml(declineDateDisplay)}</strong>.</p>
        <p>You can search for other available babysitters or resubmit this request with updated details.</p>
        <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>
      `;

      if (appointment.familyId) {
        await notifyAllParents({
          familyId: appointment.familyId,
          prefCategory: 'cancelled',
          type: 'request_declined',
          title: 'Request declined',
          body: `${babysitterName} has declined your babysitting request.`,
          emailSubject: `Babysitting request declined — ${babysitterName}`,
          emailBody: declineEmailBody,
          data: { appointmentId: data.appointmentId },
        });
      }
    }

    if (guardianActor) {
      await notifyChildOfGuardianAction(
        appointment.babysitterUserId as string,
        'A parent of your family declined a babysitting request for you.',
        { appointmentId: data.appointmentId },
      );
    }

    await writeUserActivity(request.auth!.uid, data.action === 'accept' ? 'appointment_accepted' : 'appointment_declined', { appointmentId: data.appointmentId, ...(guardianActor ? { actorRole: 'guardian' } : {}) });

    return { success: true };
  }
);

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.floor((h * 60 + m) / 15);
}
