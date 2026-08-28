import type { FirestoreTimestamp } from '@ejm/shared-core';
import type { TaskCategory } from '../constants/categories.js';
import type { TaskTiming } from './task.js';

/**
 * sync-do offer document (plan §4.2) — a student's bid on a task. Lives at
 * `taskOffers/{offerId}` (top-level, not a subcollection — the student's
 * "my offers" view is a plain `where('doerUserId','==',uid)` query, and the
 * codebase has already decided against collection-group rules once).
 *
 * `offerId == `${taskId}_${doerUserId}`` is deliberate: it makes "one offer
 * per student per task" a STRUCTURAL invariant — at most one document can
 * ever exist for the pair. Re-offering is a resurrection, not a create:
 * `withdrawn`, `expired`, and `declined` with `family_declined` (decision 18)
 * resurrect through the FULL submit path (ceilings re-checked, guardian gate
 * re-run — no laundering a flagged offer past a parent by withdraw+resubmit);
 * `declined` with `sibling_accepted`/`task_closed` and live statuses refuse.
 */

export type OfferStatus =
  | 'pending_guardian' // awaiting the student's supervising parent (§6.2)
  | 'pending' // visible to the family, awaiting their decision
  | 'accepted'
  | 'declined' // family declined, or auto-declined when a sibling won
  | 'withdrawn' // student pulled it
  | 'expired'; // task expired or was cancelled underneath it

export interface OfferDoc {
  offerId: string; // == `${taskId}_${doerUserId}` — see above
  taskId: string;
  doerUserId: string;
  familyId: string; // denormalized from the task, for rules

  /** Denormalized at submit time so the family's offer card renders under the
   *  offer read rule alone — an unrelated family cannot read a doer-only
   *  `users/{uid}` doc (§6.4). Name, photo and bio only: nothing that locates
   *  the student. */
  doerFirstName: string;
  doerPhotoUrl: string | null;
  doerBio: string | null;

  /** The SYMMETRIC denormalization, for the student's side. §7.2 scopes the
   *  doer's task read to open-or-own-assignment, which strands the "My
   *  offers" list for terminal offers: a declined, expired or withdrawn
   *  offer points at a task the student can no longer read. These three
   *  fields let the list render every offer from the offer doc alone — a
   *  dead offer shows its summary line rather than a broken link. Board-
   *  visible facts only: title, category, timing — never the area label or
   *  anything added post-assignment. */
  taskTitle: string;
  taskCategory: TaskCategory;
  taskTiming: TaskTiming;

  price: number; // the student's quote, EUR
  priceBasis: 'flat' | 'hourly';
  message: string; // ≤ DO_OFFER_MESSAGE_MAX (1000) chars, free text

  /** Decision 9: the student may bring one helper. Recorded, shown to the
   *  family, and NOT an account — see the §11.3 caveat. */
  helper: { firstName: string; lastName: string; age: number } | null;

  /** For deadline/recurring/ongoing tasks: when the student proposes to do it. */
  availabilityNote: string | null;

  status: OfferStatus;
  /**
   * ABSENT (not null) on offers whose sub-category needs no guardian consent
   * — `doSubmitOffer` simply does not write the field. This is a rules-layer
   * requirement, not a style choice: Firestore rules' `Map.get(key, default)`
   * substitutes the default only for an ABSENT key, not for one present with
   * value null, so §7.2's `resource.data.get('guardian', {})` reads `{}` only
   * if non-flagged offers omit the field. A present-but-null `guardian` would
   * make that expression return null and error the disjunct.
   */
  guardian?: {
    required: boolean;
    familyId: string | null; // the SUPERVISING family (student's own)
    decidedAt: FirestoreTimestamp | null;
    decidedByUid: string | null;
  };

  // NO `contact` block — deliberately. Decision 16 (owner, PR #243 review):
  // the post-acceptance reveal is served live by `doGetAssignedContact`
  // (§6.4), never persisted here. The owner chose the callable so
  // post-acceptance contact edits are reflected, and it also means no second
  // stored copy of the family's address exists anywhere in sync-do (§11.4).

  declinedReason: 'family_declined' | 'sibling_accepted' | 'task_closed' | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
