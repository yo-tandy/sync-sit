import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';

interface ListUsersInput {
  searchQuery?: string;
  roleFilter?: string;
  statusFilter?: string;
  limit?: number;
  startAfterId?: string;
}

/**
 * List users with optional search, role, and status filters.
 * Search is in-memory case-insensitive on firstName/lastName/email (small community).
 */
export const listUsers = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const {
      searchQuery,
      roleFilter,
      statusFilter,
      limit = 50,
      startAfterId,
    } = request.data as ListUsersInput;

    let query: FirebaseFirestore.Query = db.collection('users');

    if (roleFilter) {
      query = query.where('role', '==', roleFilter);
    }

    if (statusFilter) {
      query = query.where('status', '==', statusFilter);
    }

    if (startAfterId) {
      const startAfterDoc = await db.collection('users').doc(startAfterId).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    // Fetch more than needed if searching (will filter in-memory)
    const fetchLimit = searchQuery ? 500 : limit;
    const snapshot = await query.limit(fetchLimit).get();

    let users = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // In-memory search filter
    if (searchQuery) {
      const lowerSearch = searchQuery.toLowerCase();
      users = users.filter((user: Record<string, unknown>) => {
        const firstName = ((user.firstName as string) || '').toLowerCase();
        const lastName = ((user.lastName as string) || '').toLowerCase();
        const email = ((user.email as string) || '').toLowerCase();
        return (
          firstName.includes(lowerSearch) ||
          lastName.includes(lowerSearch) ||
          email.includes(lowerSearch)
        );
      });
    }

    return { users: users.slice(0, limit) };
  }
);
