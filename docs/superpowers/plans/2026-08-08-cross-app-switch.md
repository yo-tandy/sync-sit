# Cross-App Session Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in user switches between sync-sit and sync-study with one click, no re-login. The apps are on different origins (Firebase Auth persistence is per-origin), so the switch is a server-mediated handoff: one-time short-TTL code → custom token → `signInWithCustomToken` on the other side.

**Security model:** the code is 32 random bytes, stored **sha256-hashed**, **60-second TTL**, **one-time** (transactionally consumed — double-redeem race-safe), deleted on redemption; it travels in the **URL fragment** (`#code=…` — fragments never reach servers/logs). Redemption refuses non-active accounts and returns ONE generic error for every failure mode (no oracle for valid-vs-expired-vs-used). Same token hygiene as kidInvites.

## Task 1: backend callables + rules

Files: `packages/shared-functions/src/handoff/appHandoff.ts` (new), export both callables from the package index + `apps/functions/src/index.ts`; `firestore.rules` (one block); integration tests `tests/integration/handoff/app-handoff.test.ts`; rules tests.

- `createAppHandoffCode()`: auth required; caller's user doc must exist with status 'active' (blocked/deactivated users cannot mint). Generate token via the same helper idiom as kidInvites (crypto.randomBytes(32).hex; reuse/extract the hash helper from guardian/shared.ts rather than duplicating). Write `appHandoffCodes/{autoId}` `{ uid, tokenHash, createdAt, expiresAt: now+60s }`. Return `{ code }`. Audit (`writeUserActivity('app_handoff_created')` — no token material in the audit).
- `redeemAppHandoffCode({ code })`: unauthenticated. zod: code non-empty string ≤128. Query by tokenHash (equality). In a TRANSACTION: re-read, verify not expired, DELETE the doc (consume). Outside failure paths return the ONE generic error: HttpsError('not-found', 'This link has expired. Switch apps again from the other app.'). After consume: load user; status must be 'active' (else same generic error — a blocked user learns nothing); `adminAuth.createCustomToken(uid)`; return `{ token }`. Audit on success. Opportunistic hygiene: when the queried doc is already expired, delete it before erroring.
- Rules block: `match /appHandoffCodes/{id} { allow read, write: if false; }` (nobody — not even admin — reads token hashes from clients) + rules test.
- Integration tests (red-first): mint→redeem roundtrip returns a token that the CLIENT SDK can sign in with (verify via the emulator Auth REST or the test harness's client SDK — assert uid matches); second redeem of the same code → generic error (one-time); expired (write doc with past expiresAt via admin) → generic error + doc deleted; blocked user mint refused; blocked user redeem (block AFTER mint) → generic error; unauthenticated mint refused; the generic error MESSAGE is byte-identical across expired/used/garbage-code cases (pin — no oracle).
- Commit: `feat(shared-functions): one-time cross-app session handoff`

## Task 2: both web apps — switch links + /handoff pages

**Counterpart URLs** via env with prod defaults, per app:
- apps/web: `VITE_STUDY_APP_URL` default `https://sync-study-app.web.app`
- apps/study-web: `VITE_SIT_APP_URL` default `https://sync-sit.web.app`
Add to each app's `.env.development` pointing at the sibling's local dev port (read each app's vite config for the ports). Resolve as `import.meta.env.VITE_X ?? '<prod default>'` in one small util per app.

**Switch entry** (visible to any logged-in user; follow each app's nav idiom — sit: AppBar burger menu item; study: layout nav/menu — copy where existing cross-cutting links like Account live, in BOTH portals of each app where the nav differs by role): label i18n `appSwitch.toStudy` ("Open sync-study") / `appSwitch.toSit` ("Open sync-sit"). onClick: disable + spinner (non-optimistic), `createAppHandoffCode`, then `window.location.assign(`${url}/handoff#code=${encodeURIComponent(code)}`)`. On callable error: small toast/alert per app idiom, re-enable.

**/handoff page** (PUBLIC route in both apps — sit: PublicLayout beside /kid-invite; study: public route beside /supervision-agreement): on mount, read `code` from `window.location.hash` (parse, then IMMEDIATELY `history.replaceState` to strip the fragment), call `redeemAppHandoffCode`, then `signInWithCustomToken(auth, token)`, then navigate to the app's post-login landing (reuse the exact same routing the login page uses after successful sign-in — read it and reuse, don't reinvent). States: spinner ("Switching apps…"), error → friendly screen with a link to /login ("This link has expired — switch again from the other app"). No code in the fragment → same error screen. If a user is ALREADY signed in on this origin, still redeem+sign-in (the handoff wins — it's the fresher intent; note in comment).
Tests (both apps): switch entry pins the callable + the navigated URL (mock location.assign) including fragment form; /handoff happy path pins redeem payload + signInWithCustomToken arg + fragment stripped + landing navigation; error state renders friendly screen; missing-code state identical to error (no oracle in UI either); i18n EN + real FR.
- Commit: `feat(web,study-web): one-click app switch with session handoff`

## Task 3: gates

study-web test/lint(0)/build; web test/lint(baseline 1 error/7 warnings, add none)/build; root typecheck + build; full integration + rules suite (Task 1 touched shared-functions + rules: full run; baseline 776 + new). Report per established format.

## Self-review notes

- Fragment, not query param — pinned in the navigation test.
- The generic-error byte-identity across failure modes is the security pin of Task 1.
- The consume transaction DELETES (not flags) — no reuse window, no stale rows; expiry cleanup is opportunistic.
- signInWithCustomToken replaces any existing session on the target origin by design.
- No new indexes (tokenHash equality is single-field).
