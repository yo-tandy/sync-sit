# Issue #148: Silent existing-account signup flow — Implementation Plan (draft)

> **For agentic workers:** Work in `.claude/worktrees/silent-account` (branch `feature/silent-existing-account`, stacked on `feature/drop-tutor-id-verification`).

**Owner requirement (issue #148):**
1. Signing up with an existing email must LOOK identical to a fresh signup on screen (no "account exists" error) — the user proceeds to the code-entry page.
2. The email they receive differs: "someone tried to sign up with this email — you already have an account, just log in; if this wasn't you, contact support" (support email/contact link).
3. Cross-app: if the account exists (accounts are shared across both apps), the email must say the SAME credentials work on the app they tried to sign up on (e.g. sit babysitter signing up on study: "log in to Sync/Study with your Sync/Sit credentials").

**Current state (verified):**
- `packages/shared-functions/src/auth/verifyEjmEmail.ts:48-52` throws `already-exists {reason:'account-exists'}` unless the caller is authed as that account (cross-app own-email bypass — MUST keep).
- `packages/shared-functions/src/auth/verifyParentEmail.ts:32` same throw, no auth bypass.
- Clients catch it and show `enrollment.accountExistsCta` + login link (`showLoginCta` state): study TutorEnrollment.tsx, sit BabysitterEnrollment.tsx, sit ParentEnrollment.tsx, sit JoinFamilyPage.tsx (verified full list — study has no parent wizard yet, that's issue #150, unassigned).
- One deployment (apps/functions) serves verifyEjmEmail/verifyParentEmail for BOTH apps; emails are hardcoded Sync/Sit-branded in `packages/shared-functions/src/config/email.ts`.

**Design:**
1. **Backend** — in both callables, when the email belongs to a DIFFERENT existing account:
   - Do NOT throw. Return the exact same `{ success: true, message: 'Verification code sent' }` as the fresh path (indistinguishable response).
   - Do NOT write a verificationCodes doc (no valid code can ever be entered; the verify step fails naturally with its existing invalid-code error).
   - Send a new `sendAccountExistsEmail(to, { app, hasProfilesOn })` from email.ts instead of the code email:
     - `app: 'sit' | 'study'` — NEW optional request param from the client (untrusted; only selects email copy + login URL; default 'sit' for verifyEjmEmail callers that don't send it, and match each wizard).
     - Copy: "Someone just tried to create a <Sync/Sit|Sync/Study> account with this email address, but you already have an account. If this was you, simply log in: <login URL>. Your account works on both Sync/Sit and Sync/Study — the same email and password sign you in to either app. If this wasn't you, you can safely ignore this email or contact us at support@sync-sit.com."
     - Login URLs: https://sync-sit.com/login (check real hosting domain constants — see appSwitch.ts SIT_APP_URL/STUDY_APP_URL for canonical prod URLs) / study equivalent.
   - **Mail-bomb guard**: at most one account-exists email per address per 24h. Store marker doc `accountExistsNotices/{email} = { lastSentAt }`; skip sending when fresh, still return success:true. (Firestore rules: collection is server-only — confirm rules default-deny covers unknown collections; expect NO rules change, verify.)
   - Audit: `writeUserActivity('system', 'account_exists_email_sent', { email })` (mirrors existing verification_email_sent).
2. **Clients** — remove the `already-exists` catch branches, `showLoginCta` state, CTA render blocks, and `enrollment.accountExistsCta` keys (en+fr, both apps). Pass `app: 'study'` / `app: 'sit'` in the callable payloads. The authed cross-app add-profile path is unaffected (bypass still issues a real code).
3. **Anti-enumeration coherence**: with #147 merged, neither login, signup, nor (already) kid-invite reveals account existence.

**Tests:**
- Integration (emulator): unauth verifyEjmEmail on an existing user's email → resolves success:true AND no verificationCodes doc AND accountExistsNotices/{email} written; second call within window → still success, no duplicate marker update (or lastSentAt unchanged); authed own-email → code doc written (bypass pin, exists — keep passing); verifyParentEmail same treatment; fresh email → code doc written (existing pins).
- Unit: email.ts copy selection (app→URL/name, cross-app credentials line always present); client wizards: no CTA rendering, error branch removed (update existing tests that pin showLoginCta if any).
- Grep sweeps: `accountExistsCta` → 0; `showLoginCta` → 0; `reason: 'account-exists'` → 0 (or only in kept authed-bypass comment).

**Constraints:** same repo law as always (no emoji, en+fr, lint baselines, full integration via emulators:exec + dev-stack restart, no push from implementer, firestore.rules untouched — verify default-deny covers accountExistsNotices).
