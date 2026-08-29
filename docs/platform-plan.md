# Platform plan — the shared shell and one domain

Suite-wide decisions covering **sync/sit, sync/study and sync/do together**:
the shared shell (issue #124) and the domain consolidation. Owner-decided
2026-08-29.

This began life as Appendix A of `docs/sync-do-project-plan.md`, because
sync-do was the plan being actively written when the decisions were taken.
That was the honest place for it then and the wrong place for it now: none
of this is sync-do work, and filing a decision that reshapes all three apps
inside the newest one's plan is where people working on sit or study never
look (issue #371). The sync-do plan keeps its own per-PR impact table (its
§18) and points here for the rest.

Design reference: the canvas on issue #124 (artboards for parent, student, do,
admin, and the account hub). Decisions below are the owner's, taken there.

**Reading the cross-references.** A bare `§9.2` always means the *sync-do*
plan (`docs/sync-do-project-plan.md`) — these sections were written as an
appendix to it, and the references were left verbatim rather than rewritten
from memory. Sections of THIS document are never bare: they are written
`§5 of this plan`, or `§8 below` / `§2 above`. The qualifier is not
decoration — the numbers collide, and both readings are plausible. This plan's
§2, §5, §6 and §8 are the switcher, notifications, backend work and the domain;
the sync-do plan's are Decisions Taken, Category Taxonomy, Task & Offer
Lifecycle and Cloud Functions.

## 0. Build state

| | | |
|---|---|---|
| #364 | brand marks consolidated into `shared-ui` (`./brand-marks/*`) | **done** (issue #302); the bar-weight variants ship with #385 |
| #365 | `AppSwitchBar`, wired into all six switcher call sites | **open — in PR #385** |
| #386 | drop in owner-supplied bar icons | waiting on art |
| #366 | Recess visual pass; admin neutral | open |
| #367 | `AccountHome` — the shared hub | open, wants #366 |
| #370 | search and primary action become the page hero | open, wants #365 + #366 |
| #368 | self-serve cross-app account deletion | open |
| #369 | `notifPrefs` shape — app-scoped, Decision 27; no longer blocks sync-do PR9 | **done** |
| #374 | the three app-host constants, env-overridable — the original first work item of §8 of this plan | **done** |

Statuses checked against the tree, not the issue tracker, on 2026-08-29.

The marker for #365 is an `AppSwitchBar` in `packages/shared-ui`. Until PR #385
lands, `AppSwitchMenuItem` — the menu-item switcher §2 of this plan declares
superseded — is still rendered at **six call sites: five authed shells**
(`apps/web`'s `AppBar`, study-web's `AppBar` and `FamilyAppBar`, do-web's
`DoerAppBar` and `FamilyAppBar`) **plus the public `AdminInfoPage`**, which is
not a shell but is a site #385 has to handle all the same. Whoever merges #385
flips that row.

The domain cutover (§8 below) additionally needs owner action outside the repo:
registering the domain, pointing DNS, and verifying the sending domain with
Resend. That last one has real lead time.

---

## 1. What the owner decided

| # | Decision | Consequence for sync-do |
|---|---|---|
| 21 | **Visual direction "Recess"** — warm per-app tinted grounds, Nunito, 20–22px radii, chunky bottom-shadow cards, pill badges. | §9.0's palette stands; the *shapes and type* around it change. do's green ground joins sit's coral and study's sky. |
| 22 | **The bottom bar switches APPS, not pages** — `sync/sit · sync/study · My account`, four tabs once do is reachable. | §9.5 changes shape (below). do-web consumes a shared bar; it does not build a nav. |
| 23 | **Search and the primary action move INTO the page** — hero button under the greeting; the list becomes the first card. | §9.1's post wizard entry becomes the hero button ("Post a task"); §9.2's board becomes the doer's hero. |
| 24 | **The account is shared and neutral**, with per-app sections carrying their brand chip. | do-web ships **no account page**. It ships a doer-settings screen reached from the shared hub. |
| 25 | **Admin is neutral gray**, not any app's brand. | §9.4's admin tab inherits gray; do's green never reaches admin surfaces. |

## 2. §9.5 is superseded — the switcher is a bar, and decision 20 still gates it

§9.5 described a *switcher* (a menu item). It is now a **persistent bottom
bar**, which changes the gating conversation rather than resolving it:

- **Decision 20 still holds.** The bar in sit and study shows **three** tabs —
  `sit · study · My account` — with **no sync/do tab** until the owner
  approves reachability. The four-tab bar is do-web's own, plus the
  post-approval state of the other two.
- That gate is now more visible, not less: a missing tab is a more noticeable
  absence than a missing menu row. Worth the owner knowing that flipping
  decision 20 is now a *visual* change to sit and study, not a hidden one.
- The asymmetry PR2 already ships is unchanged: do-web's bar links out to sit
  and study; theirs does not link to do.
- **Brand-mark consolidation is now a hard prerequisite, not an overdue
  tidy-up.** Every app's bar renders every app's mark. PR2 already owns this.

## 3. do-web ships no account page

This is the largest scope change, and it *reduces* work.

- The shared `AccountHome` (neutral, in `shared-ui`) owns: identity, contact
  channels, language, notifications, password, family, legal, delete.
- do-web contributes **one per-profile screen** — doer settings: categories,
  transport, bio, `notifyNewTasks`, `defaultRate` — reached from a `Doer` row
  in the hub.
- The hub renders a **"Join" affordance** when `profiles.doer` is absent. That
  is a handoff into do-web's abbreviated enrollment (PR4's
  `doEnrollDoer`), not a new callable. **PR4 must therefore treat "arrived via
  handoff from another app's account hub" as a first-class entry path**, not
  only "opened do-web directly".
- Because the hub is hosted by each app (§7 Q10 of this plan, whose
  recommended answer is exactly that), sit and study will
  render a *summary* of the doer profile. That needs `@ejm/do-core`'s
  `DoerProfile` type available to them — a package edge §12 does not currently
  list.

## 4. The doer student's hero is a SEARCH, not a toggle

In sit and study a student waits to be found, so their hero control is the
`searchable` visibility toggle. **In do the board is demand-first, so the
doer's hero is the board itself.** §9.2 already describes this; this plan
records that it makes the student shell deliberately non-uniform across the
three apps, and that `profiles.doer` has **no `searchable` flag** by design
(§3.3 named the field `notifyNewTasks` for exactly this reason — it is a
digest opt-in, never a visibility gate, and the sync-do plan's §7.2 read rule
must still not consult it).

## 5. Notifications — the flat shape, and the app-scoped one that replaced it

**Status: SETTLED and shipped (issue #369).** What follows records the problem
and the decision taken, not an open question.

`NotifPrefs` USED TO BE a flat map of **event category → channels**:
`newRequest`, `confirmed`, `cancelled`, `reminders`, `references`, with no app
scope.

§10 adds **twelve** `NotificationType` values for do. Under the flat shape,
their preference rows would appear on the notifications screen of **every
user, including those with no doer profile** — a sit-only parent would see
"board digest" and "offer received" toggles for an app they have never opened.
That is not a style objection; it is the shared account screen surfacing a
per-app concern to the wrong people.

**DECISION 27 (owner, 2026-08-29): option 1, app-scoped preferences —
`notifPrefs: { shared, sit, study, do }`, rendered as one shared block plus a
block per profile the user holds.** It matches where the push tokens already
are (`fcmTokens` / `fcmTokensStudy` / `fcmTokensDo`) and is what issue #168
Phase 2 wants anyway. Option 2 (render-time filtering over the flat map) was
rejected: it leaves the schema saying something the UI contradicts.

**The split, read off what the senders actually gate — not off taste:**

| Category | Block | Why |
|---|---|---|
| `newRequest`, `confirmed`, `cancelled` | **per app** | Each gates a state change on ONE engagement inside ONE marketplace (`sendContactRequest` / `bookSession` / `submitOffer`). The three differ in volume and stakes by an order of magnitude — do's board is a high-traffic offer feed, a sit request is a rare, high-stakes ask about a child — so "mute new requests" only has an answer per app. |
| `reminders`, `references` | **shared** | `reminders` is the upcoming-engagement nudge in every app that has a scheduler; it is about the user's own calendar, of which they have one, and it is the one category whose default is deliberately push-only, i.e. a CHANNEL habit rather than an interest in a kind of event. `references` is reputation attached to the PERSON, who under the portable-user-entity model is one identity across the three apps. |

Two facts from the code back the second row rather than intuition: sync-do
consults **neither** shared category (`sendTaskDigest` passes
`prefCategory: null`, and `do/submitEndorsement` maps onto `newRequest`), and
`DoPrefCategory` was already exactly the per-app trio — it is now literally
`AppNotifCategory`.

**Every reader goes through `resolveNotifPref` (`@ejm/shared-core`)** instead
of indexing the stored object, which puts the category→block mapping, the
transitional read of the flat shape and the fail direction each in one place.
Fail direction: a known category with nothing stored resolves to the PRODUCT
DEFAULT for that category (never a blanket "notify" — `reminders.email` is
false by design), merged channel-by-channel; an unknown category or app fails
CLOSED and warns, because that can only be a code/schema mismatch and the user
was never shown a toggle for it. It warns rather than throws because every
caller is a post-commit sender.

**Rendering rule** is `notifPrefRowsForUser`: shared block always, plus an app
block per PROVIDER profile held (`babysitter`→sit, `tutor`→study, `doer`→do).
`profiles.parent` is app-agnostic by design, so it grants sit and study — the
two apps that ship a family Account page — and NOT do, which has no family
profile slot (sync-do plan §3.3) and no family settings surface. Residual: a
hiring parent in sync/do cannot yet TUNE their do preferences (delivery is
unaffected — the senders resolve to the product defaults); closing it needs a
do-side family marker on the user doc, tracked as the #369 follow-up.

**Migration**: `scripts/backfill-369-app-scoped-notifprefs.cjs`, dry-run by
default, idempotent. It copies the per-engagement trio into all three app
blocks — the only mapping under which nobody's delivery changes on migration
day — and LEAVES the flat keys in place for one release, so instances still
running the previous build keep reading them. The flat keys, the
`LegacyNotifPrefs` type and the transitional branch in `resolveNotifPref` are
removed together once the backfill has run against prod.

**This unblocks §3's account hub on the shape question**: the hub renders
`notifPrefRowsForUser` whole, where a per-app Account page renders it narrowed
to its own scope.

## 6. Backend work this implies (none of it do-specific, all of it do-blocking)

1. **Self-serve account deletion does not exist.** `deleteUser` is
   admin-only; there is no callable a member can invoke on themselves. The
   hub's "Delete my account" needs one — and it must be genuinely cross-app
   (the hub says so: "removes you from sync/sit, sync/study and sync/do"), so
   it has to reach do's collections too. **This is new work that touches
   sync-do's data and should be built with §11.4's hard-delete coverage rather
   than after it.**
2. **`notifPrefs` shape** — DONE (Decision 27 / issue #369); see §5 of this plan.
3. **No handoff change.** `appHandoffCodes` is already app-agnostic (§3.3);
   moving the call from a menu item to a tab needs nothing server-side.
4. **No rules change.** The bar and hub read `users/{uid}` as owner and
   `families/{familyId}` as member — both already permitted. The sync-do
   plan's §7.2 amendments stand as written.
5. **Firebase Auth authorized domains** still needs the `sync-do-app` entry
   before do's tab can resolve — already a PR2 blocker, unchanged.

## 7. Still open for the owner

- **Q9 — Where does the app switch live on desktop?** The bar is phone-only.
  `md+` already has `NavTabs` (primary destinations) and the admin sidebar
  (#119 / #288–290). Suggestion: a persistent switcher in the sidebar head
  rather than a bottom bar on a desktop window.
- **Q10 — Which origin serves the shared account?** Either each app hosts its
  own copy of the same `shared-ui` component (simple, no extra hops —
  recommended), or one app owns `/account` and the others deep-link through
  the handoff (one implementation, but every visit costs a cross-origin hop
  and a token redemption).
- ~~**Q11 — Notifications shape** (§5 of this plan)~~ — **ANSWERED, Decision 27
  (2026-08-29): app-scoped prefs.** Shipped on issue #369; see §5 for the
  split, the fail direction, the rendering rule and the migration.
- **Q12 — Paths or subdomains under the new domain** (§8 below). Decisive: it
  decides whether `appHandoffCodes` survives, whether the bar is an instant
  tab switch, and whether Q10 exists at all. Until it is answered, build for
  separate origins — that assumption degrades gracefully and the reverse does
  not.

## 8. Domain consolidation — one domain, shape undecided

**Decision 26 (owner, 2026-08-29): all three apps move under a single domain,
likely `syncici.com`. The existing `sync-sit.com` REDIRECTS to the new
domain** — it is retained, not retired, so bookmarks, installed PWAs and the
CTAs in every email already sent keep resolving.

**Q12 — paths or subdomains — is OPEN, and it is the decisive one**, because
Firebase Auth persists its session in IndexedDB and IndexedDB is scoped
**per origin**:

| | Paths — `syncici.com/sit`, `/study`, `/do` | Subdomains — `sit.syncici.com`, … |
|---|---|---|
| Origins | **One** | **Three** (subdomains are separate origins for storage) |
| Auth session | One session for all three apps | One per app, as today |
| `appHandoffCodes` | **Becomes dead code** — nothing to carry | Stays exactly as it is |
| Bottom bar (§2 of this plan) | A real instant tab switch; no loading state | Keeps its pressed/loading state |
| Q10 (which origin serves the account) | **Dissolves** — one `/account` route | Stays a live fork |
| Auth authorized domains | One entry | Three entries |
| PWA / service workers | Need per-path scoping; `firebase-messaging-sw.js` scope matters | Clean separation, unchanged |
| Browser storage | Shared — Zustand persist keys, `dismissedPwaInstallBanner*` etc. need namespacing | Naturally separated |

**Build for separate origins until Q12 is answered.** The assumption is not
symmetric: if the answer turns out to be *paths*, the handoff becomes dead
code and deleting a mechanism is cheap. If work is built assuming *paths* and
the answer is *subdomains*, the failure is discovering that sessions do not
carry — after shipping. So the sync-do ladder proceeds unchanged: handoff
intact, bar with its loading state, per-app account hosting.

**The migration surface WAS asymmetric, and the asymmetry ran the wrong way.
That half is now closed — this section's original first work item has
shipped (PR #374).** study and do were built *expecting* a domain move:
`email.ts` exported `STUDY_APP_URL` and `DO_APP_URL` with a comment promising
"the next domain move is a single edit here". **sit was not:** there was no
server-side `SIT_APP_URL`, and `https://sync-sit.com/...` was inlined directly
into email HTML about twenty times across twelve files under
`apps/functions/src/**` (appointments, admin, references, search, guardian,
reminders). Since this *is* a sit-domain move, it would have landed almost
entirely on the half that was never centralised.

PR #374 gave sit the constant its siblings already had and rewrote those files
onto it. `apps/functions/src/**` now contains **no inlined sit host at all**,
and all three constants are env-overridable per deployment, so a staging
project's mail no longer links to production.

The surface splits into two halves, and **both are now centralised**:

- **Support addresses.** Each app's `src/constants/brand.ts` holds one
  `SUPPORT_EMAIL`, every consumer reads it, and
  `scripts/__tests__/support-addresses.test.ts` fails the build if an app
  hardcodes one elsewhere or points at a domain that does not receive mail.
  That happened because study-web and do-web were publishing
  `support@sync-study.com` and `support@sync-do.com`, neither of which was ever
  connected, on live sites. At the cutover this half is three constants.
- **Host URLs.** `SIT_APP_URL` / `STUDY_APP_URL` / `DO_APP_URL` in
  `packages/shared-functions/src/config/email.ts` server-side, and the
  `VITE_*`-overridable equivalents in each web app's `appSwitch.ts`. Note the
  sit fallback is now `https://sync-sit.com` on **both** sides — the earlier
  split where clients fell back to `sync-sit.web.app` while the functions
  inlined the custom domain is gone.

A deliberate non-goal: this section no longer carries a count of literal host
strings. It carried one, it was wrong within days of being written, and the
count was never the decision — "is each half one constant per app, or a sweep?"
is, and both halves now answer *constant*.

**What the cutover therefore costs, today:** three server constants, the
client `appSwitch.ts` constants (not one per app — each app declares only the
hosts it links out to), the env files, and the two items below with real lead
time. Not a sweep.

Two items carry real lead time and should start before a cutover date is fixed:

1. **The email sender domain.** `FROM_EMAIL` is
   `Sync/Sit <noreply@sync-sit.com>`; `SUPPORT_EMAIL` and `ADMIN_EMAIL` are
   `support@sync-sit.com`. Moving them needs DNS, SPF and DKIM verified at
   Resend for the new domain — not same-day work, and mail from an unverified
   domain lands in spam. **Issue #156 is the precedent here, and it is only
   half-closed:** it shipped per-app *display names*
   (`Sync/Study <noreply@sync-sit.com>`) precisely because Resend validates the
   domain and not the display name, and left a comment saying the address stays
   `noreply@sync-sit.com` "until #156 resolves study domain setup" — which
   never happened. The domain move is exactly the event that unblocks that
   deferred half, so do both in one pass rather than verifying a domain twice.
2. **PWA identity.** A domain change points every installed PWA at the old
   origin. The redirect keeps them *working*, but their identity, icon and
   scope stay on the old domain until the member reinstalls. Worth checking the
   install count and deciding whether members are prompted.

**Consequences already recorded elsewhere that Q12 may change:** in the sync-do
plan, §3.1 (three hosting targets) and §3.3 (the switcher and Auth authorized
domains); in this plan, §2 (the bar's loading state) and §7 Q10 (account
hosting). None of them need editing until Q12 is answered; this section is the
pointer so the change is not discovered piecemeal.
