import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { buildMigrationUpdate, type LegacyUserDoc } from './migrateUsersToProfiles.logic.js';

/**
 * One-time Plan D migration: lift each user's legacy top-level `role` +
 * role-specific flat fields into `profiles.{babysitter|parent|tutor}` (or
 * `isAdmin` for admins), then delete the legacy top-level fields.
 *
 * Idempotent: a doc without a top-level `role` is already migrated (or never
 * had one) and is skipped, so the callable is safe to re-run.
 *
 * Admin-only. Sync-sit is the only app with prod users at migration time;
 * sync-study is pre-launch, so tutor docs are expected to be zero but are
 * handled for completeness. Transform logic lives in the SDK-free
 * `migrateUsersToProfiles.logic.ts` so it can be unit-tested.
 */
export const migrateUsersToProfiles = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const snap = await db.collection('users').get();

    let migrated = 0;
    let skipped = 0;
    const byRole: Record<string, number> = { babysitter: 0, parent: 0, tutor: 0, admin: 0 };

    for (const doc of snap.docs) {
      const data = doc.data() as LegacyUserDoc;

      const plan = buildMigrationUpdate(data);
      if (!plan) {
        skipped++;
        continue;
      }

      const updates: Record<string, unknown> = { ...plan.set };
      for (const key of plan.deleteFields) {
        updates[key] = FieldValue.delete();
      }

      await doc.ref.update(updates);
      migrated++;
      byRole[data.role!] = (byRole[data.role!] ?? 0) + 1;
    }

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'migrate_users_to_profiles',
      targetUserId: request.auth.uid,
      details: { migrated, skipped, byRole },
    });

    return { migrated, skipped, byRole };
  }
);
