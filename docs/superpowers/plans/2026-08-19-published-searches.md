# Issue #207: Published searches (parent demand board) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Milestone of 4 sequential PRs; each PR is independently shippable and gated. Work each PR in its own worktree off merged main (base at planning time: a3cef0a).

**Goal:** Parents can PUBLISH a search (sit or study) so providers — including ones not matching the search terms or hidden from search — see the demand and initiate contact, which lands in each app's existing request/response machinery with the roles flipped.

**Owner decisions (issue #207, verbatim anchors):** publish option offered "when a parent starts a search"; copy clarifies the published search "is visible to a larger group of providers, even ones not available per the search terms or otherwise hidden from results"; lifetime "up to a week, and for babysitting no longer than the babysitting date"; providers get a section listing published searches, unseen ones tagged "New", seen ones "marked viewed for that provider"; provider contact "continues into a standard request/response flow".

**Architecture:** one shared `publishedSearches` collection (`app: 'sit' | 'study'` discriminator — one rules block, one TTL sweep, one index family; the two apps share the Firestore DB and rules file), callable-only creates (verification gate + server-computed `expiresAt` + PII scrubbing must be server-side), rules-based owner-family delete for withdraw, per-provider seen tracking via an owner-writable `publishedSearchesSeenAt` timestamp on the provider profile, and per-app contact-inversion callables that mint the EXISTING doc shapes (`appointments` / `studyContactRequests`) with an `initiatedBy` field so the standard respond machinery continues with roles flipped.

---

## Current state (verify at start; cite anchors)

**Sit family search** — `apps/web/src/pages/family/SearchPage.tsx` (722 lines): 3-step wizard `type → details → results` (line 54). Search params sent to `searchBabysitters`: `{type, date/startTime/endTime | recurringSlots, kidAges, numberOfKids, latLng, offeredRate, filters{minAge, gender, requireReferences}}` (lines 208–223; server shape `apps/functions/src/search/searchBabysitters.ts:9-27`). Contact (`sendContactRequest`, SearchPage lines 234–262) additionally carries `kidIds, address, schoolWeeksOnly, message, familyId`. `sendContactRequest` writes a `searches` doc AND an `appointments` doc (status `pending`, denormalized `familyName`, `address`, `latLng`, `kids[{age,languages}]`, `pets`, `familyNote` — `apps/functions/src/search/sendContactRequest.ts:74-124`), then notifies the sitter. The sitter responds via `respondToRequest` (`apps/functions/src/appointments/respondToRequest.ts:23` — caller must be the babysitter or a decline-only guardian, lines 49–63; accept → `confirmed` + optional schedule block; decline → `rejected`/`declined_by_babysitter` line 153–157).

**Study family search** — `apps/study-web/src/pages/family/SearchPage.tsx` (388 lines): single-step form `{subject, level, locationPrefs[], maxRate, maxDistanceKm, address→latLng + areaLabel}` posting to `searchTutors` (lines 135–177). No date/time — study searches are subject-first. Contact: `sendTutorContactRequest` writes a `studyContactRequests` doc `{tutorUserId, familyId, familyName, parentName, tutorName, createdByUserId, subject, level, status:'pending', message?}` (`apps/study-functions/src/contact/sendTutorContactRequest.ts:124-140`), with a pending-dupe guard (:87-102) and 7-day decline cooldown (:104-114). Tutor responds via `respondToTutorContactRequest` — transaction flips status and on accept `arrayUnion`s the familyId into `profiles.tutor.approvedFamilies` (`apps/study-functions/src/contact/respondToTutorContactRequest.ts:56-79`), which unlocks contact fields in search (`searchTutors.ts:115,248-252`) and everything downstream (booking, `proposeSession`'s consent gate at `proposeSession.ts:76-78`).

**"Hidden from results" mechanics:** search filters on `profiles.{babysitter,tutor}.searchable == true` + `status == 'active'` (`searchBabysitters.ts:100-103`, `searchTutors.ts:53-57`) plus availability/area/rate/age-backstop filters. The published-searches read audience deliberately drops `searchable` and every availability filter — but MUST keep `status == 'active'` (the hard ban gate, per project memory) and, for sit contact, the under-15/grad-year age backstop (`searchBabysitters.ts:197-227`), since a published search would otherwise be a bypass around the only operative age gate.

**Family respond surfaces (where the inverted flows land):** sit family dashboard renders pending appointments live (`apps/web/src/hooks/useFamilyAppointments.ts:25-46`; `apps/web/src/pages/family/DashboardPage.tsx:440-446` "pendingRequests" section). Study family RequestsPage lists `studyContactRequests` by familyId with per-status chips (`apps/study-web/src/pages/family/RequestsPage.tsx:37-40,193`). Study families already accept/decline provider-initiated *session proposals* on SessionsPage (`proposedBy === 'provider'`, `apps/study-web/src/pages/family/SessionsPage.tsx:683`) — precedent that a family-side accept surface is idiomatic.

**Menu badge idiom (PR #198):** study `AppBar.tsx` MenuItem takes optional `badge` count (`apps/study-web/src/components/ui/AppBar.tsx:39-51`), live `onSnapshot` count (:77-90), amber dot on the closed hamburger + aria-label swap (:92,113,118-120). Sit's `apps/web/src/components/ui/AppBar.tsx:38` MenuItem has NO badge prop yet — port it.

**TTL precedent:** no Firestore TTL policies in use for domain docs; expiry = `expiresAt` field + daily scheduled sweep `runCleanupOldData` (`apps/functions/src/scheduled/cleanupOldData.ts:85-118` invite-links/verification-codes blocks; scheduled daily 03:00 Paris :213-222). The 60s crossApp handoff TTL is redeem-time-checked + opportunistically deleted (`packages/shared-functions/src/handoff/appHandoff.ts:9,91-92`) — same belt-and-braces model here: query-side filter + sweep.

**Area label:** `resolveAreaLabel({postcode, city})` in `packages/shared-core/src/utils/parisArea.ts:53`; family docs carry `postcode`/`city` (rules allowlist `firestore.rules:282`, written by enrollment + both settings pages + backfill).

**Rules/test infra:** `firestore.rules` — every peer collection is callable-write-only; H2's lesson about `get()` poisoning `||` chains at :333-339. Rules tests: `tests/rules/firestore-rules.test.ts`; integration tests per domain under `tests/integration/`; per project memory, rules-wiring changes get mutation-tested via the isolated stripped-copy env, never by weakening the live file.

---

## Design

### D1. Data model — `publishedSearches` (one collection, two shapes)

```ts
// Common (both apps)
{
  id: string,                    // == doc id
  app: 'sit' | 'study',
  familyId: string,
  createdByUserId: string,
  familyName: string,            // OWNER QUESTION Q1 — included by default, see below
  areaLabel: string | null,      // resolveAreaLabel(postcode, city); NEVER address, NEVER latLng
  createdAt: Timestamp,
  expiresAt: Timestamp,          // server-computed, see D3
}
// sit extras (denormalized from the search form)
{
  type: 'one_time' | 'recurring',
  date: string | null, startTime: string | null, endTime: string | null,
  recurringSlots: {day,startTime,endTime}[] | null,
  schoolWeeksOnly: boolean,
  kidIds: string[],              // opaque ids, needed to mint the appointment at contact time
  kidAges: number[],             // display; kid NAMES never stored here
  numberOfKids: number,
  offeredRate: number | null,
  additionalInfo: string | null, // family-authored free text; publish dialog warns it is provider-visible
}
// study extras
{
  subject: string, level: string,
  locationPrefs: string[],       // may be []
  maxRate: number | null,
}
```

No `status` field: active == exists && `expiresAt > now` (client filters; sweep deletes; contact callables re-check server-side). Withdraw = delete.

**Seen tracking (evaluated):** viewer-uid array on the doc does not scale (unbounded fan-in writes, doc contention, 1MB cap); a `views` subcollection scales but costs a write per provider×search and needs orphan cleanup after TTL deletion. Chosen: **per-provider timestamp** `profiles.babysitter.publishedSearchesSeenAt` / `profiles.tutor.publishedSearchesSeenAt` on the provider's own user doc — O(1) storage, one write per section visit, nothing to clean up. `New` ⇔ `createdAt > seenAt` (or no seenAt). Semantics: opening the section marks everything currently listed as seen (the section is a flat card list, so listing == seeing); the page snapshots seenAt at mount so New tags stay visible during the visit. The field is intentionally client-writable — the users owner-update rule (`firestore.rules:251-263`) already permits un-pinned profile fields, and the only thing it can affect is the owner's own badge.

### D2. Rules (the only firestore.rules diff, PR1)

```
// Published searches (issue #207): a family's deliberately-broadcast demand.
// Created exclusively by the publishSearch/publishTutorSearch callables
// (verification gate + server-computed expiry + PII scrubbing live there).
// Read: the owning family, any ACTIVE provider of the matching app, admin.
// Deliberately NOT filtered by searchable/availability — being visible to
// "a larger group of providers, even ones ... otherwise hidden" is the
// feature; `status == 'active'` on the CALLER stays the hard ban gate.
// Delete: the owning family (withdraw). List queries: the provider
// disjunct depends only on the app equality filter + callerData() (one
// get, provable); the family disjunct is provable for
// where('familyId','==', myFamilyId) queries. Provider disjuncts come
// FIRST so provider lists never evaluate the family-doc get() (H2 lesson).
match /publishedSearches/{searchId} {
  allow read: if isAuth() && (
    (resource.data.app == 'sit'
       && isBabysitterData(callerData())
       && callerData().status == 'active')
    || (resource.data.app == 'study'
       && callerData().get('profiles', {}).get('tutor', null) != null
       && tutorField(callerData(), 'enrollmentComplete', false) == true
       && callerData().status == 'active')
    || isFamilyMember(resource.data.familyId)
    || isAdmin()
  );
  allow create, update: if false;   // publish callables only
  allow delete: if isFamilyMember(resource.data.familyId);  // withdraw
}
```

Note: expiry is NOT rules-enforced (`resource.data.expiresAt > request.time` is unprovable for list queries against a client-supplied `where` bound). An expired-but-unswept doc leaks nothing the reader wasn't already allowed to see; the sweep bounds the window to <24h and contact callables re-check.

### D3. Expiry

`expiresAt = min(now + 7d, end-of-babysitting)` where end-of-babysitting = `parisWallTimeToUtc(date, endTime)` (`packages/shared-functions/src/scheduled/parisTime.js` precedent, `proposeSession.ts:111`) for sit `one_time`; plain `now + 7d` for sit recurring and study. Enforcement: (a) client queries filter client-side on `expiresAt > now` after the snapshot arrives (keeps the query index-simple: `app ==` + `createdAt desc`); (b) new sweep block in `runCleanupOldData` deletes `expiresAt < now` (single 500-doc pass, invite-links idiom `cleanupOldData.ts:85-100`); (c) contact callables throw `failed-precondition` on expired/missing docs. **In-flight contacts survive expiry by construction:** the minted appointment/studyContactRequest denormalizes everything it needs (existing idiom), so deleting the source `publishedSearches` doc never breaks an open request — only the dangling `publishedSearchId` back-reference stops resolving, which no read path requires.

### D4. Contact inversion

**Study (clean precedent exists):** provider contact mints a `studyContactRequests` doc with `initiatedBy: 'tutor'` and the FAMILY responds. NOT `proposeSession` — its consent gate requires the family to already be in `approvedFamilies` (`proposeSession.ts:76-78`) and it needs a concrete date/time a subject-first published search doesn't carry. Terminal accept state is IDENTICAL to today's flow: familyId enters the tutor's `approvedFamilies` (the tutor consented by initiating; the family's accept completes mutual consent), after which search-contact unlock, booking, and proposeSession all already work untouched.

**Sit (no sitter-initiated precedent — minimal inversion):** provider contact mints an `appointments` doc in the `sendContactRequest` shape with `initiatedBy: 'babysitter'` + `publishedSearchId`, schedule params copied from the published doc, and `address`/`latLng` **withheld (null) until the family accepts** — in the normal flow the family chose the specific sitter before the address rode the pending doc (`sendContactRequest.ts:115-116`); here any active sitter can initiate, so disclosure waits for the family's accept. The family responds through an extended `respondToRequest` (family-member branch when `initiatedBy === 'babysitter'`); accept fills address/latLng from the family doc and confirms — downstream (cancel/modify/reminders/references) sees a normal confirmed appointment.

`initiatedBy` absent == legacy == family-initiated in both collections; no backfill.

### D5. Provider surfaces

New page per app — sit `/babysitter/published-searches` + menu entry in `apps/web/src/components/ui/AppBar.tsx` (port #198's badge prop + amber dot), study `/tutor/published-searches` + entry in `apps/study-web/src/components/ui/AppBar.tsx` (badge support already there, :39-51). Card: schedule (sit) / subject+level (study), kid ages + count (sit), rate, area label, relative expiry ("3 days left"), `New` badge, and (PR3/4) the Contact CTA. Badge count = docs with `createdAt > publishedSearchesSeenAt`, via the same `onSnapshot` idiom as `AppBar.tsx:77-90`. No provider-side filters in v1 (Q4), newest first.

### D6. Publish UX

CTA on the results step of both SearchPages — including (especially) the empty state ("No results? Publish this search so babysitters/tutors can come to you"). Copy per the owner's wording: published search is visible to a larger group of providers, even unavailable/hidden ones; states lifetime. Parents manage active published searches at the top of the same SearchPage (list + withdraw = client `deleteDoc`, rules-gated). Cap: 3 active per family per app (`resource-exhausted`), anti-spam.

---

## PR 1 — data model, rules, TTL, publish flow (both apps)

Branch `feature/published-searches-core`. Files:
- Create: `apps/functions/src/search/publishSearch.ts`, `apps/study-functions/src/search/publishTutorSearch.ts`, `apps/study-functions/src/validation/publishSearch.ts` (zod, study house style), `packages/shared-core/src/types/publishedSearch.ts` (the two doc shapes + `PUBLISHED_SEARCH_MAX_ACTIVE = 3`, `PUBLISHED_SEARCH_TTL_DAYS = 7`; export from `packages/shared-core/src/index.ts`)
- Modify: `firestore.rules` (D2 block, called out in the PR body), `firestore.indexes.json`, `apps/functions/src/index.ts:66` region + `apps/study-functions/src/index.ts:2` region (exports), `apps/functions/src/scheduled/cleanupOldData.ts` (sweep block + `publishedSearchesDeleted` stat), `apps/web/src/pages/family/SearchPage.tsx`, `apps/study-web/src/pages/family/SearchPage.tsx`, i18n `apps/web/src/i18n/{en,fr}.ts`, `apps/study-web/src/i18n/{en,fr}.ts`
- Tests: `tests/rules/firestore-rules.test.ts` (new describe), `tests/integration/search/publishSearch.test.ts`, `tests/integration/search/publishTutorSearch.test.ts`, cleanup test alongside the existing scheduled suite, page unit tests in each app's `__tests__`

Tasks (TDD, commit per green step):
1. **T1 types** — `publishedSearch.ts` shapes above; unit-test only the exported constants exist (pin).
2. **T2 sit publish callable (test first)** — integration test: verified-family parent publishes a one_time search → doc lands with `app:'sit'`, `expiresAt == min(now+7d, parisWallTimeToUtc(date,endTime))`, `areaLabel` from the family doc's postcode/city, NO `address`/`latLng`/kid names; unverified family → `permission-denied`; 4th active publish → `resource-exhausted`; past-dated one_time → `invalid-argument`. Implementation sketch:

```ts
export const publishSearch = onCall({ region: 'europe-west1', cors: getCorsOrigin() }, async (request) => {
  // gates copied from sendContactRequest.ts:42-54: auth, parent-of-family (familyId
  // derived server-side from the caller's parent profile, NEVER from input),
  // family.verification.isFullyVerified
  // input = the SearchPage params + kidIds (validated: type, date/slots, kidIds non-empty,
  //         kidAges from the family's kid docs server-side — client ages not trusted)
  // cap: count query where('familyId','==',familyId).where('app','==','sit'),
  //      client-side-filter expiresAt>now, >= PUBLISHED_SEARCH_MAX_ACTIVE → resource-exhausted
  const expiresAt = data.type === 'one_time'
    ? new Date(Math.min(now.getTime() + 7*24*3600*1000, parisWallTimeToUtc(data.date, data.endTime).getTime()))
    : new Date(now.getTime() + 7*24*3600*1000);
  const areaLabel = resolveAreaLabel({ postcode: familyData.postcode, city: familyData.city }); // may be null
  // write doc per D1; writeUserActivity(uid, 'search_published', {publishedSearchId, app:'sit'})
});
```
3. **T3 study publish callable (test first)** — same gates; zod schema `{subject, level, locationPrefs?, maxRate?, additional none}` reusing the vocabularies from `../validation/search.js`; `expiresAt = now+7d`. Pin: doc has no latLng even though the search form has one.
4. **T4 rules (mutation-verified)** — rules tests: active sitter reads sit doc / active tutor (enrollmentComplete) reads study doc; sitter CANNOT read study doc and vice versa; `searchable:false` provider CAN read (the whole point — pin it with a comment citing #207); `status:'blocked'` provider cannot; family reads+deletes own, not others'; all client creates/updates denied. Run the isolated stripped-copy mutation check per project memory.
5. **T5 indexes** — add `publishedSearches (app ASC, createdAt DESC)` and `(familyId ASC, createdAt DESC)` to `firestore.indexes.json` (deploys automatically post-#108).
6. **T6 TTL sweep (test first)** — extend `runCleanupOldData` + `CleanupStats`: docs with `expiresAt < now` deleted, unexpired kept.
7. **T7 sit publish UI** — results step of `apps/web/src/pages/family/SearchPage.tsx`: "Publish this search" button (results header + empty state), confirm dialog with the owner's visibility copy + lifetime line ("visible up to 7 days" / "until DATE"), calls `publishSearch` with the current form state + selected kidIds; success toast. Above the `type` step: "Your published searches" list (own-family query, withdraw via `deleteDoc` + confirm). Unit tests: dialog copy renders, publish payload shape, withdraw calls deleteDoc, cap error surfaces the dedicated message.
8. **T8 study publish UI** — same treatment on `apps/study-web/src/pages/family/SearchPage.tsx` (button next to the results/empty state, list + withdraw above the form). i18n en+fr both apps.
9. **T9 gates** — integration (baseline from branch base first), unit surface, lints exact, typecheck unpiped, rules mutation run.

## PR 2 — provider sections + seen tracking (both apps)

> **Superseded during review (PR #211):** the owner directed that the board's
> entry point be a **"Posts from families" section on the provider dashboard**,
> not a menu entry — so T2 and T4 below (the menu badge, the closed-menu dot,
> the `badge` prop ported into sit's MenuItem) were built, then removed again,
> and the shipped PR carries none of that machinery. What shipped instead:
> a shared `usePublishedSearches` hook + `PublishedSearchCard` per app, a
> `PublishedSearchesPreview` under the dashboard sections showing the newest 3
> with a link to the full board, and no app-bar surface at all. Read T2/T4
> as history; PR3 and PR4 build on the preview + card, not on the menu.


Branch `feature/published-searches-provider`. Files:
- Create: `apps/web/src/pages/babysitter/PublishedSearchesPage.tsx` (+test), `apps/study-web/src/pages/tutor/PublishedSearchesPage.tsx` (+test), shared card markup stays per-app (shapes differ; DRY via copy-adapt, the AppBar precedent `study AppBar.tsx:54-58`)
- Modify: `apps/web/src/router.tsx:106-119` (route `/babysitter/published-searches`), `apps/study-web/src/router.tsx:87-99` + `apps/study-web/src/lazyPages.ts`, `apps/web/src/components/ui/AppBar.tsx` (port badge prop + dot from study `AppBar.tsx:39-51,118-120`; new MenuItem), `apps/study-web/src/components/ui/AppBar.tsx` (new MenuItem with badge), i18n ×4

Tasks:
1. **T1 sit page (test first)** — `onSnapshot(query(collection('publishedSearches'), where('app','==','sit'), orderBy('createdAt','desc'), limit(50)))`; client-filter `expiresAt > now` and `familyId !== ownFamily-if-any`; card renders schedule/kidAges/rate/areaLabel/expiry-relative; `New` badge iff `createdAt > seenAtAtMount`; on mount after first snapshot: `updateDoc(users/{uid}, {'profiles.babysitter.publishedSearchesSeenAt': serverTimestamp()})`. Seen-at snapshot pattern:

```ts
const seenAtRef = useRef<Timestamp | null | 'unset'>('unset');
if (seenAtRef.current === 'unset') seenAtRef.current = getBabysitterView(userDoc)?.publishedSearchesSeenAt ?? null;
const isNew = (d) => !seenAtRef.current || d.createdAt.toMillis() > seenAtRef.current.toMillis();
```
   Pins: New computed against mount-time seenAt (does not vanish when the write lands), empty state, expired doc filtered, seen write fired once.
2. **T2 sit menu badge** — port `badge?: number` into sit MenuItem + closed-menu amber dot + aria-label swap (straight copy of study `AppBar.tsx:39-51,92,113,118-120`); count = New docs from the same query, failures hide the badge (pinned, #198 idiom "a failed read must never surface in the app bar").
3. **T3 study page + T4 study menu badge** — mirror of T1/T2 on `profiles.tutor.publishedSearchesSeenAt`; card shows subject/level/locationPrefs/maxRate/areaLabel.
4. **T5** — cards carry a disabled "Contact" affordance with "coming"-copy OMITTED: no CTA at all until PR3/4 (do not ship dead buttons); PR body notes the milestone staging.
5. **T6 gates** as PR1.

## PR 3 — contact inversion, sit

> **Amended during review (PR #212):** the dedupe below blocks only LIVE
> (pending/confirmed) prior contacts, which left a sitter free to re-mint a
> pending immediately after a family declined — each retry emailing and
> pushing every parent of that family. Sit now also enforces the **7-day
> cooldown on a family decline** that T1 of PR 4 already specified for study,
> so the two apps behave identically; a contact the SITTER withdrew is not a
> decline and starts no cooldown.


Branch `feature/published-searches-sit-contact`. Files:
- Create: `apps/functions/src/search/contactPublishedSearch.ts`, `tests/integration/search/contactPublishedSearch.test.ts`
- Modify: `apps/functions/src/appointments/respondToRequest.ts` (family branch), `apps/functions/src/index.ts`, `apps/web/src/pages/babysitter/PublishedSearchesPage.tsx` (CTA + message dialog), `apps/web/src/pages/family/DashboardPage.tsx` + `apps/web/src/components/appointments/*` (family accept/decline on `initiatedBy==='babysitter'` pendings), `apps/web/src/pages/babysitter/RequestDetailPage.tsx` + `apps/web/src/pages/babysitter/DashboardPage.tsx:254` (label own-initiated pendings "waiting for family"; hide sitter respond buttons), i18n en+fr

Tasks:
1. **T1 contact callable (test first).** Signature + gates:

```ts
// contactPublishedSearch({ publishedSearchId: string, message?: string })
// gates: auth; caller has an ACTIVE babysitter profile; the SAME age backstop
//   searchBabysitters applies (searchBabysitters.ts:197-227 — under-15 floor,
//   grad-year mismatch vs enrollmentExemptions, governed bypass) because a
//   published search must not be a route around the only operative age gate;
// doc: exists, app === 'sit', expiresAt > now  → else failed-precondition;
// dedupe: appointments where('babysitterUserId','==',uid)
//   .where('publishedSearchId','==',id) with any status in pending/confirmed
//   → already-exists;
// mint: appointment in the sendContactRequest shape (sendContactRequest.ts:97-124)
//   with { initiatedBy:'babysitter', publishedSearchId, createdByUserId: uid,
//   familyId/type/date/times/recurringSlots/schoolWeeksOnly/kidIds/offeredRate
//   copied from the published doc, kids: rebuilt server-side from kidIds
//   (ages+languages only), familyName: from family doc (Q1),
//   address: null, latLng: null,            // withheld until family accept (D4)
//   pets: null, familyNote: null,           // family-doc details also wait for accept
//   message, status:'pending' };
// notify: notifyAllParents({familyId, prefCategory:'newRequest',
//   type:'published_search_contact', ...}) — sitter first name + schedule in copy;
// writeUserActivity(uid, 'published_search_contacted', {publishedSearchId, appointmentId})
```
   Pins: happy path; expired doc rejected; blocked/under-15 sitter rejected; hidden (`searchable:false`) sitter ACCEPTED (pin with #207 comment); dupe rejected; address/latLng null on the pending doc.
2. **T2 family respond branch (test first)** — in `respondToRequest.ts`, before the babysitter/guardian gate (:49-63): if `appointment.initiatedBy === 'babysitter'`, the responder must instead satisfy `familyData.parentIds.includes(uid)` (family loaded once; `sendContactRequest.ts:48` idiom); guardian and `blockSchedule` branches don't apply to family responders. Accept → `status:'confirmed'` + `address`/`latLng`/`pets`/`familyNote` filled from the family doc + notify the SITTER (single-recipient email+push+notification, `sendContactRequest.ts:144-176` idiom, type `published_search_accepted`); decline → `rejected`, `statusReason:'declined_by_family'` + notify sitter. Pins: family accept fills address; sitter cannot respond to own-initiated pending; family cannot respond to a family-initiated pending (existing behavior preserved — regression pin).
3. **T3 verify cancel/modify paths** — read `cancelAppointment.ts`/`modifyAppointment.ts`/`resubmitAppointment.ts` and pin current caller-role assumptions against `initiatedBy:'babysitter'` docs: the sitter must be able to withdraw their own pending (whichever path allows it — if none, extend `cancelAppointment`'s pending branch), the family cancel path must keep working post-confirm. Evidence in the PR body.
4. **T4 sitter UI** — CTA + message dialog on `PublishedSearchesPage` (state per contacted search: button → "Request sent"); dashboard/RequestDetail: `initiatedBy==='babysitter'` pendings render "waiting for family", respond buttons hidden.
5. **T5 family UI** — pending section cards for `initiatedBy==='babysitter'`: sitter profile summary (dashboard already resolves sitter profiles, `DashboardPage.tsx:235-237`), published-search context line ("Responding to your published search"), Accept/Decline wired to `respondToRequest`. Unit pins both branches.
6. **T6 gates.**

## PR 4 — contact inversion, study

Branch `feature/published-searches-study-contact`. Files:
- Create: `apps/study-functions/src/contact/sendFamilyContactRequest.ts` (tutor→family), `apps/study-functions/src/contact/respondToFamilyContactRequest.ts`, zod schemas in `apps/study-functions/src/validation/contact.ts`, `tests/integration/study-contact/publishedSearchContact.test.ts`
- Modify: `apps/study-functions/src/index.ts`, `apps/study-functions/src/contact/sendTutorContactRequest.ts` (scope dedupe/cooldown by initiator), `apps/study-functions/src/search/searchTutors.ts:71-88` (requestStatus map), `apps/study-web/src/pages/tutor/PublishedSearchesPage.tsx` (CTA), `apps/study-web/src/pages/family/RequestsPage.tsx` (accept/decline on `initiatedBy==='tutor'`), `apps/study-web/src/pages/tutor/RequestsPage.tsx` (label outgoing), i18n en+fr

Tasks:
1. **T1 `sendFamilyContactRequest` (test first).**

```ts
// sendFamilyContactRequest({ publishedSearchId: string, message?: string })
// gates: auth; caller active tutor, enrollmentComplete (sendTutorContactRequest.ts:61-69 mirrored);
// doc: exists, app==='study', unexpired; live-offering: tutor still offers
//   doc.subject+doc.level (sendTutorContactRequest.ts:73-78 idiom) — a tutor
//   who dropped the subject cannot answer its demand;
// already-approved family → failed-precondition (contact already unlocked);
// dedupe: existing PENDING studyContactRequests for (tutorUserId=uid, familyId)
//   regardless of initiator → already-exists; 7d cooldown on a prior
//   tutor-initiated decline (initiatedBy==='tutor' && status==='declined');
// mint: studyContactRequests doc in the sendTutorContactRequest.ts:124-140 shape
//   + { initiatedBy:'tutor', publishedSearchId, createdByUserId: uid,
//       subject/level from the published doc; parentName: '' (unknown yet) };
// notify: notifyAllParents({familyId, prefCategory:'newRequest', app:'study',
//   type:'study_published_search_contact', ...})
```
2. **T2 `respondToFamilyContactRequest` (test first)** — `{requestId, action:'accept'|'decline'}`; transaction (respondToTutorContactRequest.ts:56-79 mirrored, roles flipped): doc exists, `initiatedBy==='tutor'`, status pending, caller in `familyData.parentIds`; accept → status `accepted` + `parentName` = caller + `arrayUnion(familyId)` into `users/{tutorUserId}.profiles.tutor.approvedFamilies` (the tutor consented by initiating — same terminal state as today's accept, so search unlock/booking/propose need zero changes; pin that a booking succeeds after accept); decline → `declined`. Notify the TUTOR (single-recipient, respecting `notifPrefs`). No guardian branch (responder is a parent). Deliberately a NEW callable, not a branch in `respondToTutorContactRequest` — that one's guardian/decline-only logic is tutor-side and the two authorization models share nothing.
3. **T3 initiator-scoped guards** — `sendTutorContactRequest.ts:87-114`: pending-dupe stays initiator-agnostic (one open request per pair, either direction), but the decline-cooldown must only count FAMILY-initiated declines (`initiatedBy !== 'tutor'`) — a family that declined a tutor's approach must remain free to send its own request. Pin both.
4. **T4 searchTutors requestStatus** — `:71-88`: docs with `initiatedBy==='tutor'` and status `pending` map to `'none'`... no: keep them OUT of `latestRequest` entirely EXCEPT status `accepted` (accepted means unlocked either way; a pending tutor-initiated request must not render the family's TutorCard as "request sent" — they didn't send one, and the family's action for it lives on RequestsPage). Pin: tutor-initiated pending → card shows fresh 'none'; tutor-initiated accepted → 'accepted'.
5. **T5 tutor UI** — CTA + message dialog on study `PublishedSearchesPage` (→ "Request sent"); tutor RequestsPage rows with `initiatedBy==='tutor'` labeled "You contacted this family".
6. **T6 family UI** — family RequestsPage: `initiatedBy==='tutor'` pending rows render tutor name/subject/level/message + Accept/Decline wired to `respondToFamilyContactRequest`; accepted rows link onward to `/family/search?subject=&level=` (existing deep-link, `SearchPage.tsx:40-42`) or `/family/book/:tutorUserId`. Unit pins both actions + the existing family-initiated rows regression.
7. **T7 gates.**

---

## Constraints (repo law)
No emoji; no Co-Authored-By; conventional commits; `feature/*` branches; i18n en+fr for every string; grep-verify scripted edits and post-states independently; `pnpm exec firebase emulators:exec` only for integration runs (measure the branch-base baseline first); firestore.rules diffs called out explicitly in the PR body and mutation-verified via the stripped-copy env; UI PRs get flow screenshots via the orphan assets branch (standing owner rule 2026-08-19); lints exact; typecheck captured unpiped. Deploys are automatic on merge (#108) — the rules + indexes in PR1 go live with it, so PR1 must be safe standalone (it is: publish + withdraw only, nothing reads yet beyond the owner).

## OWNER QUESTIONS (defaults applied unless overridden)

- **Q1 — Pre-contact identity/PII.** What does a provider see on a published-search card before any contact? **Default applied: area label + kid ages/count (sit) or subject+level (study) + schedule + rate + `familyName` — no address, no latLng, no kid names, no photo.** Family name is how requests already present to providers pre-accept in both apps (`sendContactRequest.ts:102`, `sendTutorContactRequest.ts:129`) and EJM is a closed community; but unlike those flows the audience here is every active provider, so if the owner prefers, dropping `familyName` from the doc is a one-field change in PR1 (cards would say "A family in {area}"). Sit's `additionalInfo` free text is included with a publish-dialog warning that it is provider-visible. The family's ADDRESS is additionally withheld from sitter-initiated pending appointments until the family accepts (a deviation from the family-initiated flow, where the family chose the sitter first — D4).
- **Q2 — Ship both apps together?** The milestone interleaves (PR1/PR2 span both apps; PR3 sit-only, PR4 study-only). **Default: yes, both; PR3 and PR4 are independent and can land in either order after PR2.** If study should wait, PR1/PR2 split cleanly (drop the study tasks into a later pair).
- **Q3 — Publish window between PR1 and PR3/4.** After PR1 merges (auto-deploy), parents can publish but providers can't yet see (PR2) or contact (PR3/4). **Default: accept the gap (days at current cadence), no feature flag.** Alternative: hold PR1's UI tasks (T7/T8) in PR2.
- **Q4 — Provider-side filters/sort on the section.** **Default: none in v1** (newest-first list, client expiry filter). Adding subject/area filters later is client-side only.
- **Q5 — Active-cap value.** **Default: 3 active published searches per family per app.** Trivial constant (`PUBLISHED_SEARCH_MAX_ACTIVE`).
- **Q6 — Seen granularity.** **Default: section-visit granularity** (opening the section clears New for everything then listed — O(1) per-provider timestamp, D1). If the owner wants strict per-card "seen only when actually viewed", that's the `views` subcollection variant (+1 write per provider×card, orphan cleanup in the TTL sweep) — say so before PR2.

## Self-review notes
- Spec coverage: publish CTA at search time (PR1 T7/T8) ✓; visibility copy (T7 dialog) ✓; larger-group read incl. hidden providers (D2 rules, pinned in PR1 T4 and PR3 T1) ✓; ≤7d lifetime and ≤babysitting date (D3, PR1 T2) ✓; provider section + New tag + per-provider viewed marking (PR2) ✓; standard request/response continuation (PR3 sit appointments machinery, PR4 study contact-request machinery) ✓.
- Types used across PRs: `initiatedBy: 'babysitter' | 'tutor'`, `publishedSearchId`, `publishedSearchesSeenAt`, `PUBLISHED_SEARCH_MAX_ACTIVE` — consistent throughout.
- Known simplifications (deliberate): no schedule auto-block on sit family accept (sitter blocks via existing tools; the accept-time `blockSchedule` choice belongs to the sitter and they aren't the responder here); no rules-level expiry proof (D3 rationale); no Firestore TTL *policy* (repo uses sweep precedent, and a policy can't express min(7d, date) — actually it can, since expiresAt is precomputed, but the sweep keeps parity with every other collection and works in the emulator).
