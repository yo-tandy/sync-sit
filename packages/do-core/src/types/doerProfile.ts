import type { FirestoreTimestamp, ProfileBase } from '@ejm/shared-core';
import type { TaskCategory } from '../constants/categories.js';

/**
 * sync-do doer profile (plan §3.3). Lives at `users/{uid}.profiles.doer` in
 * the Plan D portable-user schema. The shared `User` type keeps the slot as
 * the generic `ProfileBase` — shared-core must never import from a leaf
 * package — and do-core narrows it to `DoerProfile` at its read sites,
 * exactly as `BabysitterProfile` and `TutorProfile` do for their slots.
 *
 * Root identity fields (`ejemEmail`, `contactEmail`, `contactPhone`,
 * `whatsapp`, `firstName`, `photoUrl`, `dateOfBirth`) are NOT duplicated
 * here — they are canonical at the root per issue #203, and sync-do reads
 * them through the existing `getEjemEmail` / `getContact` accessors.
 */
export interface DoerProfile extends ProfileBase {
  /**
   * NOTIFICATION OPT-IN ONLY — deliberately not called `searchable`.
   *
   * On profiles.babysitter, `searchable` soft-hides a PROVIDER from a
   * family's search. sync-do inverts the direction: nothing about a doer is
   * searched by families, and the board is something the doer READS. So the
   * sit name would import a meaning that does not exist here, and an
   * implementer could reasonably add a `searchable` check to the §7.2
   * doTasks read rule — which would then be unprovable for any list query
   * whose client does not filter on it.
   *
   * The §7.2 read rule checks `enrollmentComplete` and `status == 'active'`
   * and MUST NOT check this field. Its only consumer is §10's
   * `new_task_matching` digest.
   */
  notifyNewTasks: boolean;
  /**
   * Categories the student wants digests about. ALWAYS EXPLICIT — there is
   * deliberately no "empty means all" convention. The digest's recipient
   * query is an `array-contains` on this field (§7.3), and an empty array
   * matches no `array-contains` predicate, so "empty = all" would silently
   * deliver the exact inverse: zero digests for the students who opted into
   * everything. Instead `doEnrollDoer` preselects ALL categories (the modal
   * intent, stated as data), and an empty array means what the query makes
   * it mean: no digests — the account page copy says so next to the field,
   * equivalent to notifyNewTasks: false.
   */
  categories: TaskCategory[];
  /**
   * When doSendTaskDigest last sent this student a digest — the per-recipient
   * dedupe state §8's batcher rationale calls load-bearing ("the batcher IS
   * that state"): "tasks created since their last digest" and the 6h rate
   * limit are both computed against it. Server-owned (the batcher writes it);
   * an in-memory filter in the job, NOT part of the §7.3 composite — absent
   * means never digested, which the batcher treats as "everything since the
   * profile was created".
   */
  lastDigestAt?: FirestoreTimestamp;
  /** Free-text blurb shown to a family alongside an offer. */
  bio?: string;
  /** Optional: a default flat price hint, purely to pre-fill the offer form. */
  defaultRate?: number | null;
  hasCar?: boolean;
  hasBike?: boolean;
}
