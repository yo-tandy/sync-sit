import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

interface SubmitFamilyEndorsementData {
  babysitterUserId: string;
  appointmentId: string;
  referenceText: string;
  refName: string;
  refPhone?: string | null;
  refWhatsapp?: string | null;
  refEmail?: string | null;
  numberOfKids?: number | null;
  kidAges?: number[] | null;
}

export const submitFamilyEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as SubmitFamilyEndorsementData;

    if (!data?.babysitterUserId || !data?.appointmentId || !data?.referenceText || !data?.refName) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }
    if (data.referenceText.trim().length < 10) {
      throw new HttpsError('invalid-argument', 'Reference text too short (min 10 characters)');
    }
    if (data.babysitterUserId === uid) {
      throw new HttpsError('invalid-argument', 'Cannot endorse yourself');
    }

    const callerSnap = await db.collection('users').doc(uid).get();
    const caller = callerSnap.data();
    if (!callerSnap.exists || caller?.role !== 'parent' || !caller?.familyId) {
      throw new HttpsError('permission-denied', 'Only parents in a family can submit endorsements');
    }
    const familyId = caller.familyId as string;

    const aptSnap = await db.collection('appointments').doc(data.appointmentId).get();
    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }
    const apt = aptSnap.data()!;
    if (
      apt.familyId !== familyId ||
      apt.babysitterUserId !== data.babysitterUserId ||
      apt.status !== 'confirmed'
    ) {
      throw new HttpsError('permission-denied', 'Endorsement requires a confirmed appointment with this babysitter');
    }

    const dupQuery = await db.collection('references')
      .where('submittedByUserId', '==', uid)
      .where('babysitterUserId', '==', data.babysitterUserId)
      .where('appointmentId', '==', data.appointmentId)
      .limit(1)
      .get();
    if (!dupQuery.empty) {
      throw new HttpsError('already-exists', 'You have already submitted an endorsement for this appointment');
    }

    const familySnap = await db.collection('families').doc(familyId).get();
    const isEjmFamily = !!familySnap.data()?.verification?.isFullyVerified;

    const refDoc = db.collection('references').doc();
    const payload: Record<string, unknown> = {
      referenceId: refDoc.id,
      type: 'family_submitted',
      status: 'private',
      babysitterUserId: data.babysitterUserId,
      submittedByUserId: uid,
      submittedByFamilyId: familyId,
      submittedByName: data.refName.trim(),
      appointmentId: data.appointmentId,
      referenceText: data.referenceText.trim(),
      refName: data.refName.trim(),
      isEjmFamily,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.refPhone) payload.refPhone = data.refPhone;
    if (data.refWhatsapp) payload.refWhatsapp = data.refWhatsapp;
    if (data.refEmail) payload.refEmail = data.refEmail;
    if (typeof data.numberOfKids === 'number') payload.numberOfKids = data.numberOfKids;
    if (Array.isArray(data.kidAges) && data.kidAges.length > 0) payload.kidAges = data.kidAges;

    await refDoc.set(payload);
    return { referenceId: refDoc.id };
  }
);
