# Guardian Sit-Web UI + Payload Enrichment (Parental Governance PR 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the parental-governance milestone: enrich the oversight payload (the four gaps PR 4 found), upgrade study-web to use it, ship all sit-web (apps/web) governance surfaces including the public kid-invite redemption page, and the admin governance panel.

**Context docs (read in order):** `2026-08-04-parental-governance-design.md` (rulings), `2026-08-06-guardian-study-ui.md` + the MERGED study-web implementation under `apps/study-web/src/pages/family/Governance*` / `CreateKidInvitePage` / kid-side components — sit surfaces COPY-ADAPT these per the repo's established cross-app convention. PR 4's PR body lists the four payload gaps this PR's Task 1 closes.

**House rules:** TDD red-first; i18n EN + real FR; study-web lint ZERO; sit web lint baseline is EXACTLY 1 error / 7 warnings pre-existing — add none; non-optimistic mutations; anti-enumeration UX identical to study-web (uniform success screen, byte-identical pin test in the sit copy too); no accept affordances on guardian surfaces (pin).

---

## Task 1: backend payload enrichment

Files: `packages/shared-functions/src/guardian/oversight.ts` (detail payload mapping), `createKidInvite.ts` + `redeemKidInvite.ts` (familyName denorm), the relevant integration tests (these are THIS milestone's tests — extending them is expected; do not touch unrelated suites).

- getGovernedChildDetail: instances gain `instanceId` (the doc id); sessions gain `proposedBy` (absent → 'family' per shared-core contract) and, for recurring, `recurringSlots`.
- guardianLinks docs gain denormalized `familyName` at creation (claim branch of createKidInvite AND redeemKidInvite; read once from families/{id}). No backfill needed — governance has never been deployed to prod (the parked deploy batch ships it all at once); the kid-side card still falls back gracefully when absent.
- Integration tests: extend the guardian-oversight suite to pin the three new detail fields; extend create/redeem tests to pin familyName on the link.
- Commit: `feat(shared-functions): enrich oversight payload and denormalize familyName`

## Task 2: study-web catches up

- GovernedChildPage: per-instance cancel now enabled (cancelSessionInstance with instanceId; ReasonModal); pending sessions route by `proposedBy` — kid-proposed pending → "Withdraw proposal" (cancelSession) instead of Decline (respondToSession would refuse); recurring cards show the weekly slot line from recurringSlots.
- SupervisionRequestCard: render "A parent of the {familyName} family…" when familyName present (fallback stays).
- Tests updated/extended accordingly (the no-accept pin must still pass — Withdraw is a cancel, not an accept).
- Commit: `feat(study-web): per-instance cancel, proposal routing, and family name`

## Task 3: sit-web family governance surfaces

Copy-adapt from study-web into apps/web (React idioms of the sit app; find the family portal layout/pages and follow them):
- `/family/governance` dashboard (kids + invites + add-child CTA; cancel/resend; expiry styling).
- `/family/governance/new` create-kid-invite with the consent trio (links: sit's ToS/privacy pages + `/supervision-agreement`); the uniform-success screen WITH the byte-identical pin test (same technique as study-web's).
- `/family/governance/:childUid` oversight + protective controls — sit-side data is the same payload (it already includes sit appointments/profile); controls: searchable toggles (both apps), cancel appointment (existing cancelAppointment via guardian path — ReasonModal/reason idiom of sit), decline pending appointment request (respondToRequest decline), decline contact sharing (respondToContactSharing decline). Study data shows read-only here with a "manage in sync-study" hint where a study-only control (session cancel) would go — do NOT wire study callables from the sit app (different Firebase app config? verify — if the callables resolve fine cross-app since it's one project, wiring them is ALLOWED; prefer wiring if it works, hint only if not).
- No accept affordances (pin).
- Commit: `feat(web): family governance surfaces`

## Task 4: kid-invite redemption page (sit web, public)

Route `/kid-invite` (public, no auth): reads `?token=` from the URL. Screen: explains a parent created this account; password + confirm-password fields (strong-password rules mirrored client-side from whatever sit's signup uses); links to ToS/privacy/supervision-info ("By continuing you get a supervised account — here's what that means"); submit → `redeemKidInvite({ token, password })` → sign the kid in exactly the way sit's enrollment flow does after account creation (read enrollBabysitter's client flow and mirror the post-callable sign-in; the callable's return contract matches enrollment's) → route to the sit landing/enrollment. Error states: invalid/expired token → friendly "ask your parent to resend" screen (generic — no distinction between invalid and expired beyond the resend hint); weak password inline.
Tests: token from URL pinned in payload; success signs in + navigates; generic error screen for rejection; no token in URL → same friendly screen.
- Commit: `feat(web): kid invite redemption page`

## Task 5: sit-web kid-side + agreement page

- Babysitter dashboard: SupervisionRequestCard (copy-adapt; guardianLinks/{ownUid} doc get; accept/decline; decline-is-private confirm).
- Babysitter AccountPage: supervised indicator (governedBy) linking to `/supervision-info`.
- `/supervision-info` + `/supervision-agreement` static pages: SAME authoritative copy as study-web (import-share via shared-ui if trivial, else duplicate the i18n keys — follow how other static-page copy is shared between the apps; the agreement text must be IDENTICAL to study-web's, both languages).
- Commit: `feat(web): kid supervision surfaces and agreement page`

## Task 6: admin governance panel (sit admin)

New admin page (follow sit admin routing/idioms; link from the admin nav): three sections —
1. **Supervised accounts** (`listSupervisedAccounts`): table of links — kid, family, status, origin, consent versions + dates (the GDPR view; pin consent columns in test).
2. **Alerts** (`listAdminAlerts({onlyUnreviewed:true})` default + toggle): type, date, payload summary; "Mark reviewed" (reviewAdminAlert, non-optimistic).
3. **Force revoke** per active link row: reason-required confirm modal; when the kid is under 15 the modal carries an explicit warning that the account will be blocked (mirror the backend pairing); calls forceRevokeSupervision.
Tests: admin-store callable pins for all four callables; under-15 warning rendering; non-optimistic refetches.
- Commit: `feat(web): admin governance panel`

## Task 7: gates

study-web: test/lint(0)/build. web: test/lint(baseline 1/7, no additions)/build. Root typecheck. Backend: touched-package unit suites + the guardian integration suites + FULL integration + rules suite (Task 1 touched shared-functions — full run required; baseline 776 + extensions). Report per established format.

## Self-review notes

- Task 1 extends THIS milestone's own tests — that's expected evolution, not a regression-contract violation; unrelated suites stay untouched.
- The sit uniform-success pin is not optional — copy the technique, not just the screen.
- Agreement copy: one source of truth; if duplicated, a test should assert EN strings equality across apps (cheap parity guard) — implement if feasible without contortions, else note.
- Redemption page is PUBLIC: no auth guards may wrap the route; verify the router treats it like other public pages.
