# Study Family Portal Shell (PR B of tutor-search milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** study-web gets a real family portal: FamilyLayout + dashboard + account + family-settings (kids CRUD), and parent login routes to `/family` instead of `/signup`. Pure copy-adaptation from apps/web per the established convention (the tutor portal PRs are the precedent). NO search page here (PR C) — `/family/search` gets a "coming soon" stub route.

**Templates to READ:** apps/web/src/layouts/FamilyLayout.tsx (16 lines), apps/web AppBar parent menu, apps/web/src/pages/family/{DashboardPage,AccountPage,FamilySettingsPage}.tsx; study-web precedents: layouts/TutorLayout.tsx + AuthGuard.tsx (+ its tests), components/ui/AppBar.tsx, the tutor pages' test/mocking conventions, i18n parity test.

**Invariants:** apps/web untouched; kids/family docs are shared across apps (edits here appear in sit — by design, comment it); no writes to server-owned fields; every string i18n EN+FR; family data reads mirror how sit's family pages load `families/{familyId}` (READ how sit does it — direct getDoc? a store?).

## Task 1: FamilyLayout + FamilyAppBar + routing flip
- Create `src/layouts/FamilyLayout.tsx` (AuthGuard role="parent" + FamilyAppBar + ScrollToTop + Outlet, mirroring TutorLayout) and `src/components/ui/FamilyAppBar.tsx` (copy-adapt the tutor AppBar; menu: Account, Family Settings + shared static/language/logout block; home → /family). Keep the existing tutor AppBar untouched — decide shared-vs-duplicated chrome the way TutorLayout did (duplicate; chrome is cheap).
- Router: FamilyLayout block with `/family` (dashboard), `/family/account`, `/family/settings`, `/family/search` (stub page rendering an i18n "coming soon" title — PR C replaces it).
- `src/pages/public/LoginPage.tsx`: parent → `/family`. `src/layouts/AuthGuard.tsx`: parent-mismatch fallback → `/family`; update stale comments.
- TDD: extend the AuthGuard test matrix (parent now → children under role="parent", and a tutor hitting role="parent" routes → /tutor) and the LoginPage routing test (parent → /family). Red first.
- Gates: study-web suite + typecheck + lint baseline. Commit: `feat(study-web): family portal shell — layout, routing, parent lands on /family`

## Task 2: DashboardPage
- Greeting from userDoc; **verification banner** when `families/{familyId}.verification?.isFullyVerified` is falsy: explain verification happens on sync-sit and searching is locked until then (i18n; link out to the sit app URL — check how study-web references sync-sit elsewhere, else plain text). Load the family doc directly (mirror sit's dashboard idiom — READ it).
- "Find a tutor" CTA card → /family/search; requests-summary placeholder card (i18n "no requests yet" — PR C wires real data); entry cards to Settings/Account.
- TDD: banner shown/hidden per mocked family verification state; CTA hrefs. (Mock firestore getDoc per the tutor DashboardPage test pattern.)
- Commit: `feat(study-web): family dashboard with verification-gate banner`

## Task 3: AccountPage + FamilySettingsPage
- AccountPage: adapt sit's family AccountPage minus push/PWA plumbing (email-only notifPrefs, same rationale comment as the tutor AccountPage) and minus anything sit-specific (READ it first; keep: profile fields incl. phone/whatsapp on profiles.parent via nested updateDoc, notifPrefs, password reset, LanguageSelector).
- FamilySettingsPage: adapt sit's — family name/address edit, kids CRUD against `families/{id}/kids` (rules already permit family members), with the shared-across-apps comment. Skip sit-specific extras (co-parent invites? READ and decide: KEEP invites only if they're callable-backed and app-agnostic — the invite flow (generateInviteLink/joinFamily) IS shared backend; include it if the copy-adapt is straightforward, else note as follow-up).
- TDD: contact-save payload; a kids-add flow assertion; read-only/identity bits.
- Gates: full study-web suite + typecheck + lint. Commit: `feat(study-web): family account and settings pages`

## Task 4: gates + review + PR
- Full gates (typecheck, test:unit, integration+rules suite — should be unchanged 296+, lint baselines). Whole-branch review (apps/web untouched; i18n parity; guard matrix). Push + PR (body: routing table before/after, shared-collections note, PR C dependency note).
