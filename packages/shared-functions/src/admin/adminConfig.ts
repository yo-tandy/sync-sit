import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import {
  ADMIN_CONFIG_DEFS,
  ADMIN_CONFIG_DOC,
  ADMIN_CONFIG_CLIENT_DOC,
  invalidateAdminConfigCache,
  type AdminConfigKey,
} from '../config/adminConfig.js';
import { CLIENT_EXPOSED_CONFIG_KEYS } from '@ejm/shared-core';

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

    // null reverts a key to its code default (the field is DELETED, so
    // "using default" in the panel means exactly that -- round-1 review:
    // without this, an override could never be removed and the help text
    // promising "empty field = code default" was false).
    const clean: Record<string, number | FieldValue> = {};
    const auditTo: Record<string, number | null> = {};
    for (const [key, raw] of Object.entries(updates)) {
      // Object.hasOwn: a plain-object index would resolve prototype names
      // ('constructor' -> Object, truthy) and slip past the unknown-key
      // throw into the bounds check against undefined (round-3 review).
      if (!Object.hasOwn(ADMIN_CONFIG_DEFS, key)) {
        throw new HttpsError('invalid-argument', `Unknown config key: ${key}`);
      }
      const def = ADMIN_CONFIG_DEFS[key as AdminConfigKey];
      if (raw === null) {
        clean[key] = FieldValue.delete();
        auditTo[key] = null;
        continue;
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        throw new HttpsError('invalid-argument', `${key} must be an integer or null`);
      }
      if (raw < def.min || raw > def.max) {
        throw new HttpsError(
          'invalid-argument',
          `${key} must be between ${def.min} and ${def.max}`,
        );
      }
      clean[key] = raw;
      auditTo[key] = raw;
    }

    const ref = db.doc(ADMIN_CONFIG_DOC);
    const before = (await ref.get()).data() ?? {};
    await ref.set(clean, { merge: true });

    // Mirror the client-exposed subset into the world-readable client doc
    // (round-6 review): enrollment wizards read verificationCodeCooldownS
    // BEFORE the account exists, so the authed-only values doc silently
    // served them the default. Rewritten as a full snapshot (no merge) so
    // reverted keys disappear; the abuse levers never leave the values doc.
    const after = (await ref.get()).data() ?? {};
    const clientMirror: Record<string, unknown> = {};
    for (const key of CLIENT_EXPOSED_CONFIG_KEYS) {
      if (Object.hasOwn(after, key)) clientMirror[key] = (after as Record<string, unknown>)[key];
    }
    await db.doc(ADMIN_CONFIG_CLIENT_DOC).set(clientMirror);
    invalidateAdminConfigCache();

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'admin_config_updated',
      details: {
        changes: Object.fromEntries(
          Object.entries(auditTo).map(([k, v]) => [
            k,
            { from: (before as Record<string, unknown>)[k] ?? null, to: v },
          ]),
        ),
      },
    });

    return { success: true };
  },
);
