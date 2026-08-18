# Issue #168 Phase 0: cross-app notification defects — Implementation Plan (draft)

> **For agentic workers:** Work in `.claude/worktrees/notif-phase0` (branch `feature/notification-coherence`, off merged main — #173/#174 have merged, the overlap constraint is resolved).

**Scope (no owner decisions needed — the Phase 1 push-client questions are pending on the issue):** fix the live cross-app defects the #168 scout found. Server + prefs UI only; NO push-client work.

## Task 1: per-app branding in the shared senders
**Files:** `packages/shared-functions/src/config/email.ts`, `config/push.ts`, `config/notifyParents.ts`; every study-functions caller; unit tests in shared-functions.
- `sendNotificationEmail(to, subject, body, app: 'sit'|'study' = 'sit')`: sender display name, wrapper header color/name, and the "Open …" footer link switch on app ('Sync/Sit' red #DC2626 sync-sit.web.app vs 'Sync/Study' blue #2563EB sync-study-app.web.app — reuse the ACCOUNT_EXISTS_COPY constants pattern from #154; keep FROM address noreply@sync-sit.com for BOTH until #156 resolves domain setup, but the display name may vary — verify Resend accepts a different display name on the same verified domain; if not, keep sender identical and only re-brand the body, noting it).
- `sendPushNotification(userId, title, body, data?, app = 'sit')`: icon/badge/link per app (study link → https://sync-study-app.web.app).
- `notifyAllParents({... app})` passes through.
- Update EVERY study-functions caller to pass 'study' (scout's inventory: sendTutorContactRequest, respondToTutorContactRequest, cancelContactRequest, bookSession, proposeSession, respondToSession, cancelSession, cancelSessionInstance, submitTutorEndorsement, extendRecurring, sendStudySessionReminders — grep for the two sender names to catch all). Sit callers unchanged (default).
- Unit pins: study body carries no 'Sync/Sit' text and links to the study host; sit default unchanged.
- DEPLOY TRAP (scout item 9): sit functions bundle shared-functions via scripts/bundle-shared-for-deploy.js; study-functions build differently — state in the report that both build paths compiled.

## Task 2: notifPrefs dot-path writes (clobber fix)
**Files:** `apps/study-web/src/pages/tutor/AccountPage.tsx` (:378 whole-object write), `apps/web/src/pages/babysitter/AccountPage.tsx` (:297), `apps/web/src/pages/family/AccountPage.tsx` (:268); their tests.
- Mirror the safe pattern from `apps/study-web/src/pages/family/AccountPage.tsx:119`: write only the edited scenario/channel dot-paths.
- Pin per page: payload contains ONLY dot-paths for changed toggles, never the whole notifPrefs object (mutation-style: flip one toggle, assert the other app's channel keys absent from the payload).

## Task 3: missing scenarios in study prefs UI
**Files:** study tutor + family AccountPage scenario lists + i18n en/fr.
- Family page adds `newRequest` (proposals arrive under it — currently unmutable); tutor page adds `confirmed`; BOTH add `references` (endorsement notifications, gated at submitTutorEndorsement:98). Labels en+fr describing the study meaning (proposals / confirmed sessions / endorsements).
- Tests: scenario lists pinned.

## Task 4: respondToTutorEndorsement notifies the submitter
**Files:** `apps/study-functions/src/endorsements/respondToTutorEndorsement.ts` (+ integration test).
- On publish/decline, notify the submitting family (notifyAllParents, pref `references`, app 'study'): published → "your endorsement for <tutor first name> is now visible"; declined → neutral "was not published". Email+push+doc per the house pattern; copy en-only (server emails are English per existing convention).
- Integration pins: published → notification doc + pref gating respected; declined path.

## Task 5: honest pushSent (tidy)
- `notifyParents.ts:61` and direct doc writes: record pushSent from the actual sendPushNotification outcome (make it return boolean). Nothing reads it, but a false audit field is worse than none. Keep cheap; skip if it balloons.

## Gates
Full integration via `pnpm exec firebase emulators:exec` (NEVER the global binary; port protocol: pkill first, restart dev stack from main checkout + seed + patch-profiles-dev.cjs after final run). Baseline at branch time (was 855 pre-wave; recheck on main). Units all packages; lints exact (study 0, web 1/7); typecheck exit 0 captured; grep sweeps: no remaining whole-object notifPrefs writes (independent pattern: `notifPrefs: ` as a write key in page saves), every study sender call passes app:'study'.
