import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

interface ResubmitInput {
  originalAppointmentId: string;
  startTime?: string;
  endTime?: string;
  kidIds?: string[];
  offeredRate?: number;
  additionalNotes: string; // mandatory
}

export const resubmitAppointment = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const data = request.data as ResubmitInput;

    if (!data.originalAppointmentId || !data.additionalNotes?.trim()) {
      throw new HttpsError('invalid-argument', 'Original appointment ID and additional notes are required');
    }

    // Verify caller is a parent
    const callerDoc = await db.collection('users').doc(uid).get();
    if (!callerDoc.exists || callerDoc.data()?.role !== 'parent') {
      throw new HttpsError('permission-denied', 'Only parents can resubmit requests');
    }

    // Load original appointment
    const originalRef = db.collection('appointments').doc(data.originalAppointmentId);
    const originalSnap = await originalRef.get();

    if (!originalSnap.exists) {
      throw new HttpsError('not-found', 'Original appointment not found');
    }

    const original = originalSnap.data()!;

    // Verify it was rejected
    if (original.status !== 'rejected') {
      throw new HttpsError('failed-precondition', 'Only declined requests can be resubmitted');
    }

    // Verify caller is in the family
    const callerFamilyId = callerDoc.data()?.familyId;
    if (callerFamilyId !== original.familyId) {
      throw new HttpsError('permission-denied', 'You are not part of this appointment');
    }

    // Build new appointment
    const now = new Date();
    const newKidIds = data.kidIds || original.kidIds;

    // Re-denormalize kids if kidIds changed
    let kids = original.kids;
    if (data.kidIds) {
      const kidsSnap = await db.collection('families').doc(original.familyId).collection('kids').get();
      const kidMap: Record<string, any> = {};
      for (const doc of kidsSnap.docs) {
        kidMap[doc.id] = doc.data();
      }
      kids = data.kidIds.map((kidId: string) => {
        const k = kidMap[kidId];
        return k ? { age: k.age, languages: k.languages || [] } : { age: 0, languages: [] };
      });
    }

    // Append additional notes to existing additionalInfo
    const existingInfo = original.additionalInfo || '';
    const newAdditionalInfo = existingInfo
      ? `${existingInfo}\n---\n${data.additionalNotes.trim()}`
      : data.additionalNotes.trim();

    // Use a batch to atomically create the new appointment AND mark the original
    const newAppointmentRef = db.collection('appointments').doc();
    const batch = db.batch();

    batch.set(newAppointmentRef, {
      appointmentId: newAppointmentRef.id,
      searchId: original.searchId || null,
      familyId: original.familyId,
      familyName: original.familyName || '',
      familyPhotoUrl: original.familyPhotoUrl || null,
      babysitterUserId: original.babysitterUserId,
      createdByUserId: uid,
      type: original.type,
      status: 'pending',
      date: original.date || null,
      startTime: data.startTime || original.startTime || null,
      endTime: data.endTime || original.endTime || null,
      recurringSlots: original.recurringSlots || null,
      schoolWeeksOnly: original.schoolWeeksOnly || false,
      kidIds: newKidIds,
      kids,
      address: original.address,
      latLng: original.latLng,
      offeredRate: data.offeredRate !== undefined ? data.offeredRate : (original.offeredRate || null),
      message: original.message || null,
      additionalInfo: newAdditionalInfo,
      pets: original.pets || null,
      familyNote: original.familyNote || null,
      isResubmission: true,
      resubmittedFromAppointmentId: data.originalAppointmentId,
      createdAt: now,
      updatedAt: now,
    });

    // Mark original appointment as resubmitted (hides it from dashboards)
    batch.update(originalRef, { resubmitted: true });

    await batch.commit();

    // Notify babysitter
    const babysitterDoc = await db.collection('users').doc(original.babysitterUserId).get();
    const babysitterData = babysitterDoc.data();
    const familyName = original.familyName || 'A family';
    const dateInfo = original.date
      ? `${original.date}${data.startTime || original.startTime ? `, ${data.startTime || original.startTime}` : ''}${data.endTime || original.endTime ? `–${data.endTime || original.endTime}` : ''}`
      : 'Recurring';

    // Notification doc
    await db.collection('notifications').add({
      recipientUserId: original.babysitterUserId,
      type: 'new_request',
      title: 'Request resubmitted',
      body: `${familyName} has resubmitted a babysitting request for ${dateInfo}.`,
      data: { appointmentId: newAppointmentRef.id },
      read: false,
      channels: ['email', 'push'],
      emailSent: false,
      pushSent: false,
      createdAt: now,
    });

    // Email
    if (babysitterData?.notifPrefs?.newRequest?.email !== false && babysitterData?.email) {
      await sendNotificationEmail(
        babysitterData.email,
        `Request resubmitted by ${familyName}`,
        `<p><strong>${familyName}</strong> has resubmitted a babysitting request for <strong>${dateInfo}</strong>.</p>
         <p><strong>Note:</strong> ${data.additionalNotes.trim()}</p>
         <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter/request/${newAppointmentRef.id}" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Request</a></p>`
      );
    }

    // Push
    if (babysitterData?.notifPrefs?.newRequest?.push !== false) {
      await sendPushNotification(
        original.babysitterUserId,
        'Request resubmitted',
        `${familyName} has resubmitted a babysitting request.`,
        { appointmentId: newAppointmentRef.id, type: 'new_request' }
      );
    }

    await writeUserActivity(uid, 'appointment_resubmitted', {
      originalAppointmentId: data.originalAppointmentId,
      newAppointmentId: newAppointmentRef.id,
    });

    return { success: true, appointmentId: newAppointmentRef.id };
  }
);
