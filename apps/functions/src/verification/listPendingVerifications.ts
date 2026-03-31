import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from '../admin/verifyAdmin.js';

interface ListInput {
  statusFilter?: string;
  typeFilter?: string;
  limit?: number;
}

export const listPendingVerifications = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { statusFilter, typeFilter, limit: queryLimit = 50 } = request.data as ListInput;

    let query: FirebaseFirestore.Query = db.collection('verifications').orderBy('createdAt', 'desc');

    if (statusFilter) {
      query = query.where('status', '==', statusFilter);
    }
    if (typeFilter) {
      query = query.where('type', '==', typeFilter);
    }

    const snapshot = await query.limit(queryLimit).get();

    // Collect family and user IDs for enrichment
    const familyIds = new Set<string>();
    const userIds = new Set<string>();
    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (d.familyId) familyIds.add(d.familyId);
      if (d.uploadedByUserId) userIds.add(d.uploadedByUserId);
    }

    // Batch fetch families and users
    const familyNames: Record<string, string> = {};
    if (familyIds.size > 0) {
      const familyDocs = await Promise.all(
        Array.from(familyIds).map((id) => db.collection('families').doc(id).get())
      );
      for (const fDoc of familyDocs) {
        if (fDoc.exists) {
          familyNames[fDoc.id] = fDoc.data()?.familyName || 'Unknown';
        }
      }
    }

    const userNames: Record<string, string> = {};
    if (userIds.size > 0) {
      const userDocs = await Promise.all(
        Array.from(userIds).map((id) => db.collection('users').doc(id).get())
      );
      for (const uDoc of userDocs) {
        if (uDoc.exists) {
          const d = uDoc.data()!;
          userNames[uDoc.id] = `${d.firstName || ''} ${d.lastName || ''}`.trim();
        }
      }
    }

    const verifications = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        ...d,
        familyName: familyNames[d.familyId] || 'Unknown',
        parentName: userNames[d.uploadedByUserId] || 'Unknown',
        createdAt: d.createdAt?.toDate?.() ? d.createdAt.toDate().toISOString() : '',
        reviewedAt: d.reviewedAt?.toDate?.() ? d.reviewedAt.toDate().toISOString() : '',
      };
    });

    return { verifications };
  }
);
