import type { FirestoreTimestamp } from '@ejm/shared-core';
import type { TaskCategory } from '../constants/categories.js';

/**
 * sync-do task document (plan §4.1) — the family's published demand, the
 * demand-first half of the marketplace. Lives at `doTasks/{taskId}`, written
 * by callables only (Admin SDK); read by the owning family, any active
 * enrolled doer for OPEN tasks plus their own assignments, and admin (§7.2).
 */

export type TaskTiming = 'fixed' | 'deadline' | 'recurring' | 'ongoing';
export type TaskStatus = 'open' | 'assigned' | 'completed' | 'cancelled';
export type AdultPresence = 'yes' | 'no' | 'partly';

export interface TaskDoc {
  taskId: string; // == doc id
  familyId: string;
  createdByUserId: string;

  // ── Board-visible identity. Mirrors the publishedSearches PII stance:
  //    area LABEL only, never address or latLng, pre-assignment.
  familyName: string;
  /**
   * resolveAreaLabel(family postcode/city). REQUIRED — decision 17: the
   * owner calls the neighborhood "necessary information for the doer before
   * they accept", so a task cannot exist without one. `doPostTask` refuses
   * (`failed-precondition`, `reason: 'address_required'`) when the family's
   * postcode/city cannot resolve a label, and the wizard routes the parent
   * to complete their address first.
   */
  areaLabel: string;

  // ── What
  category: TaskCategory;
  subCategory: string; // key within the category, or '<cat>_other'
  title: string; // ≤ DO_TASK_TITLE_MAX (80) chars
  description: string; // ≤ DO_TASK_DESCRIPTION_MAX (2000) chars, free text, provider-visible
  /**
   * ≤ DO_TASK_PHOTOS_MAX (6), EXIF-stripped (§11.2). Each entry carries BOTH
   * halves of the storage path `do-photos/{uid}/{photoId}` — the uid is not
   * derivable from the task: photos may be uploaded by either parent of the
   * family, and `task.createdByUserId` is whichever parent hit publish, not
   * necessarily the uploader. `doGetTaskPhotoUrl` signs from these two
   * fields directly.
   */
  photos: { uid: string; photoId: string }[];

  // ── When (discriminated by `timing`; exactly one group is non-null)
  timing: TaskTiming;
  date: string | null; // fixed:     "YYYY-MM-DD"
  startTime: string | null; // fixed:     "HH:MM"
  endTime: string | null; // fixed
  dueDate: string | null; // deadline:  "YYYY-MM-DD"
  startDate: string | null; // recurring | ongoing
  endDate: string | null; // recurring (null for ongoing)
  cadence: TaskCadence | null; // recurring | ongoing — see below
  estimatedHours: number | null; // family's honest guess, all timings

  // ── Terms
  suggestedBudget: number | null; // optional indication; the OFFER sets the price
  adultPresent: AdultPresence; // decision 7 — declared, not derived
  toolsProvided: boolean | null;
  transportNeeded: boolean; // car/bike expected (dump runs, store pickup)

  // ── Lifecycle
  status: TaskStatus;
  /**
   * LIVE offers — those in `pending` or `pending_guardian`. Incremented by
   * `doSubmitOffer`; **decremented whenever an offer leaves `pending` or
   * `pending_guardian` by any path** — stated as an invariant rather than a
   * list, because an enumeration goes stale (the winner's own
   * `pending → accepted` transition at acceptance and `doCancelTask`'s sweep
   * to `expired` count too). Maintained transactionally.
   *
   * Live, not lifetime, because of what the count is FOR: it bounds §6.4's
   * acceptance-transaction write set, and that write set is exactly the set
   * of live offers the transaction has to decline. A lifetime counter would
   * also refuse a task's 26th offer after 25 withdrawn or declined ones —
   * permanently closing a task that has zero live offers and most needs a
   * new one.
   *
   * BOUND-FACING ONLY — family UIs must NOT render this field. It counts
   * pending_guardian offers, which the family cannot read (§7.2), so a task
   * with 1 pending and 2 pending_guardian would badge "3" against a list
   * showing 1. The family badge counts the family's own fetched offer list
   * instead (§9.1).
   *
   * Known, accepted side channel: the field lives on a family-readable doc,
   * so a family inspecting raw data can infer the CARDINALITY of hidden
   * offers. Deliberate trade — the number carries none of what §7.2
   * protects (identity, message, price, helper of an unapproved offer);
   * recorded so the leak is a decision, not a discovery (§4.1).
   */
  offerCount: number; // live offers; maintained transactionally
  assignedUserId: string | null;
  assignedOfferId: string | null;
  assignedAt: FirestoreTimestamp | null;
  agreedPrice: number | null; // copied from the accepted offer, for the record
  /** Set by the assigned student's mark-done; the sweep auto-completes a task
   *  the family never confirmed after 7 days (§6.5). Needs the
   *  (status, doerMarkedDoneAt) index in §7.3. */
  doerMarkedDoneAt: FirestoreTimestamp | null;
  completedAt: FirestoreTimestamp | null;
  cancelledAt: FirestoreTimestamp | null;
  cancelledBy: 'family' | 'doer' | 'admin' | null;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  expiresAt: FirestoreTimestamp; // server-computed, see §6.3 / computeTaskExpiresAt
}

export interface TaskCadence {
  kind: 'daily' | 'weekly' | 'custom';
  /** weekly: which days. daily: ignored. custom: free text in `note`. */
  days?: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[];
  /** Indicative time of day ("around 18:00"); NOT a booking — nothing blocks. */
  timeHint?: string | null;
  note?: string | null;
}
