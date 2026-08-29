/** Firestore Timestamp-compatible type (works with both client and admin SDK) */
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
  /**
   * Present on every real admin/client SDK Timestamp; optional here so
   * structural test fakes carrying only seconds/nanoseconds/toDate keep
   * satisfying the interface. Callers use `?.toMillis?.()` and degrade.
   */
  toMillis?: () => number;
}

/** Latitude/Longitude pair */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Notification channel preferences */
export interface NotifChannels {
  push: boolean;
  email: boolean;
}

// ---------------------------------------------------------------------------
// Notification preferences — APP-SCOPED (issue #369, owner decision option 1)
// ---------------------------------------------------------------------------
//
// The pre-#369 shape was a FLAT map of event category -> channels, shared by
// every app. sync-do's twelve NotificationType values (plan §10) reuse those
// same categories, so under the flat shape a sit-only parent's notification
// screen would have offered them toggles that only ever govern an app they
// have never opened — a shared surface exposing a per-app concern to the
// wrong people. The fix is to scope the per-engagement categories by app,
// which is also where the push tokens already live (`fcmTokens` /
// `fcmTokensStudy` / `fcmTokensDo`) and what issue #168 Phase 2 wants.
//
// THE SPLIT, and why each category sits where it does — read from what the
// senders actually gate today, not from taste:
//
//   `newRequest` / `confirmed` / `cancelled`  ->  PER APP
//     Every one of these gates a state change on ONE engagement inside ONE
//     marketplace: a sit request (apps/functions/src/search/
//     sendContactRequest.ts), a study booking (apps/study-functions/src/
//     sessions/bookSession.ts), a do offer (apps/functions/src/do/
//     submitOffer.ts). The three marketplaces differ in volume and stakes by
//     an order of magnitude — sync-do's board is a high-traffic offer feed,
//     a sit request is a rare, high-stakes ask about a child — so "mute new
//     requests" is a question the user can only answer per app. There is no
//     single correct answer to carry across them.
//
//   `reminders` / `references`  ->  SHARED
//     `reminders` gates the upcoming-engagement nudge in every app that has
//     a scheduler (apps/functions/src/scheduled/sendReminders.ts,
//     apps/study-functions/src/scheduled/sendStudySessionReminders.ts). It is
//     not about a marketplace at all: it is about the user's own calendar,
//     of which they have exactly one, and it is the one category whose
//     default is deliberately push-only (`email: false`) because it encodes
//     a CHANNEL habit rather than an interest in a kind of event.
//     `references` gates reference/endorsement notices (apps/functions/src/
//     references/onReferenceCreated.ts, apps/study-functions/src/
//     endorsements/submitTutorEndorsement.ts) — reputation attached to the
//     PERSON, who under the portable-user-entity model (see user.ts) is one
//     identity across the three apps.
//
// EVERY BLOCK IS OPTIONAL, and absence is not a mute: a missing block or a
// missing category resolves to the documented default for that category via
// `resolveNotifPref` (utils/notifPrefs.ts). Nothing reads these objects
// directly — go through the resolver, which also owns the transitional read
// of the legacy flat shape.

/** The three app worlds a per-engagement preference can be scoped to. */
export type NotifAppScope = 'sit' | 'study' | 'do';

/** Every block a `NotifPrefs` document can carry. */
export type NotifScope = 'shared' | NotifAppScope;

/** Categories that belong to the person, not to one app's marketplace. */
export type SharedNotifCategory = 'reminders' | 'references';

/** Categories that describe one engagement inside one app's marketplace. */
export type AppNotifCategory = 'newRequest' | 'confirmed' | 'cancelled';

export type NotifCategory = SharedNotifCategory | AppNotifCategory;

/** Cross-app preferences: one calendar, one reputation. */
export type SharedNotifPrefs = Partial<Record<SharedNotifCategory, NotifChannels>>;

/** Per-app preferences: one marketplace's engagement lifecycle. */
export type AppNotifPrefs = Partial<Record<AppNotifCategory, NotifChannels>>;

/**
 * App-scoped notification preferences, as stored at `users/{uid}.notifPrefs`.
 *
 * Blocks are optional because a user only accumulates the ones their surfaces
 * write; the resolver treats an absent block as "no choice expressed yet".
 */
export interface NotifPrefs {
  shared?: SharedNotifPrefs;
  sit?: AppNotifPrefs;
  study?: AppNotifPrefs;
  do?: AppNotifPrefs;
}

/**
 * The pre-#369 FLAT shape. TRANSITIONAL — kept only so readers survive the
 * deploy window in which un-backfilled docs still carry it. Nothing may write
 * it. Removed together with the `resolveNotifPref` fallback and the backfill
 * script once `scripts/backfill-369-app-scoped-notifprefs.cjs` has run
 * against prod (see the script header and issue #369's follow-up).
 */
export interface LegacyNotifPrefs {
  newRequest?: NotifChannels;
  confirmed?: NotifChannels;
  cancelled?: NotifChannels;
  reminders?: NotifChannels;
  references?: NotifChannels;
}

/**
 * What a `users/{uid}` doc may ACTUALLY carry mid-migration: either shape, or
 * (for a doc written before the backfill but after this release) both. Only
 * the resolver and the backfill accept this type; every other reader takes
 * the narrow `NotifPrefs`, so the compiler flags any reader still reaching
 * for a flat key.
 */
export type StoredNotifPrefs = NotifPrefs & LegacyNotifPrefs;

/** Product defaults for the cross-app block. */
export const DEFAULT_SHARED_NOTIF_PREFS: Required<SharedNotifPrefs> = {
  reminders: { push: true, email: false },
  references: { push: true, email: true },
};

/** Product defaults for one app block. */
export const DEFAULT_APP_NOTIF_PREFS: Required<AppNotifPrefs> = {
  newRequest: { push: true, email: true },
  confirmed: { push: true, email: true },
  cancelled: { push: true, email: true },
};

/**
 * Default notification preferences. Note `reminders.email` is FALSE by
 * design — these are per-category product decisions, which is exactly why a
 * missing preference must resolve to this table and never to a blanket
 * "notify" (see resolveNotifPref).
 */
export const DEFAULT_NOTIF_PREFS: Required<NotifPrefs> = {
  shared: { ...DEFAULT_SHARED_NOTIF_PREFS },
  sit: { ...DEFAULT_APP_NOTIF_PREFS },
  study: { ...DEFAULT_APP_NOTIF_PREFS },
  do: { ...DEFAULT_APP_NOTIF_PREFS },
};
