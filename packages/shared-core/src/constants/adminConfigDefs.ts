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
    default: 60, min: 60, max: 600,
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
    // min = today's value: BookSessionPage requests fixed 14-day pages and
    // a fixed 28-day weekly window, so any smaller sanctioned value would
    // break the shipped client (round-3 review -- same floor precedent as
    // verificationCodeCooldownS).
    default: 28, min: 28, max: 90,
    description: 'Widest availability range (days) a client may query.',
  },
} as const satisfies Record<string, AdminConfigDef>;

export type AdminConfigKey = keyof typeof ADMIN_CONFIG_DEFS;
