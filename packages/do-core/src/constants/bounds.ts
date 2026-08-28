/**
 * sync-do validation bounds and lifecycle constants (plan §6.3, §6.4, §6.5,
 * §11.4). All ceilings are enforced in the callables AND exported from
 * do-core so the frontend can pre-empt the error rather than surfacing it —
 * the two sides must share the same numbers (§8).
 */

/** Open tasks per family — anti-spam on the board (§6.3). */
export const DO_TASK_MAX_ACTIVE = 5;

/** Pending offers per student — anti-spam on families (§6.3). */
export const DO_OFFER_MAX_ACTIVE = 10;

/**
 * Live offers on one task. The only one of the three ceilings that is a
 * CORRECTNESS constraint rather than a policy: it bounds the §6.4 acceptance
 * transaction's write set (step 8 declines exactly the live offers, and
 * Firestore transactions hard-cap at 500 writes). Enforced in `doSubmitOffer`
 * against the transactionally-maintained live `offerCount` (§4.1); because
 * the count is live rather than lifetime, withdrawn and declined offers give
 * their slot back — a task does not seal itself shut after 25 people have
 * passed through it.
 */
export const DO_OFFER_MAX_PER_TASK = 25;

/**
 * After a cancellation, `doGetAssignedContact` keeps serving the assigned
 * pair for this many days past `cancelledAt` (they already had each other's
 * details; the grace only covers coordinating the aftermath), then refuses
 * (§6.4). The 30-day cancelled-task sweep is the hard stop.
 */
export const DO_CONTACT_GRACE_DAYS = 7;

/**
 * Board TTL for `ongoing` tasks ONLY: `expiresAt = now + 14d`, renewable via
 * any owner edit (`doUpdateTask` recomputes it server-side). Dated tasks
 * (`fixed`/`deadline`/`recurring`) are NOT capped at this TTL — their own
 * date IS their staleness bound (§6.3). 14 days rather than
 * publishedSearches' 7: a task board with an offer cycle needs longer to
 * attract bids than a one-shot broadcast.
 */
export const DO_ONGOING_TTL_DAYS = 14;

/** Task title length ceiling, chars (§4.1). */
export const DO_TASK_TITLE_MAX = 80;

/** Task free-text description length ceiling, chars (§4.1). */
export const DO_TASK_DESCRIPTION_MAX = 2000;

/** Offer free-text message length ceiling, chars (§4.2). */
export const DO_OFFER_MESSAGE_MAX = 1000;

/** Photos per task (§4.1). Each is an EXIF-stripped {uid, photoId} pair. */
export const DO_TASK_PHOTOS_MAX = 6;

/**
 * Free-text ceilings on the smaller fields (PR #306 review round 2): every
 * user-controlled string gets a bound so oversize input fails as
 * `invalid-argument` at the validator, never as `internal` at Firestore's
 * document limit — and the frontend can pre-empt the round trip (§8).
 * Values sit with their siblings: a cadence note and an availability note
 * are half an offer message; a time hint ("around 18:00, after school") is
 * title-sized.
 */
export const DO_CADENCE_NOTE_MAX = 500;
export const DO_CADENCE_TIME_HINT_MAX = 80;
export const DO_AVAILABILITY_NOTE_MAX = 500;

/**
 * Price bounds, EUR — applied to the offer's `price` and the task's optional
 * `suggestedBudget`. The plan exports "price range" from do-core (§8)
 * without fixing numbers; these mirror the platform's existing precedent,
 * publishSearch's `offeredRate` guard (0–1000).
 */
export const DO_PRICE_MIN = 0;
export const DO_PRICE_MAX = 1000;

/**
 * A task the student marked done but the family never confirmed
 * auto-completes after this many days via the daily sweep (§6.5).
 */
export const DO_DONE_AUTOCOMPLETE_DAYS = 7;

/**
 * `doSweepTasks` deletes cancelled tasks (and their offers) older than this
 * — the same window `cleanupOldData` applies to cancelled/rejected
 * appointments (§11.4).
 */
export const DO_CANCELLED_RETENTION_DAYS = 30;

/**
 * Completed-task retention — decision 19, platform-wide: "there's no reason
 * to retain completed engagement indefinitely". `doSweepTasks` deletes
 * completed tasks (and their offers, including the +1 helper's name and age
 * on the accepted offer — the one data subject with no GDPR path of their
 * own, §11.4) once `completedAt` is older than 6 months.
 */
export const DO_COMPLETED_RETENTION_DAYS = 180;
