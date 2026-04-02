import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

interface ListAppointmentsInput {
  statusFilter?: string;
  limit?: number;
  startAfterId?: string;
}

/**
 * List appointments with optional status filter, ordered by createdAt desc.
 * Enriches each appointment with babysitter and family names.
 */
export const listAppointments = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { statusFilter, limit = 50, startAfterId } = request.data as ListAppointmentsInput;

    let query: FirebaseFirestore.Query = db
      .collection('appointments')
      .orderBy('createdAt', 'desc');

    if (statusFilter) {
      query = query.where('status', '==', statusFilter);
    }

    if (startAfterId) {
      const startAfterDoc = await db.collection('appointments').doc(startAfterId).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    const snapshot = await query.limit(limit).get();

    // Collect unique babysitter user IDs and family IDs
    const babysitterIds = new Set<string>();
    const familyIds = new Set<string>();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.babysitterUserId) babysitterIds.add(data.babysitterUserId);
      if (data.familyId) familyIds.add(data.familyId);
    }

    // Batch-fetch babysitter names from users collection
    const userNames: Record<string, string> = {};
    const babysitterIdArray = Array.from(babysitterIds);
    if (babysitterIdArray.length > 0) {
      const userDocs = await Promise.all(
        babysitterIdArray.map((id) => db.collection('users').doc(id).get())
      );
      for (const userDoc of userDocs) {
        if (userDoc.exists) {
          const data = userDoc.data()!;
          userNames[userDoc.id] = `${data.firstName || ''} ${data.lastName || ''}`.trim();
        }
      }
    }

    // Batch-fetch family names and parent IDs from families collection
    const familyNames: Record<string, string> = {};
    const parentIds = new Set<string>();
    const familyIdArray = Array.from(familyIds);
    if (familyIdArray.length > 0) {
      const familyDocs = await Promise.all(
        familyIdArray.map((id) => db.collection('families').doc(id).get())
      );
      for (const familyDoc of familyDocs) {
        if (familyDoc.exists) {
          const data = familyDoc.data()!;
          familyNames[familyDoc.id] = data.familyName || 'Unknown';
          if (data.parentIds) {
            for (const pid of data.parentIds) parentIds.add(pid);
          }
        }
      }
    }

    // Batch-fetch parent names from users collection
    const parentNames: Record<string, string> = {};
    const parentIdArray = Array.from(parentIds).filter((id) => !userNames[id]);
    if (parentIdArray.length > 0) {
      const parentDocs = await Promise.all(
        parentIdArray.map((id) => db.collection('users').doc(id).get())
      );
      for (const parentDoc of parentDocs) {
        if (parentDoc.exists) {
          const data = parentDoc.data()!;
          parentNames[parentDoc.id] = `${data.firstName || ''} ${data.lastName || ''}`.trim();
        }
      }
    }

    // Build a family-to-parent-names map
    const familyParentNames: Record<string, string> = {};
    if (familyIdArray.length > 0) {
      const familyDocs2 = await Promise.all(
        familyIdArray.map((id) => db.collection('families').doc(id).get())
      );
      for (const familyDoc of familyDocs2) {
        if (familyDoc.exists) {
          const data = familyDoc.data()!;
          const names = (data.parentIds || [])
            .map((pid: string) => parentNames[pid] || userNames[pid] || '')
            .filter(Boolean);
          familyParentNames[familyDoc.id] = names.join(', ');
        }
      }
    }

    const appointments = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        babysitterUserId: data.babysitterUserId || '',
        familyId: data.familyId || '',
        status: data.status || '',
        date: data.date || '',
        startTime: data.startTime || '',
        endTime: data.endTime || '',
        offeredRate: data.offeredRate ?? null,
        type: data.type || '',
        babysitterName: userNames[data.babysitterUserId] || 'Unknown',
        familyName: familyNames[data.familyId] || 'Unknown',
        parentNames: familyParentNames[data.familyId] || '',
      };
    });

    return { appointments };
  }
);
