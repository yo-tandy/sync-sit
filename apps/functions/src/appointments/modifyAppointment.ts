import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

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
    if (!callerDoc.exists || callerDoc.data()?.role !== 'parent') {
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

    const callerFamilyId = callerDoc.data()?.familyId;
    if (callerFamilyId !== apt.familyId) {
      throw new HttpsError('permission-denied', 'You are not part of this appointment');
    }

    // Build update object and track changed fields
    const updates: Record<string, any> = {};
    const modifiedFields: string[] = [];
    const now = new Date();

    if (data.startTime !== undefined && data.startTime !== apt.startTime) {
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
        const kidMap: Record<string, any> = {};
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
    const babysitterPrefs = babysitterDoc.data()?.notifPrefs?.newRequest;
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

    if (babysitterPrefs?.email !== false && babysitterEmail) {
      await sendNotificationEmail(
        babysitterEmail,
        `Appointment modified by ${familyName}`,
        `<p><strong>${familyName}</strong> has modified the appointment for <strong>${dateInfo}</strong>.</p>
         <p><strong>Changes:</strong> ${modifiedFields.join(', ')}</p>
         <p style="color: #6B7280; font-size: 14px;">Please review the changes and acknowledge them in the app.</p>
         <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter/request/${data.appointmentId}" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Changes</a></p>`
      );
    }

    if (babysitterDoc.data()?.notifPrefs?.newRequest?.push !== false) {
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
