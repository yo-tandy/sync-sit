import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

interface ContactRequestData {
  babysitterUserId: string;
  searchType: 'one_time' | 'recurring';
  // One-time
  date?: string;
  startTime?: string;
  endTime?: string;
  // Recurring
  recurringSlots?: { day: string; startTime: string; endTime: string }[];
  schoolWeeksOnly?: boolean;
  // Common
  kidIds: string[];
  address: string;
  latLng: { lat: number; lng: number };
  offeredRate?: number;
  message?: string;
  additionalInfo?: string;
  familyId: string;
}

export const sendContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const data = request.data as ContactRequestData;

    if (!data.babysitterUserId || !data.familyId) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    // Verify caller is a family member
    const familySnap = await db.collection('families').doc(data.familyId).get();
    if (!familySnap.exists) {
      throw new HttpsError('not-found', 'Family not found');
    }
    const familyData = familySnap.data()!;
    if (!familyData.parentIds.includes(uid)) {
      throw new HttpsError('permission-denied', 'Not a member of this family');
    }

    // Verify babysitter exists and is active
    const babysitterSnap = await db.collection('users').doc(data.babysitterUserId).get();
    if (!babysitterSnap.exists || babysitterSnap.data()?.status !== 'active') {
      throw new HttpsError('not-found', 'Babysitter not found or not active');
    }

    // Load kid details for the selected kids
    const kids: { kidId: string; firstName: string; age: number; languages: string[] }[] = [];
    for (const kidId of data.kidIds || []) {
      const kidSnap = await db.collection('families').doc(data.familyId).collection('kids').doc(kidId).get();
      if (kidSnap.exists) {
        const k = kidSnap.data()!;
        kids.push({ kidId, firstName: k.firstName, age: k.age, languages: k.languages || [] });
      }
    }

    // Load parent contact details
    const parentContacts: { firstName: string; lastName: string; email: string }[] = [];
    for (const pid of familyData.parentIds || []) {
      const pSnap = await db.collection('users').doc(pid).get();
      if (pSnap.exists) {
        const p = pSnap.data()!;
        parentContacts.push({ firstName: p.firstName, lastName: p.lastName, email: p.email });
      }
    }

    const now = new Date();

    // Create search doc
    const searchRef = db.collection('searches').doc();
    await searchRef.set({
      searchId: searchRef.id,
      familyId: data.familyId,
      createdByUserId: uid,
      type: data.searchType,
      status: 'active',
      date: data.date || null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      recurringSlots: data.recurringSlots || null,
      schoolWeeksOnly: data.schoolWeeksOnly || false,
      kidIds: data.kidIds,
      address: data.address,
      latLng: data.latLng,
      offeredRate: data.offeredRate || null,
      additionalInfo: data.additionalInfo || null,
      filters: {},
      createdAt: now,
    });

    // Create appointment doc
    const appointmentRef = db.collection('appointments').doc();
    await appointmentRef.set({
      appointmentId: appointmentRef.id,
      searchId: searchRef.id,
      familyId: data.familyId,
      familyName: familyData.familyName || '',
      babysitterUserId: data.babysitterUserId,
      createdByUserId: uid,
      type: data.searchType,
      status: 'pending',
      date: data.date || null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      recurringSlots: data.recurringSlots || null,
      schoolWeeksOnly: data.schoolWeeksOnly || false,
      kidIds: data.kidIds,
      kids: kids.map((k) => ({ age: k.age, languages: k.languages })),
      address: data.address,
      latLng: data.latLng,
      offeredRate: data.offeredRate || null,
      message: data.message || null,
      additionalInfo: data.additionalInfo || null,
      pets: familyData.pets || null,
      familyNote: familyData.note || null,
      parentContacts,
      createdAt: now,
      updatedAt: now,
    });

    // TODO: Send email + push notification to babysitter

    return {
      success: true,
      appointmentId: appointmentRef.id,
      searchId: searchRef.id,
    };
  }
);
