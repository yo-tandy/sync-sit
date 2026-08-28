import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  validateDoerBio,
  validateDoerCategories,
  validateDoerDefaultRate,
} from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface UpdateDoerProfileData {
  categories?: unknown;
  bio?: unknown;
  defaultRate?: unknown;
  hasCar?: unknown;
  hasBike?: unknown;
  notifyNewTasks?: unknown;
}

/**
 * `doUpdateDoerProfile` (plan §8): the account-page edits — categories, bio,
 * transport (hasCar/hasBike), notifyNewTasks, defaultRate — validated with
 * the do-core bounds. Field-whitelist by construction: the update map is
 * built only from the six keys above, so `enrollmentComplete` (server-owned,
 * the §7.2 board-gate) and every other profile field are unreachable — this
 * callable NEVER touches them.
 */
export const doUpdateDoerProfile = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = (request.data ?? {}) as UpdateDoerProfileData;

    // Validate each SUPPLIED field (absent = leave alone; the callable is a
    // partial update, matching how the account page saves one card at a
    // time). Manual guards in the publishSearch house style (§8).
    const update: Record<string, unknown> = {};

    if (data.categories !== undefined) {
      const err = validateDoerCategories(data.categories);
      if (err) throw new HttpsError('invalid-argument', err);
      update['profiles.doer.categories'] = data.categories;
    }
    if (data.bio !== undefined) {
      const err = validateDoerBio(data.bio);
      if (err) throw new HttpsError('invalid-argument', err);
      update['profiles.doer.bio'] =
        typeof data.bio === 'string' ? data.bio.trim() || null : null;
    }
    if (data.defaultRate !== undefined) {
      const err = validateDoerDefaultRate(data.defaultRate);
      if (err) throw new HttpsError('invalid-argument', err);
      update['profiles.doer.defaultRate'] = data.defaultRate;
    }
    for (const key of ['hasCar', 'hasBike', 'notifyNewTasks'] as const) {
      if (data[key] !== undefined) {
        if (typeof data[key] !== 'boolean') {
          throw new HttpsError('invalid-argument', `${key} must be a boolean`);
        }
        update[`profiles.doer.${key}`] = data[key];
      }
    }

    if (Object.keys(update).length === 0) {
      throw new HttpsError('invalid-argument', 'Nothing to update');
    }

    const ref = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const userData = snap.data();
      if (!snap.exists || !userData) {
        throw new HttpsError('failed-precondition', 'User record not found');
      }
      if (userData.status !== 'active') {
        throw new HttpsError('permission-denied', 'Account is not active');
      }
      if (userData.profiles?.doer === undefined) {
        throw new HttpsError(
          'failed-precondition',
          'This account has no doer profile',
        );
      }
      tx.update(ref, { ...update, updatedAt: new Date() });
    });

    await writeUserActivity(uid, 'doer.profile_updated', {
      fields: Object.keys(update).map((k) => k.replace('profiles.doer.', '')),
    });

    return { ok: true };
  },
);
