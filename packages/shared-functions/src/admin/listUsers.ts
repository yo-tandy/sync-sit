import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getUserRole, type User, type LegacyUserFields } from '@ejm/shared-core';
import { getBabysitterProfile } from '@ejm/sit-core';
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

    if (statusFilter) {
      query = query.where('status', '==', statusFilter);
    }

    if (startAfterId) {
      const startAfterDoc = await db.collection('users').doc(startAfterId).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    // Role is resolved from the Plan D profiles map (with legacy fallback), so
    // it cannot be a Firestore predicate — filter it in-memory like search.
    // Fetch a larger window when either in-memory filter is active.
    const fetchLimit = searchQuery || roleFilter ? 500 : limit;
    const snapshot = await query.limit(fetchLimit).get();

    let users = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // In-memory role filter (shape-tolerant via the adapter)
    if (roleFilter) {
      users = users.filter(
        (user) => getUserRole(user as unknown as User & Partial<LegacyUserFields>) === roleFilter,
      );
    }

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

    // Project the admin list-item wire shape: `role` and `searchable` are
    // derived from the Plan D profiles map (with legacy fallback) so the admin
    // UI keeps rendering role badges + the activate/deactivate toggle without
    // reading now-removed top-level fields.
    const projected = users.slice(0, limit).map((user) => {
      const u = user as unknown as User & Partial<LegacyUserFields>;
      return {
        ...user,
        role: getUserRole(u) ?? '',
        searchable: getBabysitterProfile(u)?.searchable ?? false,
      };
    });

    return { users: projected };
  }
);
