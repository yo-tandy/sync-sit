import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

interface ListAuditLogsInput {
  actionFilter?: string;
  limit?: number;
  startAfterId?: string;
}

/**
 * List audit logs ordered by timestamp desc, with optional action filter.
 */
export const listAuditLogs = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { actionFilter, limit = 50, startAfterId } = request.data as ListAuditLogsInput;

    let query: FirebaseFirestore.Query = db
      .collection('auditLogs')
      .orderBy('timestamp', 'desc');

    if (actionFilter) {
      query = query.where('action', '==', actionFilter);
    }

    if (startAfterId) {
      const startAfterDoc = await db.collection('auditLogs').doc(startAfterId).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    const snapshot = await query.limit(limit).get();

    // Collect unique user IDs to resolve emails
    const userIds = new Set<string>();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (data.adminUserId) userIds.add(data.adminUserId);
      if (data.targetUserId) userIds.add(data.targetUserId);
    }

    // Build a user info map: uid -> { email, name, role }
    const userInfo: Record<string, { email: string; name: string; role: string }> = {};
    const userIdArray = Array.from(userIds).filter((id) => id && id !== 'system');
    if (userIdArray.length > 0) {
      const userDocs = await Promise.all(
        userIdArray.map((id) => db.collection('users').doc(id).get())
      );
      for (const userDoc of userDocs) {
        if (userDoc.exists) {
          const d = userDoc.data()!;
          userInfo[userDoc.id] = {
            email: d.email || '',
            name: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
            role: d.role || '',
          };
        }
      }
    }

    const logs = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        action: data.action || '',
        adminUserId: data.adminUserId || '',
        adminInfo: userInfo[data.adminUserId] || null,
        targetUserId: data.targetUserId || '',
        targetInfo: userInfo[data.targetUserId] || null,
        details: data.details || {},
        timestamp: data.timestamp?.toDate?.()
          ? data.timestamp.toDate().toISOString()
          : '',
      };
    });

    return { logs, userInfo };
  }
);
