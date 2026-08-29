import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isLateCancellation } from '@ejm/shared-functions/schedule/lateCancellation.js';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { escapeHtml, sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { getParentProfile, resolveNotifPref, type User } from '@ejm/shared-core';
import { SIT_APP_URL } from '@ejm/shared-functions';

interface ModifyInput {
  appointmentId: string;
  startTime?: string;
  endTime?: string;
  kidIds?: string[];
  message?: string;
  additionalInfo?: string;
}

export const modifyAppointment = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const data = request.data as ModifyInput;

    if (!data.appointmentId) {
      throw new HttpsError('invalid-argument', 'Appointment ID is required');
    }

    // Verify caller is a parent in the appointment's family
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller) {
      throw new HttpsError('permission-denied', 'Only parents can modify appointments');
    }

    const aptRef = db.collection('appointments').doc(data.appointmentId);
    const aptSnap = await aptRef.get();

    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const apt = aptSnap.data()!;

    if (apt.status !== 'pending' && apt.status !== 'confirmed') {
      throw new HttpsError('failed-precondition', 'Only pending or confirmed appointments can be modified');
    }

    const callerFamilyId = caller.familyId;
    if (callerFamilyId !== apt.familyId) {
      throw new HttpsError('permission-denied', 'You are not part of this appointment');
    }

    // Build update object and track changed fields
    const updates: Record<string, unknown> = {};
    const modifiedFields: string[] = [];
    const now = new Date();

    if (data.startTime !== undefined && data.startTime !== apt.startTime) {
      // Inside-window guard, study's modify contract ported (PR #248 round
      // 3): you cannot move what you could not cleanly cancel. Even a
      // same-day startTime move escapes the flag -- e.g. a 24h window with
      // the start 23h away moves to 37h away and then cancels clean -- the
      // exact modify-then-cancel hole study closed in PR #244 round 2 for
      // date moves. Confirmed one_time with a positive snapshot only; an
      // already-started appointment is cleanup territory (the flag never
      // applies there, so neither does the guard).
      const noticeSnapshot = (apt.cancellationNoticeHours as number | undefined) ?? 0;
      const guardApplies =
        apt.status === 'confirmed' &&
        apt.type === 'one_time' &&
        noticeSnapshot > 0 &&
        typeof apt.date === 'string' &&
        typeof apt.startTime === 'string' &&
        parisWallTimeToUtc(apt.date as string, apt.startTime as string).getTime() >= now.getTime() &&
        isLateCancellation(apt.date as string, apt.startTime as string, noticeSnapshot, now);
      if (guardApplies) {
        throw new HttpsError(
          'failed-precondition',
          'inside_notice_window',
        );
      }
      updates.startTime = data.startTime;
      modifiedFields.push('startTime');
    }
    if (data.endTime !== undefined && data.endTime !== apt.endTime) {
      updates.endTime = data.endTime;
      modifiedFields.push('endTime');
    }
    if (data.message !== undefined && data.message !== apt.message) {
      updates.message = data.message;
      modifiedFields.push('message');
    }
    if (data.additionalInfo !== undefined && data.additionalInfo !== apt.additionalInfo) {
      updates.additionalInfo = data.additionalInfo;
      modifiedFields.push('additionalInfo');
    }

    // Handle kidIds change — also re-denormalize kids array
    if (data.kidIds !== undefined) {
      const currentKidIds = (apt.kidIds || []).sort().join(',');
      const newKidIds = data.kidIds.sort().join(',');
      if (currentKidIds !== newKidIds) {
        updates.kidIds = data.kidIds;
        modifiedFields.push('kids');

        // Re-denormalize kids from family subcollection
        const kidsSnap = await db.collection('families').doc(apt.familyId).collection('kids').get();
        const kidMap: Record<string, FirebaseFirestore.DocumentData | undefined> = {};
        for (const doc of kidsSnap.docs) {
          kidMap[doc.id] = doc.data();
        }
        updates.kids = data.kidIds.map((kidId: string) => {
          const k = kidMap[kidId];
          return k ? { age: k.age, languages: k.languages || [] } : { age: 0, languages: [] };
        });
      }
    }

    if (modifiedFields.length === 0) {
      return { success: true, modified: false };
    }

    updates.modified = true;
    updates.modifiedAt = now;
    updates.modifiedFields = modifiedFields;
    updates.updatedAt = now;

    await aptRef.update(updates);

    // Notify babysitter
    const babysitterDoc = await db.collection('users').doc(apt.babysitterUserId).get();
    const babysitterEmail = babysitterDoc.data()?.email;
    const babysitterPrefs = resolveNotifPref(babysitterDoc.data()?.notifPrefs, 'sit', 'newRequest');
    const familyName = apt.familyName || 'A family';
    const dateInfo = apt.date ? `${apt.date}${updates.startTime || apt.startTime ? `, ${updates.startTime || apt.startTime}` : ''}${updates.endTime || apt.endTime ? `–${updates.endTime || apt.endTime}` : ''}` : 'Recurring';

    await db.collection('notifications').add({
      recipientUserId: apt.babysitterUserId,
      type: 'general',
      title: 'Appointment modified',
      body: `${familyName} has modified the appointment for ${dateInfo}. Changed: ${modifiedFields.join(', ')}`,
      data: { appointmentId: data.appointmentId },
      read: false,
      channels: ['email'],
      emailSent: false,
      pushSent: false,
      createdAt: now,
    });

    if (babysitterPrefs.email && babysitterEmail) {
      await sendNotificationEmail(
        babysitterEmail,
        `Appointment modified by ${familyName}`,
        `<p><strong>${escapeHtml(familyName)}</strong> has modified the appointment for <strong>${escapeHtml(dateInfo)}</strong>.</p>
         <p><strong>Changes:</strong> ${modifiedFields.join(', ')}</p>
         <p style="color: #6B7280; font-size: 14px;">Please review the changes and acknowledge them in the app.</p>
         <p style="margin-top: 16px;"><a href="${SIT_APP_URL}/babysitter/request/${data.appointmentId}" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Changes</a></p>`
      );
    }

    if (babysitterPrefs.push) {
      await sendPushNotification(
        apt.babysitterUserId,
        'Appointment modified',
        `${familyName} has modified the appointment. Changed: ${modifiedFields.join(', ')}`,
        { appointmentId: data.appointmentId, type: 'appointment_modified' }
      );
    }

    await writeUserActivity(uid, 'appointment_modified', { appointmentId: data.appointmentId, modifiedFields });

    return { success: true, modified: true, modifiedFields };
  }
);
