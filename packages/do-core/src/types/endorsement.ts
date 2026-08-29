import type { FirestoreTimestamp, ReferenceStatus } from '@ejm/shared-core';

/**
 * A family-submitted endorsement of a doer (plan decision 12 as revised in
 * the PR #243 review, §9.1/§9.2, §13 PR11). Stored in the SHARED
 * `references` collection alongside its two siblings, keyed by `doerUserId`
 * + `appSource: 'do'`:
 *
 *   - sit's `ReferenceDoc`        — `babysitterUserId` (`shared-core`)
 *   - study's `TutorEndorsementDoc` — `tutorUserId`    (`study-core`)
 *   - this                        — `doerUserId`      (`do-core`)
 *
 * WHERE THIS LIVES, and why it is not in `shared-core`: sit's `ReferenceDoc`
 * sits in `shared-core` for historical reasons (that package predates the
 * per-app split and still carries sit's original domain types). The living
 * precedent for a NEW app's endorsement shape is study's, which put
 * `TutorEndorsementDoc` in `study-core` — the app package — and the plan
 * names it "the template" (§9.1) while §12 says "everything else lives in
 * `do-core`". Nothing outside sync-do constructs this shape: the shared GDPR
 * paths key on the FIELD NAME (`REFERENCE_PROVIDER_KEYS` in
 * `shared-functions/admin/referenceKeys.ts`), not on the type, so putting it
 * here costs the platform nothing.
 *
 * Mirrors `TutorEndorsementDoc`'s family-submitted subset. Status vocabulary
 * is identical to references: private (awaiting the doer) → approved |
 * removed. Only `approved`/`published` docs ever render on an offer card —
 * the `status in ['approved','published']` constraint on §9.1's three
 * queries is what makes them provable against the H2-hardened read rule.
 *
 * NO `subject` field (study's is a school subject) and no per-task key: the
 * endorsement vouches for the student, not for one job, and decision 12 is
 * explicit that sync-do gets no completed-task count and no rating. The
 * completed task is the ELIGIBILITY gate inside `doSubmitEndorsement`, not
 * a field on the doc — which also means the 6-month completed-task
 * retention (decision 19, §11.4) can delete the task without orphaning the
 * endorsement.
 */
export interface DoerEndorsementDoc {
  referenceId: string;
  /** users/{uid} of the endorsed doer. Replaces ReferenceDoc.babysitterUserId. */
  doerUserId: string;
  /** Discriminates do endorsements from sit references and study endorsements. */
  appSource: 'do';
  /** Always family-submitted for doer endorsements. */
  type: 'family_submitted';
  status: ReferenceStatus;

  /** users/{uid} of the parent who submitted the endorsement. */
  submittedByUserId: string;
  /** families/{familyId} the endorsement was submitted from. */
  submittedByFamilyId: string;
  /** Denormalized display name of the submitting parent. */
  submittedByName?: string;
  /** Reference contact name provided by the family. */
  refName?: string;
  /** Free-text endorsement body (>= DO_ENDORSEMENT_TEXT_MIN chars). */
  referenceText: string;
  /** Whether the submitting family is an EJM family (copied at write time). */
  isEjmFamily?: boolean;
  /**
   * The task category the endorsement came out of (§4.3 key) — the do-side
   * analogue of study's `subject`, and the reason the offer card can say
   * what a doer was endorsed FOR. Copied from the qualifying completed task
   * at write time; never a client input.
   */
  category?: string;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  approvedAt?: FirestoreTimestamp;
}
