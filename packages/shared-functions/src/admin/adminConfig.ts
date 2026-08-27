import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import {
  ADMIN_CONFIG_DEFS,
  ADMIN_CONFIG_DOC,
  invalidateAdminConfigCache,
  type AdminConfigKey,
} from '../config/adminConfig.js';

/**
 * Admin-panel configuration callables (issue #250).
 *
 * getAdminConfig: the panel's read -- definitions (default/bounds/
 * description) plus whatever the doc currently stores, so the UI can show
 * "default" vs "overridden" without duplicating the def table.
 *
 * updateAdminConfig: the ONLY write path (rules deny client writes).
 * Partial updates; every provided key must be known, an integer, and
 * inside its bounds -- the same bounds getConfigValue re-checks at read
 * time, so even a console-edited doc cannot push a value past them.
 * Audit-logged with before/after per key.
 */
export const getAdminConfig = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);
    const snap = await db.doc(ADMIN_CONFIG_DOC).get();
    return { defs: ADMIN_CONFIG_DEFS, values: snap.data() ?? {} };
  },
);

export const updateAdminConfig = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const updates = (request.data as { updates?: Record<string, unknown> })?.updates;
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
      throw new HttpsError('invalid-argument', 'updates must be a non-empty object');
    }

    const clean: Record<string, number> = {};
    for (const [key, raw] of Object.entries(updates)) {
      const def = ADMIN_CONFIG_DEFS[key as AdminConfigKey];
      if (!def) {
        throw new HttpsError('invalid-argument', `Unknown config key: ${key}`);
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        throw new HttpsError('invalid-argument', `${key} must be an integer`);
      }
      if (raw < def.min || raw > def.max) {
        throw new HttpsError(
          'invalid-argument',
          `${key} must be between ${def.min} and ${def.max}`,
        );
      }
      clean[key] = raw;
    }

    const ref = db.doc(ADMIN_CONFIG_DOC);
    const before = (await ref.get()).data() ?? {};
    await ref.set(clean, { merge: true });
    invalidateAdminConfigCache();

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'admin_config_updated',
      details: {
        changes: Object.fromEntries(
          Object.entries(clean).map(([k, v]) => [
            k,
            { from: (before as Record<string, unknown>)[k] ?? null, to: v },
          ]),
        ),
      },
    });

    return { success: true };
  },
);
