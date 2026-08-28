/**
 * Admin-editable operational parameters (issue #250): the ONE definition
 * table -- defaults, bounds, and panel descriptions. Lives in shared-core
 * (pure data) so the server getter, the updateAdminConfig validator, the
 * admin panel, and the client-side reader all share it and none can drift.
 *
 * Bounds note: the anti-abuse levers deliberately cannot weaken today's
 * posture below its current floor -- verificationCodeCooldownS's min IS
 * today's fixed 60s. Widening any ceiling is an owner decision recorded
 * here, enforced by updateAdminConfig AND re-checked at read time.
 */
export interface AdminConfigDef {
  default: number;
  min: number;
  max: number;
  description: string;
  /**
   * True for keys a client UI reads directly from Firestore. updateAdminConfig
   * mirrors ONLY these keys into `adminConfig/client`, which rules leave
   * world-readable -- enrollment wizards read the resend cooldown BEFORE the
   * account exists, so an authed-only doc silently serves them the default
   * (round-6 review). Everything else (the abuse levers in particular) stays
   * in `adminConfig/values`, readable only to signed-in users.
   */
  clientExposed?: boolean;
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
    // min: 0 is deliberate -- unlike verificationCodeCooldownS and
    // availabilityMaxRangeDays (whose floors protect shipped client
    // behaviour), the decline cooldown and the booking notice are policy
    // levers the owner may legitimately switch off.
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
    clientExposed: true,
    description: 'Minimum lead time (hours) for study bookings and moves.',
  },
  recurringHorizonWeeks: {
    default: 8, min: 1, max: 52,
    clientExposed: true,
    description: 'How far ahead (weeks) recurring study sessions are materialized.',
  },
  kidInviteValidityDays: {
    default: 7, min: 1, max: 90,
    description: 'Kid-invite expiry (days).',
  },
  verificationCodeCooldownS: {
    default: 60, min: 60, max: 600,
    clientExposed: true,
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
    clientExposed: true,
    description:
      'How long (days) past appointments stay on dashboards. Also defers redaction of appointment notes (door codes, allergy details) by the same window -- raising it extends retention of that data.',
  },
  availabilityMaxRangeDays: {
    // min = today's value: BookSessionPage requests fixed 14-day pages and
    // a fixed 28-day weekly window, so any smaller sanctioned value would
    // break the shipped client (round-3 review -- same floor precedent as
    // verificationCodeCooldownS).
    default: 28, min: 28, max: 90,
    description: 'Widest availability range (days) a client may query.',
  },
} as const satisfies Record<string, AdminConfigDef>;

/** The keys mirrored into the world-readable `adminConfig/client` doc. */
export const CLIENT_EXPOSED_CONFIG_KEYS = (
  Object.keys(ADMIN_CONFIG_DEFS) as AdminConfigKey[]
).filter((k) => (ADMIN_CONFIG_DEFS[k] as AdminConfigDef).clientExposed === true);

export type AdminConfigKey = keyof typeof ADMIN_CONFIG_DEFS;
