import { db } from './firebase.js';

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
export interface AdminConfigDef {
  default: number;
  min: number;
  max: number;
  description: string;
}

export const ADMIN_CONFIG_DEFS = {
  boardContactsPerDay: {
    default: 5, min: 1, max: 50,
    description: 'Board contacts a sitter/tutor may send per window (anti-spam cap, both apps).',
  },
  boardContactWindowHours: {
    default: 24, min: 1, max: 168,
    description: 'Window (hours) for the board-contact cap.',
  },
  declineCooldownDays: {
    default: 7, min: 0, max: 90,
    description: 'Days a family/sitter pair is blocked from re-requesting after a decline (both apps).',
  },
  publishedSearchTtlDays: {
    default: 7, min: 1, max: 60,
    description: 'Lifetime (days) of a demand-board post.',
  },
  publishedSearchMaxActive: {
    default: 3, min: 1, max: 20,
    description: 'Live demand-board posts per family.',
  },
  bookingNoticeHours: {
    default: 24, min: 0, max: 168,
    description: 'Minimum lead time (hours) for study bookings and moves.',
  },
  recurringHorizonWeeks: {
    default: 8, min: 1, max: 52,
    description: 'How far ahead (weeks) recurring study sessions are materialized.',
  },
  kidInviteValidityDays: {
    default: 7, min: 1, max: 90,
    description: 'Kid-invite expiry (days).',
  },
  verificationCodeCooldownS: {
    default: 60, min: 30, max: 600,
    description: 'Resend cooldown (seconds) per email address for verification codes.',
  },
  dailySendCap: {
    default: 10, min: 1, max: 100,
    description: 'Verification emails per address per day (abuse lever).',
  },
  bypassSendCap: {
    default: 6, min: 1, max: 100,
    description: 'Authed own-email verification sends per user per hour (abuse lever).',
  },
  verifyCodeMaxAttempts: {
    default: 5, min: 3, max: 10,
    description: 'Wrong-code attempts before a verification code burns.',
  },
  pastVisibilityDays: {
    default: 7, min: 1, max: 90,
    description: 'How long (days) past appointments stay on dashboards.',
  },
  availabilityMaxRangeDays: {
    default: 28, min: 7, max: 90,
    description: 'Widest availability range (days) a client may query.',
  },
} as const satisfies Record<string, AdminConfigDef>;

export type AdminConfigKey = keyof typeof ADMIN_CONFIG_DEFS;

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

/** Test seam: drop the cache so the next read hits Firestore. */
export function __resetAdminConfigCacheForTests(): void {
  cache = null;
}
