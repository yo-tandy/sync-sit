import { db } from './firebase.js';
import { ADMIN_CONFIG_DEFS, type AdminConfigKey } from '@ejm/shared-core';

export { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
export type { AdminConfigKey, AdminConfigDef } from '@ejm/shared-core';

/**
 * Admin-editable operational parameters (issue #250). One flat doc,
 * `adminConfig/values`, read through a short-TTL in-memory cache with the
 * CODE DEFAULTS as fallback: an absent doc, an absent key, a read error,
 * a non-integer or an out-of-bounds stored value all resolve to today's
 * hardcoded behavior, so the panel (or a rogue console edit) can never
 * brick a callable. Writes go through updateAdminConfig only (bounds
 * validated there too); firestore.rules denies client writes and allows
 * signed-in reads (pastVisibilityDays is consumed client-side, and the
 * values are caps and windows, not secrets).
 */

export const ADMIN_CONFIG_DOC = 'adminConfig/values';

/**
 * Cache TTL. Env-tunable so integration tests (and an emergency prod
 * override) can shorten it; the default keeps steady-state reads to one
 * Firestore get per instance per minute.
 */
function ttlMs(): number {
  const raw = Number(process.env.ADMIN_CONFIG_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
}

let cache: { values: Record<string, unknown>; fetchedAt: number } | null = null;

/** Read one configured value, falling back to the code default (see above). */
export async function getConfigValue(key: AdminConfigKey): Promise<number> {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > ttlMs()) {
    try {
      const snap = await db.doc(ADMIN_CONFIG_DOC).get();
      cache = { values: snap.data() ?? {}, fetchedAt: now };
    } catch {
      // Fail open to defaults; retry after one TTL, not on every call.
      cache = { values: {}, fetchedAt: now };
    }
  }
  const def = ADMIN_CONFIG_DEFS[key];
  const v = cache.values[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= def.min && v <= def.max
    ? v
    : def.default;
}

/**
 * Drop the cache so the next read hits Firestore. updateAdminConfig calls
 * this after writing: the updating INSTANCE serves the new value
 * immediately (and, in the single-process emulator, so does everything --
 * which is what makes the effect pins deterministic). Other prod instances
 * still converge within one TTL; that propagation window is the accepted
 * design.
 */
export function invalidateAdminConfigCache(): void {
  cache = null;
}

/** Test seam alias. */
export const __resetAdminConfigCacheForTests = invalidateAdminConfigCache;
