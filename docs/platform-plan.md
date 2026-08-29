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

**Reading the cross-references.** A bare `§9.2` means the *sync-do* plan --
these sections were written as an appendix to it and the references were left
verbatim rather than rewritten from memory. References to sections of THIS
document say `§5` with no other qualifier only inside a sentence that names
this plan; where it could be read either way, the document is named.

## 0. Build state

| | | |
|---|---|---|
| #364 | bar-weight brand marks | **done** (#385) |
| #365 | `AppSwitchBar`, wired into all six authed shells | **done** (#385) |
| #386 | drop in owner-supplied bar icons | waiting on art |
| #366 | Recess visual pass; admin neutral | open |
| #367 | `AccountHome` — the shared hub | open, wants #366 |
| #370 | search and primary action become the page hero | open, wants #365 + #366 |
| #368 | self-serve cross-app account deletion | open |
| #369 | `notifPrefs` shape — **owner decision, blocks sync-do PR9** | open |

The domain cutover (§8) additionally needs owner action outside the repo:
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
- Because the hub is hosted by each app (see §6), sit and study will
  render a *summary* of the doer profile. That needs `@ejm/do-core`'s
  `DoerProfile` type available to them — a package edge §12 does not currently
  list.

## 4. The doer student's hero is a SEARCH, not a toggle

In sit and study a student waits to be found, so their hero control is the
`searchable` visibility toggle. **In do the board is demand-first, so the
doer's hero is the board itself.** §9.2 already describes this; the appendix
records that it makes the student shell deliberately non-uniform across the
three apps, and that `profiles.doer` has **no `searchable` flag** by design
(§3.3 named the field `notifyNewTasks` for exactly this reason — it is a
digest opt-in, never a visibility gate, and the §7.2 read rule must still not
consult it).

## 5. Notifications — a concrete problem the flat shape creates

`NotifPrefs` (`packages/shared-core/src/types/common.ts:27-33`) is a flat map
of **event category → channels**: `newRequest`, `confirmed`, `cancelled`,
`reminders`, `references`. It is not app-scoped.

§10 adds **twelve** `NotificationType` values for do. Under the flat shape,
their preference rows would appear on the notifications screen of **every
user, including those with no doer profile** — a sit-only parent would see
"board digest" and "offer received" toggles for an app they have never opened.
That is not a style objection; it is the shared account screen surfacing a
per-app concern to the wrong people.

Two ways out, and PR9 should not proceed without a choice:

1. **App-scoped prefs** — `notifPrefs: { shared, sit, study, do }`, rendered as
   one shared block plus a block per profile the user holds. Matches where the
   push tokens already are (`fcmTokens` / `fcmTokensStudy` / `fcmTokensDo`) and
   is what issue #168 Phase 2 wants anyway. **Costs a schema migration.**
2. **Render-time filtering** — keep the flat map, hide rows for apps the user
   has no profile in. No migration; leaves the schema saying something the UI
   contradicts, and #168 Phase 2 migrates it later regardless.

Recommendation: (1), done once, at PR9 — because PR9 is the moment do's twelve
types land, and migrating a map that already carries them is strictly worse
than shaping it correctly on arrival.

## 6. Backend work this implies (none of it do-specific, all of it do-blocking)

1. **Self-serve account deletion does not exist.** `deleteUser` is
   admin-only; there is no callable a member can invoke on themselves. The
   hub's "Delete my account" needs one — and it must be genuinely cross-app
   (the hub says so: "removes you from sync/sit, sync/study and sync/do"), so
   it has to reach do's collections too. **This is new work that touches
   sync-do's data and should be built with §11.4's hard-delete coverage rather
   than after it.**
2. **`notifPrefs` shape** — see §5.
3. **No handoff change.** `appHandoffCodes` is already app-agnostic (§3.3);
   moving the call from a menu item to a tab needs nothing server-side.
4. **No rules change.** The bar and hub read `users/{uid}` as owner and
   `families/{familyId}` as member — both already permitted. The §7.2
   amendments stand as written.
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
- **Q11 — Notifications shape** (§5): migrate to app-scoped prefs at PR9, or
  filter at render and migrate later under #168 Phase 2.
- **Q12 — Paths or subdomains under the new domain** (§8). Decisive: it
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
| Bottom bar (§2) | A real instant tab switch; no loading state | Keeps its pressed/loading state |
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

**The migration surface is asymmetric, and the asymmetry runs the wrong way.**
study and do were built *expecting* a domain move: `email.ts` exports
`STUDY_APP_URL` and `DO_APP_URL` with a comment promising "the next domain move
is a single edit here", and both web apps read `SIT_APP_URL`/`STUDY_APP_URL`
from env-overridable constants. **sit was not.** There is no server-side
`SIT_APP_URL`; `https://sync-sit.com/...` is inlined directly into email HTML
about twenty times across twelve files under `apps/functions/src/**`
(appointments, admin, references, search, guardian, reminders). Since this *is*
a sit-domain move, it lands almost entirely on the half that was never
centralised.

Two smaller notes in the same area: the client apps' sit fallback is
`https://sync-sit.web.app` while the functions inline `https://sync-sit.com`, so
two sit hosts are already in circulation; and `apps/web/src/constants/brand.ts`,
`apps/do-web/src/constants/brand.ts` and `AboutPage.tsx` carry their own
literals. In total, **21 files hold 46 literal host or address strings** outside
tests.

**First work item, and it is cheap: give sit the constant the other two already
have.** An exported `SIT_APP_URL` in `email.ts` alongside its siblings, and the
twelve functions files rewritten to build on it, makes the eventual cutover the
single edit the comment already claims it is. This is worth doing *now*,
independently of Q12 and before the domain is chosen — it is pure
centralisation, it is testable, and it shrinks the cutover from a 21-file sweep
to a handful of constants.

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

**Consequences already recorded elsewhere in this plan that Q12 may change:**
§3.1 (three hosting targets), §3.3 (the switcher and Auth authorized domains),
§2 (the bar's loading state), §7 Q10 (account hosting). None of them
need editing until Q12 is answered; this section is the pointer so the change
is not discovered piecemeal.
