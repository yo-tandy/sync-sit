# Sync-Do Project Plan

> **Status:** planning draft, 2026-08-27. Owner decisions in §2 are settled;
> everything marked **OPEN** in §17 is not.
>
> Companion docs: `docs/sync-study-project-plan.md` (the template this plan
> follows), `docs/shared-modules-roadmap.md` (the shared-package contract).

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Decisions Taken](#2-decisions-taken)
3. [Architecture](#3-architecture)
4. [Domain Model](#4-domain-model)
5. [Category Taxonomy](#5-category-taxonomy)
6. [Task & Offer Lifecycle](#6-task--offer-lifecycle)
7. [Firestore: Collections, Rules, Indexes](#7-firestore-collections-rules-indexes)
8. [Cloud Functions](#8-cloud-functions)
9. [Frontend Surfaces](#9-frontend-surfaces)
10. [Notifications](#10-notifications)
11. [Safety, Privacy & GDPR](#11-safety-privacy--gdpr)
12. [Shared-Package Impact](#12-shared-package-impact)
13. [Delivery Plan](#13-delivery-plan)
14. [Testing Plan](#14-testing-plan)
15. [V1 Scope Decisions](#15-v1-scope-decisions)
16. [Future Roadmap](#16-future-roadmap)
17. [Open Questions & Risks](#17-open-questions--risks)

---

## 1. Project Overview

### What we're building

**sync-do** is the third app in the Sync platform for the EJM (École Jeannine
Manuel) community in Paris. EJM students take on practical, one-off tasks that
families need done — plant care during the holidays, packing a move, assembling
flat-pack furniture, staffing a birthday party, fixing the Wi-Fi.

### The inversion

sync-sit and sync-study are **supply-first**: providers publish availability,
families search it. sync-do is **demand-first**: families publish tasks,
students offer to do them.

```
sync-sit / sync-study            sync-do
─────────────────────            ───────
babysitter publishes             family posts a task
  availability                     │
  │                                ├── Léa offers  €40  "done IKEA before"
family searches                    ├── Adam offers €35
  → picks a provider               └── Sara offers €50
  → sends a request                        │
  → provider accepts               family accepts ONE
                                     → task assigned
```

There is prior art in the repo. Issue #207 shipped `publishedSearches` — a
family's *deliberately broadcast* demand, readable by every active provider of
the matching app. sync-do is that idea promoted from a secondary channel to the
whole product, with a real offer/selection lifecycle attached. §12 lists what
carries over directly.

### How the three apps relate

| Aspect | sync-sit | sync-study | **sync-do** |
|---|---|---|---|
| Provider | Babysitter | Tutor | **Doer** |
| Consumer | Family | Family | Family |
| Direction | Family searches supply | Family searches supply | **Family publishes demand** |
| Selection | Family requests → provider accepts | Family books slot → tutor accepts | **Students offer → family picks one** |
| Pricing | Babysitter's hourly rate | Tutor's per-subject rate | **Student quotes per task** |
| Time | Fixed date + start/end | Calendar slot, tutor-defined lengths | **Fixed / deadline / recurring / ongoing** |
| Blocks shared availability | Yes | Yes | **No** (§2, decision 10) |
| Money | Offline | Offline | Offline |

### Goals

1. Ship a demand-board marketplace with an offer→selection lifecycle.
2. Reuse the platform's identity, family, verification, guardianship, audit and
   notification machinery rather than re-growing it.
3. Do not regress sync-sit or sync-study — every step leaves both buildable and
   deployable.

---

## 2. Decisions Taken

Settled with the owner during planning on 2026-08-27. These are inputs to the
design, not proposals.

| # | Question | Decision |
|---|---|---|
| 1 | Match model | **Offers → parent picks.** Students submit an offer; the family reviews competing offers and accepts one. |
| 2 | Pricing | **Student quotes in their offer.** The family may post an optional suggested budget; the offer carries the actual number. |
| 3 | Time models | **All four** — fixed appointment, deadline window, multi-day recurring, open-ended/ongoing. |
| 4 | Provider account | **New `profiles.doer`** on the existing `users/{uid}` document, alongside `babysitter` and `tutor`. One identity, three apps. |
| 5 | Taxonomy | **Categories + sub-categories**, each carrying a curated "things to cover" overview. The description field itself stays **free text**. |
| 6 | Categories in V1 | The five named, plus **Errands** and **Pet & house-sitting**. Seven total. |
| 7 | Safety gates | **Reuse the family verification gate**; **guardian consent** for flagged sub-categories; **adult-present declaration** on the task. *No per-category minimum age.* |
| 8 | Payments | **None.** The accepted price is recorded for clarity; the family pays the student directly. No PSP, no regulated money handling. |
| 9 | Team tasks | **One assigned student**, whose offer may declare a **+1 helper**. No multi-offer accounting. |
| 10 | Availability blocking | **Nothing blocks.** sync-do writes no schedule overrides; sit and study bookings are unaffected. |
| 11 | Monorepo shape | **Third web app + `do-core`; callables live in an existing functions codebase**, not a third one. |

Settled in plan review, same day:

| # | Question | Decision |
|---|---|---|
| 12 | Choosing between offers | **Existing endorsements on the offer card. No completed-task count**, and no new rating system. |
| 13 | Overnight house-sitting | **Cut.** Not relevant to the product; removed from the taxonomy entirely. |
| 14 | Family verification | **Mandatory to post**, and **portable across all three apps** — the same approval that unlocks sync-sit and sync-study unlocks sync-do. Never re-verify per app. |
| 15 | Liability & insurance | **The family's responsibility. The platform performs the handshake only.** Insurance, accidents, and damage disputes (including a doer breaking what they assembled) are between the family and the student — stated in the terms and in-product, and true of sync-sit today as much as sync-do. |

Two decisions carry known trade-offs that the design mitigates rather than
removes — see §11 (the +1 helper is an unvetted person on site) and §17 R2
(nothing blocks ⇒ a student can double-book).

---

## 3. Architecture

### 3.1 One Firebase project, three hosting targets

sync-do joins the existing project. Same Auth instance (SSO across all three
apps for free), same Firestore, same rules file, same storage bucket.

```
.firebaserc  targets.sync-sit.hosting
  web    → sync-sit          (apps/web)
  study  → sync-study-app    (apps/study-web)
  do     → sync-do-app       (apps/do-web)        ◀ new
```

`firebase.json` gains a third `hosting` entry, copied from the `study` entry
(same security headers, same SPA rewrite, same immutable asset caching).

### 3.2 Code layout

Per decision 11, sync-do is a new **web app** and a new **core package**, but
its callables live in an existing functions codebase.

```
apps/
  web/                sync-sit frontend
  functions/          codebase "default"  ── sync-sit callables + sync-do callables ◀
  study-web/          sync-study frontend
  study-functions/    codebase "study"
  do-web/             sync-do frontend                                              ◀ new
packages/
  shared-core/        app-agnostic types, constants, utils
  shared-ui/          React component library + themes
  shared-functions/   cloud-function helpers (guardian, handoff, schedule, …)
  sit-core/
  study-core/
  do-core/            task + offer types, taxonomy content, validation            ◀ new
```

**Which codebase hosts the callables:** `apps/functions` (codebase `default`).

Not because the other one lacks the ingredients — it does not. An earlier draft
said `apps/study-functions` "has none of the family-verification surface", and
that is false: it checks `verification.isFullyVerified` and reads `families`
in 8 of the 20 files that register a callable or job (10 of those 20 read `families`), and uses `resolveAreaLabel`, `writeUserActivity` and
the guardian helpers throughout. §11.1 of this same document cites
`publishTutorSearch.ts:54` as proof that *both* codebases read the verification
field, so the two sections contradicted each other and §11.1 was the correct
one. Both codebases could host this.

The actual reasons, which are about fit rather than capability:

- **`publishSearch` is the nearest analogue and lives here.** sync-do's board
  is `publishedSearches` promoted to a product; building its successor beside
  its ancestor keeps the PII stance, the expiry maths and the sweep in one
  place to read.
- **The guardian *callables* are registered here** — enrollment, oversight,
  `redeemKidInvite` — and the guardian consent gate (§6.2) is the one piece of
  sync-do that leans hardest on them.
- **Decision 11 asked for an existing codebase**, and between two viable ones
  the tie-break is where the closest prior art sits.

New code goes in `apps/functions/src/do/**` with a `do` prefix on every
exported callable name (`doPostTask`, `doSubmitOffer`, …) so the two domains
never collide in one deploy unit.

**Consequence to accept:** every sync-do deploy redeploys the sync-sit
functions codebase. That is already true of sync-sit's own changes, and the
merge workflow deploys both codebases on every merge to `main` regardless
(`project_prod_deploy_pipeline`), so the blast radius is unchanged in practice.

### 3.3 The `doer` profile

`users/{uid}.profiles` gains a third key. From `packages/shared-core/src/types/user.ts`:

```ts
profiles: {
  babysitter?: ProfileBase;
  tutor?: ProfileBase;
  doer?: ProfileBase;        // ◀ new — see the note below on why not DoerProfile
  parent?: ParentProfile;
}
```

**Why `ProfileBase` and not `DoerProfile` in that slot.** `shared-core` must
never import from a leaf package — `user.ts:10-12` states the rule, and today
both `babysitter` and `tutor` are typed as the generic `ProfileBase` for
exactly that reason, with `BabysitterProfile` living in `@ejm/sit-core` and
`TutorProfile` in `@ejm/study-core`. Since `do-core` imports `User` and
`ProfileBase` *from* shared-core, typing the slot as `DoerProfile` would close
a dependency cycle. `doer` follows its siblings: generic in the shared type,
narrowed to `DoerProfile` at the do-core read sites.

```ts
// packages/do-core/src/types/doerProfile.ts
export interface DoerProfile extends ProfileBase {   // ProfileBase = { enrollmentComplete: boolean }
  /**
   * NOTIFICATION OPT-IN ONLY — deliberately not called `searchable`.
   *
   * On profiles.babysitter, `searchable` soft-hides a PROVIDER from a
   * family's search (firestore.rules:273-275). sync-do inverts the
   * direction: nothing about a doer is searched by families, and the board is
   * something the doer READS. So the sit name would import a meaning that
   * does not exist here, and an implementer could reasonably add a
   * `searchable` check to the §7.2 doTasks read rule — which would then be
   * unprovable for any list query whose client does not filter on it.
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
   * everything. Instead `doEnrollDoer` preselects ALL
   * categories (the modal intent, stated as data), and an empty array means
   * what the query makes it mean: no digests — the account page copy says so
   * next to the field, equivalent to notifyNewTasks: false.
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
```

Root identity fields (`ejemEmail`, `contactEmail`, `contactPhone`, `whatsapp`,
`firstName`, `photoUrl`, `dateOfBirth`) are **not** duplicated — they are
already canonical at the root per issue #203, and sync-do reads them through
the existing `getEjemEmail` / `getContact` accessors.

**Cross-app enrollment.** A student who is already a babysitter or tutor lands
in sync-do authenticated with `profiles.doer` absent. The auth guard routes
them to an abbreviated flow: skip email verification, skip identity, skip
password — collect only categories, transport, bio, consent. This is the exact
pattern already shipped for sit↔study (`docs/shared-modules-roadmap.md` Plan D,
and the frictionless switch in PRs #145/#146). A brand-new student gets the
full enrollment flow from `@ejm/shared-ui/enrollment/*`.

**App switcher.** The existing two-way switch becomes three-way — but the
backend needs nothing. `packages/shared-functions/src/handoff/appHandoff.ts` is
already app-agnostic: `createAppHandoffCode` stores `{ uid, tokenHash,
createdAt, expiresAt }` with no target app anywhere, and `redeemAppHandoffCode`
takes `{ code }` and returns a custom sign-in token that any origin can redeem.
The two-way assumption lives in the **frontend switcher UI** (a button that
goes to "the other app", which now has to choose between two) and in the
**Firebase Auth authorized-domains list**, which needs a `sync-do-app` entry —
a console setting, and a day-one blocker for PR2's "empty shell that builds and
deploys". CORS is fine: `getCorsOrigin()` returns `true`, so there is no
allowlist to extend.

### 3.4 What sync-do deliberately does *not* touch

- `schedules/{userId}` and its `overrides` subcollection — decision 10.
- The `appointments` and `study-sessions` collections.
- The matching/Haversine search engine — sync-do has a board, not a search.
- Payment, invoicing, or any money movement.

---

## 4. Domain Model

Two documents carry the whole product: a **Task** (the family's demand) and an
**Offer** (a student's bid on it).

### 4.1 TaskDoc

```ts
// packages/do-core/src/types/task.ts

export type TaskTiming = 'fixed' | 'deadline' | 'recurring' | 'ongoing';
export type TaskStatus = 'open' | 'assigned' | 'completed' | 'cancelled';
export type AdultPresence = 'yes' | 'no' | 'partly';

export interface TaskDoc {
  taskId: string;                    // == doc id
  familyId: string;
  createdByUserId: string;

  // ── Board-visible identity. Mirrors the publishedSearches PII stance:
  //    area LABEL only, never address or latLng, pre-assignment.
  familyName: string;
  areaLabel: string | null;          // resolveAreaLabel(family postcode/city)

  // ── What
  category: TaskCategory;
  subCategory: string;               // key within the category, or '<cat>_other'
  title: string;                     // ≤ 80 chars
  description: string;               // ≤ 2000 chars, free text, provider-visible
  /**
   * ≤ 6, EXIF-stripped (§11). Each entry carries BOTH halves of the storage
   * path `do-photos/{uid}/{photoId}` — the uid is not derivable from the
   * task: photos may be uploaded by either parent of the family, and
   * `task.createdByUserId` is whichever parent hit publish, not necessarily
   * the uploader. `doGetTaskPhotoUrl` signs from these two fields directly.
   */
  photos: { uid: string; photoId: string }[];

  // ── When (discriminated by `timing`; exactly one group is non-null)
  timing: TaskTiming;
  date: string | null;               // fixed:     "YYYY-MM-DD"
  startTime: string | null;          // fixed:     "HH:MM"
  endTime: string | null;            // fixed
  dueDate: string | null;            // deadline:  "YYYY-MM-DD"
  startDate: string | null;          // recurring | ongoing
  endDate: string | null;            // recurring (null for ongoing)
  cadence: TaskCadence | null;       // recurring | ongoing — see below
  estimatedHours: number | null;     // family's honest guess, all timings

  // ── Terms
  suggestedBudget: number | null;    // optional indication; the OFFER sets the price
  adultPresent: AdultPresence;       // decision 7 — declared, not derived
  toolsProvided: boolean | null;
  transportNeeded: boolean;          // car/bike expected (dump runs, store pickup)

  // ── Lifecycle
  status: TaskStatus;
  /**
   * LIVE offers — those in `pending` or `pending_guardian`. Incremented by
   * `doSubmitOffer`; **decremented whenever an offer leaves `pending` or
   * `pending_guardian` by any path.** Stated as an invariant rather than a
   * list, because an enumeration is what goes stale: an earlier draft named
   * withdraw, decline and the sibling auto-decline at acceptance, and silently
   * omitted the winner's own `pending → accepted` transition (§6.4 step 6)
   * and `doCancelTask`'s sweep to `expired`. An assigned task's card would
   * then have read "1 offer" forever. Maintained transactionally.
   *
   * Live, not lifetime, because of what the count is FOR: it bounds §6.4's
   * write set, and that write set is exactly the set of live offers the
   * acceptance transaction has to decline. A lifetime counter would bound the
   * transaction too, but it would also refuse a task's 26th offer after 25
   * withdrawn or declined ones — permanently closing a task that has zero live
   * offers and most needs a new one. (An earlier draft of this plan chose
   * lifetime and attributed that failure to the live reading; it is the other
   * way round.)
   *
   * BOUND-FACING ONLY — family UIs must NOT render this field. It counts
   * pending_guardian offers, which the family cannot read (§7.2), so a task
   * with 1 pending and 2 pending_guardian would badge "3" against a list
   * showing 1. §9.1's badge counts the family's own fetched offer list
   * instead.
   *
   * Known, accepted side channel: the field lives on a family-readable doc,
   * and Firestore rules cannot hide one field, so a family inspecting raw
   * data can infer the CARDINALITY of hidden offers (a decrement with no
   * visible change implies a guardian-gated offer existed). Deliberate
   * trade: what §7.2 protects is the identity, message, price and helper of
   * an unapproved offer — none of which this number carries — and the
   * alternative (no counter, cap enforced by a transaction-time aggregate
   * query) buys cardinality secrecy at the cost of the §6.4 bound being
   * maintained nowhere the UI or ops can see. Recorded so the leak is a
   * decision, not a discovery.
   */
  offerCount: number;                // live offers; maintained transactionally
  assignedUserId: string | null;
  assignedOfferId: string | null;
  assignedAt: FirestoreTimestamp | null;
  agreedPrice: number | null;        // copied from the accepted offer, for the record
  /** Set by the assigned student's mark-done; the sweep auto-completes a task
   *  the family never confirmed after 7 days (§6.5). Needs the
   *  (status, doerMarkedDoneAt) index in §7.3. */
  doerMarkedDoneAt: FirestoreTimestamp | null;
  completedAt: FirestoreTimestamp | null;
  cancelledAt: FirestoreTimestamp | null;
  cancelledBy: 'family' | 'doer' | 'admin' | null;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  expiresAt: FirestoreTimestamp;     // server-computed, see §6.3
}

export interface TaskCadence {
  kind: 'daily' | 'weekly' | 'custom';
  /** weekly: which days. daily: ignored. custom: free text in `note`. */
  days?: ('sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat')[];
  /** Indicative time of day ("around 18:00"); NOT a booking — nothing blocks. */
  timeHint?: string | null;
  note?: string | null;
}
```

**No `instances` subcollection.** sync-study tracks per-occurrence state because
each occurrence is a bookable slot that blocks availability. Decision 10 removes
that requirement: a recurring sync-do task is one agreement between two people,
described by a cadence. If per-visit check-off is wanted later it is additive
(§16).

**Contact details are not on the task.** The family's address, phone and the
student's contact are revealed only on acceptance — §6.4.

### 4.2 OfferDoc

```ts
// packages/do-core/src/types/offer.ts

export type OfferStatus =
  | 'pending_guardian'   // awaiting the student's supervising parent (§6.2)
  | 'pending'            // visible to the family, awaiting their decision
  | 'accepted'
  | 'declined'           // family declined, or auto-declined when a sibling won
  | 'withdrawn'          // student pulled it
  | 'expired';           // task expired or was cancelled underneath it

export interface OfferDoc {
  offerId: string;               // == `${taskId}_${doerUserId}` — see below
  taskId: string;
  doerUserId: string;
  familyId: string;              // denormalized from the task, for rules

  /** Denormalized at submit time so the family's offer card renders under the
   *  offer read rule alone — an unrelated family cannot read a doer-only
   *  `users/{uid}` doc (§6.4). Name, photo and bio only: nothing that locates
   *  the student. */
  doerFirstName: string;
  doerPhotoUrl: string | null;
  doerBio: string | null;

  /** The SYMMETRIC denormalization, for the student's side. §7.2 scopes the
   *  doer's task read to open-or-own-assignment (the enumeration fix), which
   *  strands the "My offers" list for terminal offers: a declined, expired or
   *  withdrawn offer points at a task the student can no longer read. These
   *  three fields let the list render every offer from the offer doc alone —
   *  a dead offer shows its summary line rather than a broken link. Board-
   *  visible facts only: title, category, timing — never the area label or
   *  anything added post-assignment. */
  taskTitle: string;
  taskCategory: TaskCategory;
  taskTiming: TaskTiming;

  price: number;                 // the student's quote, EUR
  priceBasis: 'flat' | 'hourly';
  message: string;               // ≤ 1000 chars, free text

  /** Decision 9: the student may bring one helper. Recorded, shown to the
   *  family, and NOT an account — see the §11 caveat. */
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
    familyId: string | null;       // the SUPERVISING family (student's own)
    decidedAt: FirestoreTimestamp | null;
    decidedByUid: string | null;
  };

  /** Written by doAcceptOffer inside the §6.4 transaction, on the ACCEPTED
   *  offer only — the two-way reveal. ABSENT (optional, not null) on every
   *  other offer, matching the prose and `guardian`'s convention above: no
   *  rule reads `contact` today, but typing absence as `| null` is exactly
   *  the shape that bit `guardian`, and consistency is what keeps the
   *  distinction legible. */
  contact?: {
    familyAddress: string;
    familyPhone: string | null;
    doerContactEmail: string | null;
    doerContactPhone: string | null;
    doerWhatsapp: string | null;
  };

  declinedReason: 'family_declined' | 'sibling_accepted' | 'task_closed' | null;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
```

**``offerId == `${taskId}_${doerUserId}` ``** is deliberate. It makes "one offer
per student per task" a *structural* invariant: at most one document can ever
exist for the pair. A student who wants to change their price edits in place
(`updateOffer`, allowed while `pending`) — or withdraws and re-offers, and
**re-offering is a resurrection, not a create.** After `doWithdrawOffer` the
document still exists in `withdrawn`, so `doSubmitOffer` finding an existing
doc must handle it by status, and each branch is pinned here rather than
discovered at PR6:

- **`withdrawn` or `expired` → resurrect**, running the FULL submit path
  again: re-check `DO_OFFER_MAX_PER_TASK` and `DO_OFFER_MAX_ACTIVE`,
  re-increment the live `offerCount`, and **re-run the guardian gate** — a
  student must not be able to launder a flagged-category offer past their
  parent by withdrawing an approved one and re-submitting. Resurrection
  resets `price`/`message`/`helper` from the new submission.
- **`declined` with `declinedReason: 'family_declined'` → refused**
  (`reason: 'family_declined_no_reoffer'`). The family said no to this
  student for this task; letting a tap re-open that is the re-notification
  problem the platform's decline cooldowns exist to prevent. Recorded as the
  default; §17 Q7 gives the owner the override.
- **`declined` with `'sibling_accepted'` or `'task_closed'` → refused** — the
  task is no longer open, and `doSubmitOffer`'s task-status check catches it
  before the offer doc is even consulted.
- **`pending` / `pending_guardian` / `accepted` → refused** as already-exists.

**Top-level collection, not a subcollection.** `taskOffers/{offerId}` rather
than `tasks/{taskId}/offers/{offerId}`. The student's "my offers" view is a
plain `where('doerUserId','==',uid)` query; as a subcollection it would need a
collection-group read rule, and the codebase has already decided against
collection-group rules once (`study-sessions/instances`, see `firestore.rules`).
This mirrors `studyContactRequests`, which is top-level for the same reason.

### 4.3 Category taxonomy types

The taxonomy is **content, not schema**: adding a sub-category or editing a
consideration list is an i18n string change with no migration.

```ts
// packages/do-core/src/constants/categories.ts

export type TaskCategory =
  | 'green_thumb' | 'boxes' | 'ikea' | 'party'
  | 'it' | 'errands' | 'pet_house';

export interface SubCategoryDef {
  key: string;                    // e.g. 'ikea_assembly'
  category: TaskCategory;
  /** i18n keys for the "things to cover" list — EN + FR in do-core's content
   *  module, rendered in three places (§5). */
  considerationKeys: string[];
  flags: {
    /** Sub-category is flagged: a governed student's supervising parent must
     *  approve the offer before the family sees it (decision 7). */
    guardianConsent?: boolean;
    /** The posting form nudges the family toward adultPresent: 'yes'. */
    recommendAdultPresent?: boolean;
    /** Student would handle the family's money or card — the Errands policy. */
    handlesFamilyMoney?: boolean;
    /** A living creature depends on this being done. */
    livingCreature?: boolean;
    /** Transport is usually required. */
    transport?: boolean;
  };
}
```

---

## 5. Category Taxonomy

Seven categories. Each sub-category carries a **considerations list** — a
curated set of "things worth covering" that renders in three places:

1. **Beside the family's description box** while posting, as hints. It does not
   pre-fill or constrain the text; the description stays free.
2. **On the task detail** a student sees, so they know what to ask before
   offering.
3. **As an optional pre-start checklist** on the assigned task, for both sides.

Lists below are the V1 content. They are i18n keys in
`packages/do-core/src/content/considerations.{en,fr}.ts`.

### 5.1 Green-Thumb `green_thumb`

Sub-categories: vacation indoor plant care · garden & terrace watering while
away · lawn mowing and edging · planting & potting · weeding, pruning and
tidy-up · green-waste and bin duty · other.

**Things to cover:** access — keys, door codes, alarm · the exact absence dates
and how often to come · which plants, how much water, which ones are fussy ·
where the watering can, hose and tools live · outdoor tap access · pets on site
· allergies · what to do if something dies or the weather turns · whether photo
updates are expected · mower type, petrol or electric · garden size · where
green waste goes.

Flags: mowing and pruning → `guardianConsent`. Vacation care → `livingCreature`
(a plant is a low-stakes one, but the same "someone is depending on this"
prompt applies). Green-waste runs → `transport`.

### 5.2 Boxes `boxes`

Sub-categories: packing before a move · unpacking and putting away · loading
and unloading a van · cellar, attic or garage clear-out · moving furniture
within the home · dump and donation runs · other.

**Things to cover:** how much lifting, and which floor — is there a lift · how
many rooms or boxes, realistically · who supplies boxes, tape and labels ·
fragile or valuable items and who handles them · the move date is usually
immovable — say so · an honest duration estimate · working alone or alongside
others · what happens if something breaks · whether a car or licence is needed ·
gloves and suitable clothing.

Flags: van loading, clear-outs and furniture moving → `guardianConsent`,
`recommendAdultPresent`. Dump runs → `transport`.

### 5.3 Ikea `ikea`

Sub-categories: assembly from instructions · disassembly before a move · wall
mounting and anchoring · store pick-up and transport · fixing or adjusting
existing furniture · other.

**Things to cover:** how many items and which — links or model names · are the
instructions and all the parts actually there · which tools are on site vs
bring-your-own · drilling into walls: landlord permission, and pipes and cables
behind them · which items genuinely need two people · floor protection · who
disposes of the packaging · a realistic time per item · ladder and ceiling
height.

Flags: wall mounting → `guardianConsent`, `recommendAdultPresent`. Store pick-up
→ `transport`.

### 5.4 Party `party`

Sub-categories: setup and decoration · kids' entertainment during the party ·
serving and catering help · music, photo and tech · clean-up after · baking and
food prep beforehand · other.

**Things to cover:** the date and a **hard end time** — a late finish means
transport home and a guardian conversation · guest count and the ages of any
children · whether this is actually child supervision, in which case sync-sit's
rules and ratios are the right frame, not this one · alcohol present · food
handling and allergies · dress code · is the student fed · who else is helping ·
is an adult present throughout · neighbours and noise · what time to arrive
before guests.

Flags: kids' entertainment → `guardianConsent`, `recommendAdultPresent`, and
the posting form shows an explicit **"is this childcare?" → link to sync-sit**
interstitial. Serving → `recommendAdultPresent`.

### 5.5 IT `it`

Sub-categories: device setup — phone, laptop, printer, tablet · Wi-Fi, router
and smart home · data transfer and backup · troubleshooting and clean-up ·
teaching a person, e.g. a grandparent phone lesson · TV, audio and streaming ·
other.

**Things to cover:** **passwords — the family types them, the student never
collects or keeps them** · what personal data the student will be able to see ·
back up before changing anything · brand, OS, model and age of the device ·
whether the work voids a warranty · who owns the account being touched · **no
purchases on the family's behalf** · remote or in person · agree a concrete
outcome, not "make it faster" · a short written summary of what changed.

Flags: none require guardian consent (low physical risk); data transfer and
troubleshooting carry the strongest privacy copy in the list.

### 5.6 Errands `errands`

Sub-categories: grocery and market shopping · pharmacy pick-up · parcels, post
and drop-off points · dry cleaning and laundry · returns and exchanges · other.

**Things to cover:** **how the money works — a pre-paid card, cash handed over
and counted, or reimbursement on a receipt** · always keep the receipt · what to
do when an item is out of stock — substitute or skip · prescriptions and
pharmacy ID requirements · spending ceiling · how far, and by what transport ·
cold chain for frozen or fresh items · how heavy the load will be · where to
leave things if nobody is home.

Flags: every sub-category → `handlesFamilyMoney`; pharmacy →
`guardianConsent`. `handlesFamilyMoney` surfaces a standing platform line on
the task and the offer: **sync-do handles no money and mediates no
reimbursement disputes** — agree the mechanism in writing before starting.

### 5.7 Pet & house-sitting `pet_house`

Sub-categories: dog walking · feeding and litter while the family is away ·
drop-in checks on an empty flat · vet or grooming trips · other.

> **Cut from V1 (decision 13): overnight presence.** It was the highest-risk,
> least task-shaped item in the taxonomy — a student sleeping alone in a
> stranger's empty home is a different product with different duty-of-care
> obligations. Not deferred, removed.

**Things to cover:** the animal — species, breed, size, age, temperament, and
whether it has ever bitten or bolted · the exact feeding routine and quantities
· medication · lead, harness and where to walk · behaviour with other dogs and
with strangers · **the vet's name, number, and who authorises treatment and
pays** · keys, door codes and alarm · what counts as an emergency and who to
call first · neighbours to notify · insurance, if any.

Flags: every sub-category → `livingCreature`; dog walking and vet trips →
`guardianConsent` — **and so do drop-in checks and feeding-while-away.** Those
two put a student alone in a stranger's empty home with keys, door codes and
the alarm, which is the overnight sub-category decision 13 cut, minus the
sleeping. With no *per-sub-category* age gate (§11.1, decision 7), leaving
them unflagged would mean no gate at all for exactly that scenario on either
population that reaches it: a governed student of any age — whom this flag now
covers — and an ungoverned student, 15 by construction, whom nothing else
covers (the §17 Q2 case);
flagging them closes it with machinery the plan already has, without reopening
decision 7.

The posting form additionally requires an explicit `adultPresent: 'no'`
acknowledgement for these two rather than nudging toward `'yes'` — but note
that is a declaration by the *family* and gates nothing on the student's side.
The guardian flag is what does the gating.

---

## 6. Task & Offer Lifecycle

### 6.1 States

```
                 ┌──────────── withdrawn / expired (offer)
                 │
  ┌────────┐  offer   ┌─────────────────┐  accept   ┌──────────┐  complete  ┌───────────┐
  │  open  │ ───────▶ │ open (N offers) │ ────────▶ │ assigned │ ─────────▶ │ completed │
  └────────┘          └─────────────────┘           └──────────┘            └───────────┘
       │                      │                          │
       │  expiresAt / withdraw│                          │ cancel (either side)
       ▼                      ▼                          ▼
  ┌───────────┐                                    ┌───────────┐
  │ cancelled │◀───────────────────────────────────│ cancelled │
  └───────────┘                                    └───────────┘
```

Task status is a closed set of four: `open`, `assigned`, `completed`,
`cancelled`. Expiry is *not* a status — following the `publishedSearches`
precedent, an expired task is one where `expiresAt <= now`, filtered
client-side, swept daily, and re-checked server-side by every callable that
acts on it. This avoids a status field that only a scheduled job can advance.

### 6.2 Offering, with guardian consent

```
student taps "I'll do it"
   │
   ├─ sub-category flagged guardianConsent?  ──no──▶ status: 'pending'  ─▶ family sees it
   │                        │yes
   │                        ▼
   │            student has an ACTIVE governedBy link?
   │                 │                    │
   │                no                   yes
   │                 │                    │
   │                 ▼                    ▼
   │           status: 'pending'    status: 'pending_guardian'
   │           (no guardian to ask)   → notify the supervising parent
   │                                  → parent approves in the existing
   │                                    supervised-child surface
   │                                  → status: 'pending', family sees it
```

The consent hook reuses `guardianLinks/{childUid}` and the helpers in
`packages/shared-functions/src/guardian/` — specifically `guardianAccess.ts` for
the "is this caller the supervising parent" check and `oversight.ts` for the
listing surface. No new consent collection.

An offer in `pending_guardian` is **invisible to the family**: the family's
offer list filters on `status == 'pending'`. The student sees their own offer
with an "awaiting your parent" badge.

### 6.3 Expiry

`expiresAt` is server-computed at post time, never client-supplied:

| Timing | `expiresAt` |
|---|---|
| `fixed` | `end of the task's day, Paris wall clock` — dated tasks live until their date |
| `deadline` | `end of dueDate` |
| `recurring` | `end of startDate` — the board offer window closes when the series starts |
| `ongoing` | `now + 14d`, renewable (below) |

Dated tasks are **not** capped at a TTL. An earlier draft applied
`min(now + 14d, …)` across the board, which hard-deleted a far-out task
*before its own date*: a family posting "help me move on 15 October" in late
August would have watched the post silently vanish five weeks before the move
— swept, offers cascaded, no notification, no renewal path.
The TTL exists to keep *undated* demand from going stale, so it applies only
to `ongoing`; a `fixed`/`deadline`/`recurring` task's own date IS its
staleness bound.

For `ongoing`, renewal is `doUpdateTask`: any owner edit of an open task
recomputes `expiresAt` server-side (`now + 14d` again), so keeping a standing
post alive is one tap on its own page — no dedicated renew callable.

14 days rather than `publishedSearches`' 7: a task board with an offer cycle
needs longer to attract bids than a one-shot broadcast. `parisWallTimeToUtc`
from `@ejm/shared-functions/scheduled/parisTime.js` does the day-end maths — it
is already the codebase's answer to this exact problem.

Ceilings, all enforced in the callables and all exported from `do-core` so the
UI can pre-empt the error rather than surfacing it:

| Constant | Bounds | Why |
|---|---|---|
| `DO_TASK_MAX_ACTIVE = 5` | open tasks per family | anti-spam on the board |
| `DO_OFFER_MAX_ACTIVE = 10` | pending offers per student | anti-spam on families |
| `DO_OFFER_MAX_PER_TASK = 25` | offers on one task | bounds §6.4's transaction write set — the only one of the three that is a correctness constraint rather than a policy |

### 6.4 Acceptance — the one transaction that matters

`doAcceptOffer` runs a single Firestore transaction:

**Reads first, then writes — Firestore transactions throw on a read after
any write** (the Admin SDK's "all reads … before all writes"), so the phases
are explicit rather than interleaved:

*Read phase:*

1. Read the task. Assert `status == 'open'` and `expiresAt > now`.
2. Read the offer. Assert `status == 'pending'` and `taskId` matches.
3. Assert the caller is a member of the task's family.
4. Read the offering student's user doc. Assert `status == 'active'` and
   `profiles.doer.enrollmentComplete`.
5. Read the sibling offers (`tx.get` on `taskOffers` where `taskId == t` and
   status is live) — hoisted here because step 8 needs them and no read may
   follow step 6.

*Write phase:*

6. Task → `assigned`; write `assignedUserId`, `assignedOfferId`, `assignedAt`,
   `agreedPrice`.
7. Accepted offer → `accepted`.
8. **Every other `pending` offer on the task (from the step-5 read) →
   `declined`,
   `declinedReason: 'sibling_accepted'`. Every `pending_guardian` offer →
   `expired`** — NOT `declined`, because `declined` is in the family's §7.2
   allow-list. Routing an undecided guardian-gated offer to `declined` would
   let the family read it (doer name, photo, bio, price, message, the
   helper's name and age) the moment they accepted anyone — an action
   entirely under their control, so a family could accept-then-read
   specifically to flush offers a parent never approved. `expired` is the
   status `doCancelTask` already uses for "the task went away underneath
   you," the allow-list already excludes it, and it is the truthful
   description: nobody declined this offer, its moment passed. §6.2's
   invisibility promise thus holds through BOTH exits — guardian denial
   and sibling acceptance.
9. Write notifications: winner, each loser, the winner's guardian if there is
   an active link (outside the transaction — notifications are not
   transactional writes).
10. Audit-log the assignment via `writeUserActivity`.

Step 8 is why acceptance is transactional and not a sequence of writes: a
second parent accepting a different offer concurrently must lose.

**What bounds the write set.** Not `DO_OFFER_MAX_ACTIVE` — that caps pending
offers *per student*, and `DO_TASK_MAX_ACTIVE` caps open tasks *per family*.
Neither limits how many distinct students pile onto one popular task, so the
sibling-decline set in step 8 is bounded by cohort size, not by either
constant. At EJM scale that stays far below Firestore's hard 500-writes-per-
transaction limit, but "very likely fine" is not a bound.

`DO_OFFER_MAX_PER_TASK = 25`, enforced in `doSubmitOffer` against the
transactionally-maintained **live** `offerCount` (§4.1), makes it one: step 8
declines exactly the live offers, so a ceiling on live offers is a ceiling on
the write set. Because the count is live rather than lifetime, withdrawn and
declined offers give their slot back — a task does not seal itself shut after
25 people have passed through it. The refusal is its own error
(`reason: 'task_offer_cap'`) so the student is told the task is oversubscribed
rather than that something broke.

**Contact reveal happens here — and it needs a named mechanism, because the
rules alone cannot deliver it.** Before acceptance, neither side has the
other's address or phone: the board shows `areaLabel` and `familyName` only.
After acceptance each side needs the other's details. Neither half works by
reading the counterparty's document:

- **Student → family address.** `families/{familyId}` is
  `allow read: if isFamilyMember(familyId) || isAdmin()`
  (`firestore.rules:304`). The assigned doer is neither.
- **Family → student contact.** `getContact(user)` takes a `User`, so the
  family would have to read `users/{doerUserId}`. That rule's provider
  disjunct keys on `profiles.babysitter` (`firestore.rules:251-255`), so a
  doer-only student is not readable by an unrelated family. The same gap
  applies *before* acceptance to the offer card in §9.1.

sync-sit solves its half by **denormalizing** `address` and `latLng` onto
`AppointmentDoc` (`packages/sit-core/src/types/appointment.ts:32-33`) behind a
read rule scoped to the two parties. That exact move is unavailable to
`doTasks`, because §7.2 grants every active doer read on every task — putting
the address there would publish it to the whole board, which is what §11.2
forbids. sync-study hit the same wall and denormalized onto the *request*
(`tutorName` / `familyName` / `parentName` on `studyContactRequests`,
`packages/study-core/src/types/contactRequest.ts:21-38`).

**So the offer is the carrier, not the task.** `taskOffers` is already scoped
to the two parties plus admin, which is exactly the audience a reveal needs:

1. **Pre-acceptance, for the offer card:** `doSubmitOffer` denormalizes
   `doerFirstName`, `doerPhotoUrl` and `doerBio` onto the offer (§4.2). The
   family's offer list then renders under the existing offer read rule with no
   change to `users`.
2. **Post-acceptance, for the two-way reveal:** `doAcceptOffer` writes a
   `contact` block onto the **accepted offer** inside the §6.4 transaction —
   the family's address and phone, and the student's channels from
   `getContact`. A `doGetAssignedContact` callable (Admin SDK, asserts
   assignment, returns both sides) is the equivalent alternative if we would
   rather not persist a second copy of the address; §17 Q6 records the choice.

**Ruled out in writing:** adding a `profiles.doer` disjunct to the `users` read
rule. It would expose every enrolled doer's user document to every
authenticated user — far wider than this feature needs, and the kind of change
that gets made under deadline at PR7 if this section stays vague.

Either mechanism keeps the promise that an **un-accepted offer leaks nothing**:
the pre-acceptance fields are name, photo and bio, which the family needs to
choose at all, and nothing that locates either party.

### 6.5 Completion and cancellation

- Either side can mark the task done. The student's mark sets a
  `doerMarkedDoneAt` timestamp and notifies the family; the **family's** mark
  moves the task to `completed`. A task the student marked done but the family
  never confirmed auto-completes after 7 days via the daily sweep.
- Either side can cancel an `assigned` task. `cancelledBy` records who. No
  penalty, no policy engine — decision 8 means there is no money to claw back.
  The V2 cancellation-policy work from PR #101 is deliberately *not* extended
  here (§16).

---

## 7. Firestore: Collections, Rules, Indexes

### 7.1 New collections

| Collection | Written by | Read by |
|---|---|---|
| `doTasks/{taskId}` | callables only (Admin SDK) | owning family · any active enrolled doer for OPEN tasks, plus their own assignments (§7.2 — not the whole collection) · admin |
| `taskOffers/{offerId}` | callables only (Admin SDK) | the offering student · the task's family (when status is `pending`, `accepted` or `declined` — an ALLOW-list, see §7.2; a withdrawn offer, whether by the student or by guardian denial, is invisible to them) · the student's supervising parent (when `pending_guardian`) · admin |

Both are prefixed `do*` / `task*` rather than reusing generic names, because the
rules file is shared by three apps and a collection called `tasks` will not age
well.

### 7.2 Rules sketch

Follows the house style established by `publishedSearches` — provider disjuncts
first so a provider's list query never evaluates a family-doc `get()` (the H2
`||`-chain lesson recorded in `firestore.rules`), and every write denied to
clients except the owner's withdraw.

```
match /doTasks/{taskId} {
  allow read: if isAuth() && (
       // The doer grant is scoped to OPEN tasks plus the doer's own
       // assignments — not the whole collection. An unscoped caller-only
       // disjunct let any enrolled student read completed and cancelled
       // tasks (descriptions, photos, familyName, agreedPrice) and, via the
       // (assignedUserId, status, updatedAt) index, enumerate ANOTHER
       // student's assignments and what they were paid (round 7). Both
       // halves stay provable: the board query filters status == 'open',
       // and "my assignments" filters assignedUserId == own uid.
       ((resource.data.status == 'open'
         || request.auth.uid == resource.data.assignedUserId)
        && callerData().get('profiles', {}).get('doer', null) != null
        && doerField(callerData(), 'enrollmentComplete', false) == true
        && callerData().get('status', '') == 'active')
    || isAdmin()
    || isFamilyMember(resource.data.familyId)
  );
  allow create, update: if false;                       // callables only
  allow delete:         if false;                       // cancel is a callable
}

match /taskOffers/{offerId} {
  allow read: if isAuth() && (
       request.auth.uid == resource.data.doerUserId
    // isAdmin BEFORE either isFamilyMember(): both are get()s on a document
    // that may not exist, and a deleted family would error the || chain and
    // deny the read a later disjunct should grant (firestore.rules:600-604,
    // the references-rule precedent from PR #210 review). Inspecting an
    // offer whose family was deleted is exactly what admin access is for.
    || isAdmin()
    // ALLOW-LIST, not a != exclusion. An earlier draft granted the family
    // everything except pending_guardian — which leaked guardian-DENIED
    // offers: §8 moves a denial to `withdrawn`, so the moment a supervising
    // parent refused, the offer (doer name, photo, bio, price, message, the
    // helper's name and age) became family-readable. The family's UI would
    // never show it, but the rule is the trust boundary, not the query.
    // The allow-list also keeps a student's own withdrawal invisible to the
    // family, which makes guardian denial and self-withdrawal
    // indistinguishable from the family's side — deliberately.
    || (resource.data.status in ['pending', 'accepted', 'declined']
        && isFamilyMember(resource.data.familyId))
    || (resource.data.status == 'pending_guardian'
        && resource.data.get('guardian', {}).get('familyId', null) != null
        && isFamilyMember(resource.data.get('guardian', {}).get('familyId', null)))
  );
  allow create, update, delete: if false;               // callables only
}
```

**`profiles.doer.enrollmentComplete` must be pinned server-owned — this is a
third rules change, not just the two blocks above.** The board read rule makes
that field load-bearing, and §11.1 makes it the offering gate too. Walk the
existing `users` update rule (`firestore.rules:286-299`) with a `doer` slot
added and it is *client-writable*: the `affectedKeys().hasAny([...])` deny-list
is top-level only and does not include `profiles`; `profileRolesUnchanged()`
(`firestore.rules:44-49`) pins only the *set* of role-slot keys, so editing a
field inside an existing slot passes; and `babysitterIdentityUnchanged()` /
`tutorIdentityUnchanged()` never look at `profiles.doer`. So once
`doEnrollDoer` creates the slot, the owner can call
`updateDoc(users/{uid}, { 'profiles.doer.enrollmentComplete': true })` straight
from the client SDK, abandon enrollment, and read **every open task on the
board** — free-text descriptions, photos, `areaLabel`, `familyName`: exactly
the PII surface §11.2 governs.

The repo already treats this as a known hazard and draws the line in the right
place (`firestore.rules:78-82`): tutor `enrollmentComplete` is pinned
server-owned, while babysitter `enrollmentComplete` is *intentionally*
client-writable. **sync-do is in the tutor case, not the babysitter case**,
because the field gates a read rule rather than only search visibility. So:

```
function doerField(u, k, dflt) {
  return u.get('profiles', {}).get('doer', {}).get(k, dflt);
}
function doerIdentityUnchanged() {
  // enrollmentComplete is server-owned: doEnrollDoer sets it, nothing else.
  return doerField(request.resource.data, 'enrollmentComplete', false)
      == doerField(resource.data, 'enrollmentComplete', false);
}
```

added to the `users` update chain alongside its two siblings. §12 lists this as
a shared-surface change, §13 puts it in PR3's scope, and §14 pins it.

Three further things worth flagging for the rules review:

- **`doTasks` delete is `false`,** unlike `publishedSearches` where withdraw is
  a rules-gated client delete. A task with offers attached cannot be deleted
  without also expiring those offers, so withdrawal is a callable
  (`doCancelTask`) that does both.
- **The `pending_guardian` read split** is what keeps an unapproved offer
  invisible to the hiring family — and making it *provable* constrains the
  query, not just the rule. Two constraints:
  - The family's query must constrain `status` to (a subset of) the
    allow-list. Against `resource.data.status in ['pending','accepted',
    'declined']`, both a **per-status equality**
    (`where('status','==','pending')`) and an **`in` over a subset**
    (`where('status','in',['pending','accepted','declined'])`) are provable —
    the same subset-membership mechanism §9.1's `references` queries rely on
    against `firestore.rules:378`. An UNCONSTRAINED query is what fails.
    (An earlier draft claimed the `in` form "does not satisfy the rule"; that
    was true of the `!=` exclusion the draft's rule then used, and stopped
    being true when round 5 replaced it with the allow-list. §14's negative
    test is the unconstrained query, not the `in` form.)
  - The same disjunct's other half, `isFamilyMember(resource.data.familyId)`,
    needs a matching **query constraint on `familyId`** — a list query is
    evaluated against its potential result set, so a rule that reads
    `resource.data.familyId` is unprovable unless the query filters on it.

  So the family's offer query is
  `where('familyId','==',f).where('taskId','==',t).where('status','==',s)`
  (or the `in`-subset form), ordered by `createdAt` — with the matching index
  in §7.3. The `(taskId, status, createdAt)` index alone would not serve it.
- **The guardian disjunct reads through `.get()` defaults — which only works
  because `guardian` is ABSENT, not null, on non-flagged offers (§4.2).**
  Rules' `Map.get(key, default)` substitutes the default for an *absent* key
  only; a key present with value null returns null, and
  `null.get('familyId', …)` errors the disjunct — which under the H2
  `||`-chain behaviour denies the whole read (`firestore.rules:369-375` is
  the precedent for exactly this shape). So the safety here rests on TWO
  things together: `doSubmitOffer` omitting the field entirely on non-flagged
  offers, and the `.get()` defaults handling the absent case. An earlier
  draft claimed the defaults alone made the disjunct reorder-safe against a
  `guardian: null` doc; they do not, and a reader taking that claim at face
  value could reintroduce the null shape and break every family read of
  non-flagged offers at once.
- **Expiry is not rules-enforced**, identically to `publishedSearches` and for
  the same reason (unprovable against a client-supplied bound). An
  expired-but-unswept task leaks nothing its readers could not already see.

Rules changes get mutation-verified in an isolated stripped-copy test env, never
by weakening the live rules file (`feedback_rules_mutation_verify`).

### 7.3 Indexes

```
doTasks:    (status ASC, category ASC, createdAt DESC)      — the board, by category
doTasks:    (status ASC, createdAt DESC)                    — the board, unfiltered
doTasks:    (familyId ASC, createdAt DESC)                  — "my tasks"
doTasks:    (assignedUserId ASC, status ASC, updatedAt DESC)— "my assignments"
doTasks:    (status ASC, expiresAt ASC)                     — the sweep, expiry half
doTasks:    (status ASC, doerMarkedDoneAt ASC)              — the sweep, auto-complete half
doTasks:    (status ASC, cancelledAt ASC)                   — the sweep, cancelled-retention half
taskOffers: (familyId ASC, taskId ASC, status ASC, createdAt ASC)
                                                            — offers on a task, family side
taskOffers: (taskId ASC, status ASC, createdAt ASC)         — offers on a task, admin side
taskOffers: (doerUserId ASC, createdAt DESC)                — "my offers" (status tabs narrow client-side, per the split above)
taskOffers: (guardian.familyId ASC, status ASC)             — guardian queue (server-side, see below)
references: (tutorUserId ASC, status ASC)                   — offer-card endorsements, study side (NEW)
users:      (status ASC, profiles.doer.notifyNewTasks ASC,
             profiles.doer.categories ARRAY)                — the §10 digest's recipient query (server-side)
```

The digest index is server-side-only, like the guardian queue — but the Admin
SDK does not exempt it: composite indexes are a query-planner requirement, not
a rules one, and an `array-contains` on `categories` combined with the two
equalities needs one. Called out because its absence surfaces as a
`FAILED_PRECONDITION` inside a scheduled job at PR9, where nobody is watching
a browser console.

The sit-side offer-card query needs `(babysitterUserId, status)`, which
**already exists** in `firestore.indexes.json:22-27` — it is what serves
sit's own constrained reference queries today, and re-adding it at PR3 would
be a duplicate entry. Only the tutor-side composite above is new: the existing
`(tutorUserId, createdAt DESC)` index cannot serve a `status` filter.

The two `references` indexes serve §9.1's offer-card queries, which **must**
carry their `status in ['approved','published']` constraint to be provable
against the H2-hardened rule — see §9.1.

The guardian-queue index is for a **server-side** query. §9.3 puts the
guardian's approval surface in the existing supervised-child view, which is
served by callables using the Admin SDK
(`packages/shared-functions/src/guardian/oversight.ts`) — rules are bypassed
there, so only the index matters and there is no client list query to prove.
That is worth stating rather than leaving to inference: the index line
otherwise reads as a client query, §7.1 does grant the supervising parent a
rules-level read, and whether Firestore's analyzer maps
`resource.data.get('guardian', {}).get('familyId', null)` back to the
`guardian.familyId` field path is not something to assume.

The family-side offer index leads with `familyId` because the read rule's
family disjunct is only provable when the query filters on it (§7.2) — the
`taskId`-first index cannot serve that query, and is kept only for admin, which
reads under `isAdmin()` and needs no `familyId` constraint.

**The board filters do not all get indexes, and that is a decision, not an
omission.** §9.2 offers six filters (category, sub-category, timing, area,
adult-present, transport-needed) plus a newest-first sort. Firestore needs a
composite per *combination* of equality filters used with an `orderBy`, so
indexing all six means indexing their power set — unmaintainable, and the kind
of thing discovered at PR8 when a filter silently 400s.

**The split:** `status` + `category` are the only server-side filters; the
board query is always `where('status','==','open')` plus an optional
`where('category','==',…)`, ordered by `createdAt desc`. Everything else —
sub-category, timing, area, adult-present, transport — narrows **client-side**
over the fetched page. At the volumes a single school community produces, the
open-task set is small enough that this is honest rather than a compromise; if
it ever isn't, `offerCount` and the board's own page sizes are the signal, and
promoting one more dimension to the server is one index.

Note that `(expiresAt ASC)` alone would have been wrong: it is a single-field
index Firestore creates automatically, but the sweep queries
`status == 'open' && expiresAt <= now`, which needs the composite above.

### 7.4 Storage

Task photos live under a task-independent, uploader-keyed prefix — `do-photos/{uid}/{photoId}` — in the existing bucket (see below for why the path carries no `taskId`).

**Storage rules cannot mirror the `doTasks` read rule, and no wording makes
them.** Firebase Storage rules have no way to read Firestore — there is no
`get()`/`exists()` against Firestore documents in the Storage rules language —
so `profiles.doer.enrollmentComplete`, `status == 'active'` and
`isFamilyMember(…)` are all unreachable from a Storage rule. This repo already
hit the wall and took the only available exit (`storage.rules`):

```
// Verification documents — write-only for authenticated users
// Reads go through getVerificationDocument cloud function (checks family ownership)
match /verification-documents/{familyId}/{allPaths=**} {
  allow read: if false;
  allow write: if request.auth != null;
}
```

Three options, named here so PR10 does not have to invent one under deadline:

1. **`allow read, write: if false` + a `doGetTaskPhotoUrl` callable** that
   asserts the §7.2 audience and returns a short-lived signed URL. The
   `getVerificationDocument` precedent, and the only option that actually
   reproduces the read rule.
2. **`allow read: if request.auth != null`**, accepting that task photos are
   readable by *every authenticated platform user* — including sit-only and
   study-only accounts the §7.2 rule deliberately keeps off the board — and
   documenting it as an explicit §11.2 exception.
3. Unguessable object IDs as a capability, which is option 2 with extra steps.

**Recommendation: option 1.** §11.2's whole premise is that a photo may show a
garden, a front door or a flat interior; option 2 hands that to a wider
audience than the board itself has.

**Option 1 is a TWO-path shape, or the client cannot upload at all.** `allow
read, write: if false` on the final prefix plus the EXIF requirement (§11.2)
means the client never writes final objects — a geotagged original must not be
able to land past the stripper. Spelled out so PR10 ships it whole rather than
shipping the locked rule, discovering uploads are dead, and "temporarily"
relaxing to option 2:

```
// Final objects: written only by the stripper, read only via the callable.
// TASK-INDEPENDENT prefix, keyed by uploader — see below for why.
match /do-photos/{uid}/{photoId} {
  allow read, write: if false;
}
// Quarantine: the client's only upload path. Owner-scoped; a storage trigger
// strips EXIF, republishes into do-photos/{uid}/, deletes the original.
match /do-uploads/{uid}/{uploadId} {
  allow read: if false;
  // Bounded: this block is copy-ready for PR10, so what it omits ships.
  // Without the size/type caps, ANY authenticated platform user (sit- and
  // study-only accounts included) could write unbounded objects of any type,
  // each one firing the stripper trigger (round 9).
  allow write: if request.auth != null
               && request.auth.uid == uid
               && request.resource.size < 10 * 1024 * 1024
               && request.resource.contentType.matches('image/.*');
}
```

**Why the final prefix is task-independent:** at upload time there is no
`taskId`. §9.1's wizard collects photos *before* the review step, and
`doPostTask` — which creates the task and mints its id — runs after the
trigger has already stripped and republished. A `doTasks/{taskId}/…` final
path would need the client to supply the id (letting a malicious client
republish into another family's task) or the trigger to wait on a doc that
does not exist yet. Keying by uploader instead makes ownership structural:

- the trigger republishes `do-uploads/{uid}/{uploadId}` →
  `do-photos/{uid}/{photoId}` **with `photoId == uploadId`** and deletes the
  original. The id is CLIENT-chosen (a UUID minted by the wizard) — safe
  because both prefixes are keyed by the caller's own uid, so a colliding or
  hostile id can only clobber the caller's own objects. This is the return
  leg: an earlier draft had the trigger mint a server-side id, which left the
  client required to hand `doPostTask` identifiers it had no way to learn —
  the locked final prefix cannot be read *or listed* — and no way to render
  wizard thumbnails. Reusing the upload id means the client already knows it;
- `doGetOwnPhotoUrl` (Auth) signs a URL for a photo under the **caller's
  own** `do-photos/{uid}/` prefix — no task needed. This is what the wizard's
  thumbnails and the "not yet stripped" retry state render from
  pre-`doPostTask`; it exposes only the caller's own uploads, post-strip;
- `doPostTask` accepts photo ids and verifies each exists under the
  *caller's* `do-photos/{uid}/` prefix before writing them to the task as
  `{uid, photoId}` pairs (§4.1) — nobody can attach someone else's photo, and
  the stored uid is what lets reads reconstruct the path later;
- `doGetTaskPhotoUrl` asserts the §7.2 audience via the TASK (the photo must
  be in the task's `photos` array), then signs `do-photos/{uid}/{photoId}`
  from the stored pair — no reconstruction, no guessing which parent
  uploaded.

A quarantine object that never gets claimed is swept with the dailies, and so
is a `do-photos` object no task references after the same window. PR10's
one-line "EXIF stripping on upload" bullet understates all of this — budget
the trigger, the two sweep lines, and the two rules blocks.

Deployment gotcha from the README: **storage rules are not auto-deployed** by
the merge workflow and must be shipped manually.

---

## 8. Cloud Functions

All in `apps/functions/src/do/**`, codebase `default`, region `europe-west1`,
`cors: getCorsOrigin()`. Every name is `do`-prefixed.

| Callable | Auth | Does |
|---|---|---|
| `doEnrollDoer` | Auth | Creates `profiles.doer` — full or abbreviated depending on existing profiles. **Refuses an ungoverned under-15 caller** (`!isGoverned` guarding `checkEnrollmentAge`, the `enrollTutor` shape — §11.1); a governed caller passes at any age |
| `doUpdateDoerProfile` | Auth | Categories, bio, transport, `notifyNewTasks` |
| `doPostTask` | Auth (verified family) | Validates, scrubs, computes `areaLabel` + `expiresAt`, enforces `DO_TASK_MAX_ACTIVE` |
| `doUpdateTask` | Auth (owner family) | `open` tasks only; description/photos/budget/timing. **Runs the caller-prefix check on any photo ADDED** — existing `{uid, photoId}` entries pass through untouched, since they were verified at their own add time and may belong to the OTHER parent of the family; re-checking them against the current caller's prefix would wrongly strip a co-parent's photos (§7.4). Recomputes `expiresAt` server-side, which is how an `ongoing` task renews (§6.3). Notifies students with pending offers that terms changed |
| `doCancelTask` | Auth (family or assigned doer — §6.5 says either side may cancel an `assigned` task, and `cancelledBy: 'doer'` must be reachable; on an `open` task, family only) | Task → `cancelled`, all live offers → `expired` (zeroing `offerCount` per §4.1's invariant), notify. On an `assigned` task there are no live offers left (the sibling flip cleared them); the ACCEPTED offer keeps `accepted` — it is the record of who was engaged at what price, the contact block it carries was already revealed to both parties (wiping it un-reveals nothing), and the 30-day cancelled-task sweep bounds its retention |
| `doSubmitOffer` | Auth (active doer) | Enforces the ceilings, **re-checks the under-15 floor for ungoverned callers** (supervision is revocable and the enrollment gate never re-runs — §11.1), resolves the guardian gate, writes `pending` or `pending_guardian` |
| `doUpdateOffer` | Auth (offering student) | Price/message/helper while `pending` |
| `doWithdrawOffer` | Auth (offering student) | → `withdrawn`, decrements the live `offerCount` (§4.1) |
| `doDecideOfferAsGuardian` | Auth (supervising parent) | `pending_guardian` → `pending` or `withdrawn` |
| `doAcceptOffer` | Auth (owner family) | The §6.4 transaction |
| `doDeclineOffer` | Auth (owner family) | Single offer → `declined`, decrements the live `offerCount` |
| `doMarkTaskDone` | Auth (family or assigned doer) | §6.5 |
| `doListBoard` | — | **Not a callable.** The board is a direct Firestore query under the §7.2 read rule, like `usePublishedSearches`. |
| `doAdminListTasks` | Admin | Search/filter for the admin panel |
| `doAdminDeleteTask` | Admin | Hard delete + audit |
| `doGetOwnPhotoUrl` | Auth | Signs a URL for a photo under the CALLER'S OWN `do-photos/{uid}/` prefix — the wizard's pre-task thumbnail path (§7.4's return leg) |
| `doGetTaskPhotoUrl` | Auth | Asserts the §7.2 board audience (or family membership) and returns a short-lived signed URL for a task photo — the §7.4 option-1 read path; final objects are `allow read: if false` |
| `doStripTaskPhoto` | Storage trigger | Fires on `do-uploads/{uid}/*`: strips EXIF, republishes into the task-independent `do-photos/{uid}/` (no `taskId` exists at upload time — §7.4), deletes the quarantine original. **Fails closed on non-image bytes**: the rule's `contentType` check is client-asserted metadata, so hostile bytes labelled `image/jpeg` WILL arrive — the stripper deletes the quarantine object and stops, rather than throwing and re-firing on every retry. Not a callable |
| `doSendTaskDigest` | Scheduled | The §10 board digest: batches `new_task_matching` for students whose `profiles.doer.categories` match tasks created since their last digest, at most one per student per 6h. A scheduled batcher rather than an on-create fan-out, because the rate limit is per-RECIPIENT — an on-create trigger would need per-student dedupe state anyway, and the batcher IS that state. Uses the §7.3 `users` composite |
| `doSweepTasks` | Scheduled | Daily: delete expired `open` tasks and their offers; delete `cancelled` tasks (and their offers) older than 30 days — mirroring `cleanupOldData`'s cancelled/rejected appointment rule; auto-complete stale `doerMarkedDoneAt` tasks; delete unclaimed `do-uploads` quarantine objects (§7.4). Extends the existing `cleanupOldData` schedule rather than adding a second job |

Validation follows the sit house style visible in `publishSearch.ts` — manual
guards throwing `HttpsError('invalid-argument', …)`, with the shared bounds
(`DO_TASK_MAX_ACTIVE`, length ceilings, price range) exported from `do-core` so
the frontend enforces the same numbers.

GDPR: `exportUserData` and `deleteUser` both need `doTasks` and `taskOffers`
added to their collection lists — and the lists live in
`packages/shared-functions/src/admin/exportUserData.ts` / `deleteUser.ts`, not
in `apps/functions/src/admin/`, whose files are one-line re-export shims (the
same shim shape §12 already notes for `writeAuditLog.ts`). That makes this a
shared-surface edit for §12's list, though only `apps/functions` registers the
two callables today, so there is no study-side deploy impact. This is easy to
forget and is called out as a checklist item in §13 PR10 (the admin/GDPR PR — not the UI PRs, where it would have no natural home).

---

## 9. Frontend Surfaces

`apps/do-web`, scaffolded from `apps/study-web` (React 19 + Vite + Tailwind +
Zustand + React Router v7 + react-i18next), consuming `@ejm/shared-ui` for
chrome, enrollment steps, forms and theme.

### 9.1 Family

- **Post a task** — a wizard: category → sub-category → timing (the four models
  each with their own small form) → title + free-text description *with the
  considerations list rendered alongside* → photos → adult-present declaration →
  tools/transport → optional suggested budget → review + publish. The review
  step warns that the description and photos are visible to every enrolled
  student, mirroring the `publishedSearches` publish-dialog warning.
- **My tasks** — open (with an offer-count badge computed from the family's
  own fetched offer list — deliberately NOT from `offerCount`, which counts
  `pending_guardian` offers the family cannot see and would contradict the
  visible list; §4.1), assigned, completed, cancelled.
- **Task detail with offers** — the offer list is the heart of the product:
  student name, photo, bio, price, basis, message, declared helper, and their
  **existing platform endorsements** (decision 12; deliberately **no
  completed-task count** and no sync-do-specific rating).

  Three things that decision carries, which are easy to miss:

  - **There is no doer endorsement shape, and there will not be one.**
    `TutorEndorsementDoc` has `appSource: 'study'` as a literal and keys on
    `tutorUserId` (`packages/study-core/src/types/endorsement.ts:15-19`);
    sit's equivalent is `ReferenceDoc`, keyed on `babysitterUserId`. Surfacing
    "existing endorsements" therefore means **two queries against the shared
    `references` collection**, and their exact shape is load-bearing:

    ```
    where('babysitterUserId','==',uid).where('status','in',['approved','published'])
    where('tutorUserId','==',uid).where('status','in',['approved','published'])
    ```

    **The `status` constraint is not optional.** The H2-hardened `references`
    rule grants an unrelated caller only the *public-status* disjunct
    (`firestore.rules:377-385`), which is provable only when the query
    constrains `status` — every family-facing reference query already in the
    repo carries it. Drop it and the query is denied.

    An earlier draft of this section said "no rules change is needed … so both
    are provable" while showing the unconstrained queries. That combination is
    the dangerous one: at PR7 the symptom is `PERMISSION_DENIED`, and the
    nearest-looking fix is widening the `references` read rule — undoing the
    H2 hardening whose comment block this plan quotes approvingly elsewhere.
    The real fix is two words of query shape plus the index in §7.3.
  - **A doer-only student has none.** That is the modal case for a new sync-do
    enrollee — precisely the moment a family most needs signal. With ratings
    and task counts both ruled out, the offer card for a new student shows
    price, message and bio and nothing else. Stated here as a consequence of
    decision 12 rather than discovered at PR7; §16 item 1 is where it gets
    revisited if families struggle.
  - **A sit reference vouches for babysitting; a study endorsement vouches for
    tutoring.** Neither is evidence about wall-mounting or a dump run. The
    card should label them by their origin app rather than presenting them as
    generic reputation — a small product judgement, made here deliberately.

  Accept / decline per offer.
- **Assigned task** — contact details revealed, considerations rendered as a
  shared checklist, mark-done, cancel.

### 9.2 Doer (student)

- **Board** — the demand feed. Filters: category, sub-category, timing, area,
  adult-present, transport-needed. Sorted newest-first by default. This is the
  app's home screen.
- **Task detail** — everything the family published, plus the considerations
  list as "what to ask before you offer", plus an `adultPresent` badge.
- **Make an offer** — price + basis, message, optional +1 helper (name and
  age), availability note. Shows the guardian gate up front when the
  sub-category is flagged, so the wait is expected rather than mysterious.
- **My offers** — pending, awaiting-parent, accepted, declined, withdrawn.
- **My tasks** — assigned work, contact details, checklist, mark-done.

### 9.3 Guardian

No new surface. The pending-approval item appears in the existing supervised-
child oversight view (`packages/shared-functions/src/guardian/oversight.ts` and
its frontend counterpart), with a link that deep-links into sync-do.

### 9.4 Admin

Admin lives only in `apps/web` today — `apps/study-web` has no admin tree, and
sync-do will not grow one either. Extend the existing panel: a Tasks tab
(search, filter by category/status/family, view offers, delete), task counts on
the admin dashboard, and sync-do actions flowing into the existing audit log.

### 9.5 Cross-app switch

The switcher in all three apps becomes three-way. Each app ships brand marks for
the other two; `docs/shared-modules-roadmap.md` already flags consolidating
those marks into `shared-ui` as overdue — with a third app they become 6
byte-copies, so do the consolidation as part of PR2 rather than after.

---

## 10. Notifications

Reuses `NotificationDoc` + the existing Resend and FCM plumbing. New
`NotificationType` values (additive to
`packages/shared-core/src/types/notification.ts`):

`task_offer_received` · `task_offer_accepted` · `task_offer_declined` ·
`task_assigned` · `task_cancelled` · `task_updated` · `task_guardian_approval` ·
`task_marked_done` · `new_task_matching` (the board digest).

**Push tokens.** The user doc already has `fcmTokens` (sit, legacy flat array)
and `fcmTokensStudy`. sync-do adds `fcmTokensDo`, following the established
per-app pattern rather than trying to unify — issue #168's Phase-2
recipient-affinity routing is the place that unification belongs, and this plan
should not pre-empt it.

**The board digest is the one genuinely new notification.** Demand-first means a
student who never opens the app sees nothing. `new_task_matching` is delivered
by **`doSendTaskDigest`** (§8) — a *scheduled batcher*, not an on-create
fan-out: each run selects students with `notifyNewTasks` on whose
`profiles.doer.categories` match tasks created since their last digest, and
sends at most one digest per student per 6 hours, batching whatever
accumulated. The batcher shape is deliberate, for the reason §8 records: the
rate limit is per-*recipient*, so an on-create trigger would need per-student
dedupe state anyway, and the batcher IS that state. (An earlier draft said the
notification "fires on task creation", which §8 had already contradicted —
this section is the one a notifications implementer reads first at PR9, so it
now names the job.) Without the digest the board is dead; with it unbounded,
it is spam.

---

## 11. Safety, Privacy & GDPR

### 11.1 Gates (decision 7)

- **Posting** requires a fully verified family — identity + enrollment
  documents, or community vouching. Mandatory, no exceptions (decision 14). It
  is the reason a stranger cannot post a task luring students to an address.

  **Verification is already portable, and that is not new work.** The approval
  lives on the shared `families/{familyId}` document as
  `verification.isFullyVerified` (`FamilyVerificationStatus` in
  `packages/shared-core/src/types/verification.ts`), and both existing function
  codebases read that one field — `publishTutorSearch.ts:54` in study, the
  verification gate in sit. sync-do reads the same field. A family verified for
  babysitting is verified for tutoring and for tasks, on the same day, with no
  second upload and no per-app status. The rule to preserve through review:
  **never introduce a `verification.do` or any per-app verification state.**
  One family, one approval, three apps.
- **Offering** requires `status == 'active'`, `profiles.doer.enrollmentComplete`,
  and — for flagged sub-categories — an approving guardian when the student is
  supervised.
- **Adult presence** is declared on every task and shown as a badge on the
  board. Sub-categories flagged `recommendAdultPresent` nudge the family at
  posting time. It is a declaration, not a verified fact; the copy says so.
- **The platform's under-15 self-enrollment floor applies, with the governed
  carve-out the platform itself uses — and neither half is sync-do's to
  change.** The normative statement, precise enough to write the test from:
  **`doEnrollDoer` refuses an ungoverned caller under 15
  (`if (!isGoverned && …)` guarding `checkEnrollmentAge`); a governed caller
  passes at any age, because supervision is their protection. An ungoverned
  caller with a MISSING or unparseable `dateOfBirth` is refused
  `invalid-argument` and the flow collects it** — the `enrollTutor.ts:256-260`
  precedent, whose comment says why: "never let a security gate no-op
  silently." The two existing precedents split here (sit's *search-time*
  check deliberately tolerates legacy DOB-less profiles), and sync-do takes
  `enrollTutor`'s side because this is an enrollment gate on a new profile,
  not a filter over legacy data — and the modal enrollee is a cross-app
  babysitter whose sit profile may well lack a DOB, so the abbreviated §3.3
  flow must be able to ask for it.

  That mirrors the platform's one enrollment-time precedent exactly:
  `enrollTutor` guards its gate with `!isGoverned`
  (`apps/study-functions/src/enrollment/enrollTutor.ts:263`) and its refusal
  reads "at least 15 to enroll *on your own*. Your parents can create an
  account and enroll you from theirs." Sit has no enrollment-time check at
  all — `enrollBabysitter` runs none, and the floor is enforced at *search*
  time instead (`searchBabysitters.ts:211-224`, with the same `!isGoverned`
  bypass and the comment "a supervised account … is deliberately searchable
  at any age — supervision is its protection"). So `enrollTutor` is a single
  precedent, not a universal one. sync-do takes it AND adds what sit's
  search-time check provides and an enrollment-only gate cannot:
  **durability against revoked supervision**. `revokeSupervision` flips the
  link and drops the `governedBy` mirror without touching `profiles.*` — so a
  13-year-old enrolled under supervision keeps `profiles.doer` after
  revocation. Sit self-heals because its floor re-runs at search time;
  an enrollment-only floor never re-runs. The board read is a client query
  with no server chokepoint, but **offering is a callable** — so
  `doSubmitOffer` re-checks the floor: an ungoverned caller under 15 is
  refused there too (`reason: 'under_15'`), which restores the self-healing
  property at the moment that matters. A formerly supervised young student
  can still browse; they cannot offer.

  `checkEnrollmentAge` itself
  (`packages/shared-core/src/utils/agePolicy.ts:47-63`) returns `'under_15'`
  below 15, and "never waivable" describes that *verdict* — no admin
  exemption exists for it, unlike the ±1-class check. The carve-out is not a
  waiver: a governed account never reaches the check, exactly as at
  `enrollTutor`'s call site. An earlier draft stated the floor
  unconditionally, which would have locked governed students out of sync-do
  entirely — the §17 Q2 discussion presupposes governed under-15 doers exist,
  so the plan would have contradicted itself.
- **No *per-sub-category* age gate**, which is what decision 7 actually
  settled. Above the platform floor, sync-do does not ask how old a student is
  for a given kind of work; the guardian gate is the mechanism instead. For a
  supervised student a parent decides; for an unsupervised one — necessarily
  15 or over — no further gate applies. Recorded here because it is the
  decision most likely to be revisited (§17 Q2).

  An earlier draft of this section said "No minimum age" flat out. That was
  wrong about the platform, not just imprecise: it would have licensed
  `doEnrollDoer` to skip a gate the repo pins as non-waivable.

### 11.2 PII on the board

The `publishedSearches` stance carries over exactly: **area label, never address
or `latLng`**, until acceptance. `familyName` is included, as it already is in
both apps' pre-accept flows.

Two sync-do-specific exposures need handling:

- **Free-text description.** A family can type their address into it. The
  publish step warns explicitly ("this is visible to every enrolled student"),
  the same way `additionalInfo` is warned on today. No server-side redaction —
  that path is a false-confidence generator.
- **Photos.** A photo of the garden or the flat-pack box is genuinely useful, so
  photos are board-visible. **EXIF is stripped server-side on upload** — a
  geotagged photo of a front door is an address leak that a warning will not
  fix. This is new work: no existing upload path in the repo strips EXIF.

### 11.3 The +1 helper

Decision 9 lets an offer declare a helper. That person has no account, no
verification, no consent record, and the platform has no relationship with them.
Mitigation, not resolution:

- The offer captures their first name, last name and age, and the family sees
  all three before accepting.
- The record of who was expected on site lives on the **offer**, which is
  already scoped to the two parties plus admin — it is deliberately *not*
  copied onto the task. `doTasks` is readable by every enrolled doer (§7.2),
  so copying a third party's full name and age there would publish a
  non-member's identity to the entire board. The accepted offer is durable and
  admin-readable, which is all the record needs to be.
- Copy on both the offer form and the acceptance dialog states plainly that the
  helper is not a verified Sync member and that the assigned student remains
  responsible.

This is called out here so the trade-off is visible in review rather than
discovered in an incident.

### 11.4 GDPR

- `doTasks` and `taskOffers` join `exportUserData` and the hard-delete path.
- Retention: expired `open` tasks are deleted by the daily sweep; `cancelled`
  tasks (and their offers) are deleted once older than 30 days — the same
  window `cleanupOldData` already applies to cancelled/rejected appointments.
  Both halves are in `doSweepTasks`' §8 row, with the `(status, cancelledAt)`
  index in §7.3 that the second query needs.

  **Completed tasks are retained indefinitely, matching the platform** — and
  that is a deliberate statement, not a deferral. An earlier draft said they
  "follow the existing 30-day retention rule for finished engagements"; there
  is no such rule. `cleanupOldData.ts:181-186` deletes only
  `status in ['cancelled','rejected']` appointments older than 30 days (and
  more than 7 days past their booking date). **Completed appointments are
  never deleted.**

  Worth being explicit because a completed sync-do task carries more than a
  completed appointment does: the free-text description, the photos, the
  agreed price, — under §4.2's stored-block form — the family's address on
  the accepted offer, **and the +1 helper's full name and age**. Those go
  only through the GDPR hard-delete path — and the helper is the one data
  subject for whom that path does not exist: §11.3 establishes they have no
  account, no consent record and (per the age field) are frequently a minor,
  and `exportUserData`/`deleteUser` key on uid, so a helper can be neither
  exported nor erased by any mechanism in this plan. Their data leaves only
  when the offer document does. That is a genuine GDPR exposure the ToS
  cannot fully paper over (the assigned student attests they may share the
  helper's details, but the helper never consented to indefinite retention);
  Q8 now carries it, because a finite completed-task retention — or Q6's
  no-stored-copy option — is also what bounds the helper's exposure. If the
  owner wants a finite retention for completed tasks, that is **new** work for
  PR10's sweep, not an existing rule to inherit.
- Consent: the abbreviated cross-app enrollment still records `consentAt` /
  `consentVersion` for the sync-do terms, and a governed student's guardian
  consent uses the existing `GuardianConsent` record shape.

### 11.5 Liability: the platform performs the handshake only

**Decision 15.** Sync introduces a family to a student and gets out of the way.
It does not employ the student, does not supervise the work, does not insure
anyone, and does not adjudicate what happens afterwards. Insurance against
accidents sits **on the family side** — as it already should for a babysitter —
and so does the decision about how to handle a problem: an injury, a scratched
floor, a bookcase assembled wrong, an item broken in transit.

This is a stance the *product* has to state, not just a paragraph in a contract:

- **Terms of service** for sync-do carry it explicitly, and the wording should
  be reconciled with sync-sit's and sync-study's — the position is
  platform-wide, not sync-do's alone, and today it is under-stated for
  babysitting.
- **The posting flow** says it once, plainly, at the review step: the family is
  responsible for insurance and for resolving any damage or injury directly
  with the student.
- **The acceptance dialog** repeats it at the moment money and access are
  actually being committed, alongside the §11.3 helper disclosure.
- **The considerations lists** already carry the concrete version per
  sub-category — "what happens if something breaks" (Boxes), "who authorises
  treatment and pays" (Pet), "does this void a warranty" (IT). Those lines are
  the operational face of this policy and should not be softened.

There is no damage-claim flow, no dispute queue, and no mediation surface in
V1 — deliberately. Building one would imply a responsibility this decision
declines. Admin can see the task record and the agreed price if asked to help
two members reconstruct what was agreed; that is the limit.

**Still worth a lawyer's eye before launch, not before build:** whether French
rules on minors' occasional work bear on any of this, and whether the ToS
wording achieves what decision 15 intends. That is a Tandy SARL item, and it is
the only launch blocker in this document.

---

## 12. Shared-Package Impact

What sync-do reuses as-is:

| From | What |
|---|---|
| `shared-core` | `User`, `ProfileBase`, `ParentProfile`, `FirestoreTimestamp`, `NotifPrefs`, `NotificationDoc`, `GuardianLink`, `GuardianConsent`, `AccountStatus`, `resolveAreaLabel` |
| `shared-functions` | `guardian/*` (the whole consent surface), `handoff/appHandoff.ts`, `scheduled/parisTime.ts`, `config/*`, verification helpers, `admin/writeAuditLog.ts` (`writeUserActivity` — imported by both codebases, not tied to either) |
| `shared-ui` | enrollment steps, forms, theme tokens, `AppBar`/layouts (as they land per roadmap Plan E), account-page shell |
| `apps/functions` | family-verification gate, `families`/kids reads, Resend + FCM senders |

What sync-do **adds** to shared packages (small, deliberate):

- `shared-core/types/notification.ts` — the nine new `NotificationType` values.
- `shared-core/types/user.ts` — `profiles.doer`, plus `fcmTokensDo` and
  `dismissedPwaInstallBannerDo` alongside their existing `*Study` siblings on
  `User`.
- `firestore.rules` — not a package, but a shared surface all the same: the
  `users` **update** rule gains `doerIdentityUnchanged()` and a `doerField()`
  helper (§7.2). Without it `profiles.doer.enrollmentComplete` is
  client-writable and the board read gate is bypassable.
- `storage.rules` — the `do-photos/{uid}/**` (locked) and `do-uploads/{uid}/**`
  (owner-scoped quarantine) blocks (§7.4), shipped manually since the merge
  workflow does not deploy it.

One dependency edge §3.2 does not otherwise imply: surfacing existing
endorsements on the offer card (§9.1) means `do-web` reading both study's
`TutorEndorsementDoc` and sit's `ReferenceDoc` shapes, so `do-core` or
`do-web` takes a dependency on `@ejm/study-core` and `@ejm/sit-core`. Small,
but it contradicts a flat reading of "everything else lives in `do-core`".

Everything else lives in `do-core`. The roadmap's Tier-1 extractions (Plans A–C)
would each save sync-do a duplicated tree; where one is still `[ ]` at build
time, sync-do copies from `study-web` and the copy becomes the third instance
that makes the extraction unavoidable.

**Recommendation: land roadmap Plans B and C before PR2**, not later. Plan B is
the static/legal pages (`PrivacyPage`, `TermsPage`, `AboutPage`,
`ReportProblemPage`) and Plan C the public auth pages (`WelcomePage`,
`LoginPage`, `SignUpRolePage`, `ForgotPasswordPage`) —
`docs/shared-modules-roadmap.md:24-42`. Those are exactly the trees a scaffold
needs: the roadmap records that PR #57 had to add "Coming soon" stubs to
sync-study purely so the welcome page's footer links would resolve, and PR2's
"empty shell that builds and deploys" hits the same wall on day one. If B and C
have not landed by then, PR2 ships stubs and a later PR swaps them for the
shared pages — say which, rather than discovering it. This is the single
highest-leverage sequencing choice in the plan.

---

## 13. Delivery Plan

Each PR leaves all three apps buildable. Sizes are commit counts in the style
the repo has been using.

| PR | Scope | Est. |
|---|---|---|
| **1** | `packages/do-core`: types (task, offer, doer profile), the seven categories with sub-categories, the considerations content EN+FR, validation bounds, unit tests. No UI, no schema. | 8 |
| **2** | `apps/do-web` scaffold + third hosting target + three-way app switcher + brand-mark consolidation into `shared-ui`. Empty shell that builds and deploys. | 8 |
| **3** | Firestore: `doTasks` + `taskOffers` rules and indexes, **plus the `users` update-rule amendment** (`doerIdentityUnchanged()`, §7.2) — without it the board gate is client-bypassable. Rules tests under the stripped-copy mutation-verify harness. | 8 |
| **4** | `profiles.doer` + `doEnrollDoer` / `doUpdateDoerProfile`, abbreviated cross-app enrollment, enrollment UI. | 8 |
| **5** | Task callables: `doPostTask`, `doUpdateTask`, `doCancelTask`, the sweep. Integration tests. | 8 |
| **6** | Offer callables: submit / update / withdraw / guardian-decide / accept / decline, incl. the §6.4 transaction and its concurrency test. | 10 |
| **7** | Family UI: post wizard, my tasks, offer review, assigned task, contact reveal. | 12 |
| **8** | Doer UI: board with filters, task detail, offer form, my offers, my assignments. | 12 |
| **9** | Notifications: nine types, email templates EN+FR, `fcmTokensDo` push, the rate-limited board digest. | 8 |
| **10** | Admin tasks tab, audit coverage, GDPR export + hard-delete coverage, EXIF stripping on upload, storage rules (**manual deploy**), and the decision-15 liability copy in the ToS + posting review + acceptance dialog. | 9 |
| **11** | Completion + cancellation flows, FR i18n pass, Playwright e2e for post→offer→accept→complete, screenshots on the PR. | 8 |

Dependencies: 1 → 2 → {3, 4} → 5 → 6 → {7, 8} → 9 → 10 → 11. PRs 7 and 8 can run
in parallel once 6 lands. Roadmap Plans B and C should land **before PR2** —
see §12 for why the scaffold, not the family UI, is where they are needed.

---

## 14. Testing Plan

- **Unit** (`packages/do-core/src/**/__tests__/`) — timing discriminant
  validation, expiry computation across the four models and Paris DST, taxonomy
  integrity (every sub-category has considerations in both locales; every flag
  references a real category), price and length bounds.
- **Rules** (`tests/rules/`) — mutation-verified in an isolated stripped-copy
  env per `feedback_rules_mutation_verify`. Cases: a non-doer cannot read the
  board; a blocked doer cannot; the hiring family cannot read a
  `pending_guardian` offer; **nor a `withdrawn` one — including one withdrawn
  by guardian denial** (the post-decision half of §6.2's invisibility promise;
  an earlier draft's `!= 'pending_guardian'` rule leaked exactly this, and the
  pre-decision test alone would have passed with the leak in place); the
  supervising family can read `pending_guardian`; no client write path
  exists on either collection; **a doer cannot client-write
  `profiles.doer.enrollmentComplete`** (the §7.2 escalation — the one case
  that lives on `users`, not on the two new collections); and list-query
  provability for every rule disjunct — enumerated, not asserted in the
  abstract: the family's offer query in the `(familyId, taskId, status)`
  shape §7.2 requires — both the equality and the `in`-subset forms must
  **pass**, and the *unconstrained* query (no `status` filter) must **fail**;
  **a `pending_guardian` sibling flipped by an acceptance is `expired`, not
  `declined`, and stays family-unreadable** (the §6.4 sibling-flip leak — the
  pre-decision and guardian-denial cases alone would pass with it open); the
  doer's board read; the doer's own-offers query;
  the family's own-tasks query (`where('familyId','==',f)` — the same
  reasoning that gives the offer-side family disjunct its `familyId`
  constraint applies to `doTasks`' `isFamilyMember` disjunct, and §7.3's
  `(familyId, createdAt)` index exists for it); and §9.1's two `references`
  queries, which must carry `status in ['approved','published']` or be
  denied. The guardian queue is
  **not** in this list because it has no client query — it is served by the
  Admin SDK (§7.3).
- **Storage rules** (`tests/rules/storage-rules.test.ts` — the suite already
  exists; §7.4's surface joins it): a client cannot read `do-photos/{uid}/*`
  (any uid, own included — reads go through `doGetTaskPhotoUrl`); a client
  cannot write `do-uploads/{otherUid}/*` — the owner-scoped quarantine write
  is the entire basis of §7.4's "ownership is structural" claim, so it gets
  the direct negative test.
- **Integration** (`tests/integration/`, emulator lane 2 so the dev stack keeps
  running) — post→offer→accept end-to-end; **concurrent accepts of two
  different offers, exactly one wins**; guardian approve and deny; **a
  `pending_guardian` sibling flipped by acceptance lands in `expired`**
  (§6.4's sibling flip); **`doPostTask` AND `doUpdateTask` refuse a `photoId` that lives under
  another uploader's `do-photos` prefix** (the round-7 anti-hijack check on
  both write paths — without a pin either is one refactor away from becoming
  a lookup that trusts the id); **an
  UNGOVERNED under-15 caller is refused by `doEnrollDoer`, a GOVERNED
  under-15 caller is not, and an ungoverned caller with a missing or
  unparseable `dateOfBirth` is refused `invalid-argument`** (the gate must
  never no-op silently — `enrollTutor.ts:256-260`); **a doer whose
  supervision was revoked and who is still under 15 is refused by
  `doSubmitOffer`** (the durability half — enrollment-only floors do not
  survive `revokeSupervision`, §11.1) (both halves of §11.1's floor — the unconditional
  version of this test would have locked supervised students out and
  diverged from `enrollTutor`); ceiling enforcement, including that a withdrawn or declined offer
  returns its slot so a task does not seal shut; sweep deleting expired tasks
  and cascading their offers; contact-reveal boundary asserted from both
  sides.
- **E2E** (`tests-e2e/`, Playwright) — the happy path in the browser, plus
  screenshots attached natively to the UI PRs per `feedback_pr_ui_screenshots`.
- **Regression** — full `pnpm test:unit` + `pnpm test:integration` on every PR;
  sync-sit and sync-study suites must stay green, which is the whole point of
  keeping the shared-package additions additive.

Watch the CI gap recorded in `project_ci_test_gate_gap`: a green rollup can hide
an absent test job on stacked PRs. With eleven stacked PRs, verify the test job
actually ran on each.

---

## 15. V1 Scope Decisions

| Feature | V1 | Rationale |
|---|---|---|
| Offer→pick marketplace | **Yes** | Decision 1; the product. |
| Student-quoted price | **Yes** | Decision 2. |
| Four timing models | **Yes** | Decision 3. `TaskDoc` discriminates on `timing`. |
| Seven categories + sub-categories | **Yes** | Decisions 5, 6. Content, so cheap to extend. |
| Guardian consent on flagged work | **Yes** | Decision 7; reuses existing machinery. |
| In-app payment | **No** | Decision 8. |
| Multi-student tasks | **No** | Decision 9 — one assignee, optional declared helper. |
| Availability blocking | **No** | Decision 10. Conflict *hint* proposed in §17 R2. |
| Per-category age floors | **No** | Decision 7 — but a worked proposal is on the table in §17 Q2, pending a call. |
| Overnight house-sitting | **No** | Decision 13 — removed from the taxonomy, not deferred. |
| Damage / dispute handling | **No** | Decision 15 — building one would imply a responsibility the platform declines. |
| Endorsements on the offer card | **Yes** | Decision 12 — reuse what exists. |
| Ratings, reviews, completed-task counts | **No** | Decision 12, explicitly. No new reputation primitive. |
| In-app messaging | **No** | Consistent with both other apps. |
| Per-visit tracking on recurring tasks | **No** | No availability blocking ⇒ no instance documents needed. |
| Non-EJM students | **No** | Platform-wide V2 item, not sync-do's to decide. |
| Recurring cancellation policy | **No** | PR #101's V2 policy engine is not extended here. |

---

## 16. Future Roadmap

**Near-term (V1.1)**

1. **Better signal for choosing between offers** — decision 12 keeps V1 to
   existing endorsements only. If families still struggle to choose between five
   similar bids, the next lever is richer doer profiles (photos of past work,
   a skills blurb per category), *not* a rating system.
2. **Saved/favourite doers and direct invitations** — a family that liked a
   student invites them to a task directly, optionally keeping it private to
   invitees. Pairs with the existing favourites work.
3. **Per-visit check-off on recurring tasks** — a lightweight `visits` array on
   the task, not a subcollection. "Watered on the 3rd" is genuinely reassuring
   to a family on holiday.
4. **Structured fields per sub-category** — graduate the highest-traffic
   sub-categories from pure free text to a few typed fields (item count for IKEA,
   guest count for Party), keeping the description alongside.

**Medium-term (V2)**

5. **Team tasks** — a real headcount with N accepted offers. §4 keeps the
   assignment state in one place (`assignedUserId` / `assignedOfferId`) so
   promoting it to an array is a contained migration.
6. **Availability conflict awareness** — beyond the read-only hint in §17 R2,
   optionally let a fixed-time task block like a sit appointment.
7. **In-app payment** — the decision most likely to change if volume grows;
   nothing in this design forecloses it, since `agreedPrice` is already recorded.

**Long-term (V3)**

8. Shared messaging across all three apps. 9. A unified admin panel. 10. Demand
analytics — which categories go unfilled, where the supply gaps are.

---

## 17. Open Questions & Risks

### Resolved in review

- **Q1 — choosing between offers** → decision 12. Endorsements yes, completed-
  task count no.
- **Q3 — overnight house-sitting** → decision 13. Cut.
- **Q5 — verification gate** → decision 14. Mandatory, and portable across all
  three apps (§11.1).
- **Liability** → decision 15. The family's responsibility; the platform does
  the handshake only (§11.5).

### Q2 — per-sub-category minimum ages: a worked example

**Still open.** Decision 7 declined age gating; this section exists so the
decision is made against something concrete rather than in the abstract. Nothing
below is built unless the owner says so.

**The mechanism** would be one optional field, `minAge`, on `SubCategoryDef`
(§4.3). `doSubmitOffer` computes the student's age from `users/{uid}.dateOfBirth`
and rejects with `failed-precondition` when it falls short; the board also hides
tasks the student cannot take, so the rejection is a backstop rather than the
first time they hear about it.

**The floor is 15, not 13.** An earlier draft of this section proposed 13/14
tiers on the claim that 13 was "the platform baseline, matching the
parental-governance work". There is no 13 anywhere in the governance code:
`checkEnrollmentAge` returns `'under_15'` below 15
(`packages/shared-core/src/utils/agePolicy.ts:59`), `MIN_BABYSITTER_AGE = 15`,
and what supervision adds is the ability for a governed account to stand that
floor *down* — not a lower baseline. So a self-enrolled doer is 15 or over by
construction, and any 13/14 tier would bind **only governed accounts**, which
are exactly the accounts decision 7's guardian gate already covers.

**Proposed values.** Two tiers above the platform floor:

| Age | Sub-categories |
|---|---|
| **15** (the floor — no extra gate) | vacation plant care · garden & terrace watering · planting & potting · feeding and litter · every IT sub-category · packing · unpacking · IKEA assembly · disassembly · fixing existing furniture · party setup & decoration · music/photo/tech · clean-up after · baking & food prep · grocery shopping · parcels and post · dry cleaning · drop-in checks · weeding & pruning · kids' entertainment · serving & catering · returns and exchanges · dog walking |
| **16** | lawn mowing & edging · green-waste runs · van loading/unloading · cellar/attic clear-outs · moving furniture · dump and donation runs · wall mounting & anchoring · store pick-up · pharmacy pick-up · vet and grooming trips |

That is a much smaller proposal than the first draft, and honestly a weaker
one: with the floor at 15, the only question left is *which work needs 16*.
If the owner wants finer gradation for **governed** students — a parent
approving "my kid may assemble IKEA furniture" is a different question from
"my kid may run a petrol mower" — that is a coherent separate feature, and it
would be `minAge` applied only where `governedBy` is set.

**Plus one cross-cutting rule that is not a category at all:** any `fixed`-timing
task whose `endTime` is after **22:00** requires 16+, whatever the category. A
15-year-old clearing up after a party at midnight is a transport-home problem
that no per-category value catches.

**Two details that make this less free than it looks:**

- `dateOfBirth` is **optional** on `User`
  (`packages/shared-core/src/types/user.ts:20`). A student without one would be
  ineligible for 16+ work; note that `doEnrollDoer` needs it regardless, since
  §11.1's non-waivable floor cannot be checked without it — so making it
  required for `profiles.doer` is not contingent on this proposal.
- Age is checked at **offer time**, not at assignment. A student who turns 16
  between offering and starting is fine; one who offers at 15 for 16+ work is
  refused up front. That is the right boundary, but it is worth stating.

**How this interacts with what was already decided:** age gating and the
guardian gate solve different halves of the problem. The guardian gate covers a
*supervised* student — a parent decides. A 16+ tier is what would cover an
**unsupervised 15-year-old**, who today has no gate at all beyond the platform
floor they just cleared.

That is the crispest form of the case, and it is stronger than the first draft
made it sound: 15 is not an illustrative age, it is the *youngest possible
unsupervised doer*. So the question is exactly whether a newly-15, unsupervised
student should be able to answer a petrol-mower or wall-drilling post with
nothing between them and the task. Today they can.

### Still open

- **Q4 — Brand and domain.** `sync-do.com`? Hosting site id? The plan assumes
  `sync-do-app` as the Firebase site, matching `sync-study-app`.
- **Q6 — Which post-acceptance reveal mechanism?** §6.4 settles that the
  *offer* is the carrier and rules out widening the `users` read rule, but
  leaves two equivalent options: write a `contact` block onto the accepted
  offer inside the acceptance transaction (one more stored copy of the
  family's address, but no extra round trip and it works offline), or serve it
  from a `doGetAssignedContact` callable (no second copy, one more callable
  and a load state). Implementer's call at PR6 unless the owner has a
  preference; the plan's `OfferDoc` currently shows the stored-block form.
- **Q7 — May a family-declined student re-offer on the same task?** The
  deterministic `offerId` forces an answer either way (§4.2). The plan's
  default is **no** — the family said no to this student for this task, and a
  tap that re-opens it re-notifies every parent, which is the problem the
  platform's decline cooldowns exist to prevent. The gentler alternative is a
  7-day cooldown mirroring `DECLINE_COOLDOWN_MS`, after which the doc may be
  resurrected. Owner's call; the hard-no default ships unless overridden.
- **Q8 — Should completed tasks keep the family's address forever?** §11.4
  matches the platform default (completed engagements retained indefinitely,
  GDPR hard-delete only), and that is a defensible inheritance — but it
  deserves an explicit yes here rather than a note in a subsection, because a
  completed task under §4.2's stored-block form is a **live-forever copy of a
  member's home address created by a new feature**, alongside the free-text
  description and photos. The alternatives: a finite retention for completed
  tasks (new sweep work, a `(status, completedAt)` index), or Q6's callable
  option, which stores no second copy of the address at all — making Q6 and
  Q8 partially the same decision. The same choice also bounds the §11.4
  helper exposure — the one data subject with no export or erasure path.
  Default if unanswered: inherit the platform behaviour, as written.

### Risks

- **R1 — The board is only as good as its liquidity.** Demand-first fails
  silently when nobody offers. Mitigations: the §10 rate-limited digest, showing
  offer counts so families see activity, and seeding the first weeks with a
  known cohort. This is a launch risk, not an architecture risk, and it is the
  one most likely to decide whether the app works.
- **R2 — Double-booking.** Decision 10 means nothing blocks, so a student can
  accept a party task and a babysitting job for the same Saturday evening.
  Cheap mitigation that respects the decision: on a `fixed`-timing task, show
  the student a **read-only conflict hint** — "you have a sync-sit booking that
  evening" — computed from the schedule they already own. Reads only, writes
  nothing. Recommend including it in PR8.
- **R3 — Free-text descriptions carry PII to a wide audience.** Warned, not
  redacted (§11.2). Same posture as `publishedSearches`.
- **R4 — Photos leak location.** Handled by server-side EXIF stripping, which is
  new code with no precedent in the repo — do not let it slip past PR10.
- **R5 — The +1 helper is unvetted.** Recorded and disclosed (§11.3); not
  solved.
- **R6 — Deploy blast radius.** sync-do callables ship inside the sync-sit
  functions codebase (decision 11). Already the practical status quo, but it
  means a bad sync-do deploy can take sync-sit's functions with it. Namespacing
  and the integration suite are the guard.
- **R7 — Eleven stacked PRs.** Watch mergeable state and rebase proactively as
  siblings merge (`feedback_monitor_pr_conflicts`), and confirm the test job
  actually ran on each (`project_ci_test_gate_gap`).
- **R8 — Liability for minors doing physical work.** Answered by decision 15:
  the family's responsibility, the platform does the handshake only. The
  residual risk is that this must be *stated* convincingly — in the ToS, at the
  posting review step, and at acceptance (§11.5) — and that the same position
  is currently under-stated for sync-sit. A lawyer's read on the wording before
  launch is the only remaining launch blocker in this plan.
