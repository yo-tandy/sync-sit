# Issue #181: Cross-app session coherence — Record of what shipped (PR #182)

> Written post-implementation for convention parity (every comparable feature
> carries a plan doc). This records the shipped design and its decided
> residuals rather than proposing work.

**Problem:** Sessions are per-origin, so sync/sit and sync/study can hold
different accounts: log out of one and the other stays signed in; a
subsequent login with another account leaves the sibling app on the old one.

**Shipped design (agreed on the issue):** server-side session epoch.
"Log out" means log out everywhere — a safety win for shared family
computers. Residual accepted: deliberately logging into different accounts
directly in the two apps remains possible; the switcher re-aligns on use.

## Mechanism

1. **`signOutEverywhere` callable** (`packages/shared-functions/src/auth/`,
   exported via apps/functions like every shared callable — one deployment
   serves both apps): auth-required, no input args, self-targeting.
   - `update()`s `users/{uid}.sessionEpoch` to a server timestamp. NOT
     set+merge: users docs are born only in enrollment; a missing doc is a
     success-no-op, never a ghost doc.
   - `adminAuth.revokeRefreshTokens(uid)` — the backstop for clients that
     miss the doc watch (closed tab): the session dies at the next ID-token
     refresh, within the hour.
   - Audit entry `signed_out_everywhere` via `writeUserActivity`.
2. **Rules:** `sessionEpoch` added to the users owner-update forbidden-keys
   list — server-owned, the only rules change.
3. **Clients (both authStores):** a realtime `onSnapshot(users/{uid})`
   watcher (replacing the one-shot getDoc in `onAuthStateChanged`; the first
   snapshot preserves the "userDoc set once auth resolves" contract).
   - Epoch captured at sign-in into module state + per-origin localStorage
     (`sessionEpoch:<uid>`); a reload re-arms from storage so a bump made
     while the tab was closed fires immediately.
   - Capture is FORWARD-ONLY per uid (`Math.max`), making the capture itself
     commutative; independently, fresh sign-ins arm from the watcher's first
     SERVER snapshot and suppress enforcement until then (a cached pre-bump
     epoch can therefore neither lower the armed value nor race `login()`'s
     capture into a false force-sign-out — PR #184 review round).
   - Every deliberate sign-in path calls `markNextSignInFresh()` so a stale
     stored epoch cannot kill a brand-new login — all 10 direct sign-in
     sites: both stores' `login()`, both HandoffPages, sit
     Babysitter/Parent enrollment, JoinFamilyPage, KidInvitePage, study
     Tutor/Parent enrollment.
   - Doc epoch NEWER than armed → detach, local `signOut()`, state cleared,
     `forcedSignOut` flag raised. Equal / older / legacy-undefined → no-op.
4. **Announcement:** `ForcedSignOutWatcher` (both apps, mounted inside
   ToastProvider, outside the router → `router.navigate('/')`) consumes the
   flag: toast `auth.signedOutEverywhere` (en+fr) + land on `/`. The flag is
   HELD until `document.visibilityState === 'visible'` — the receiving tab
   is usually backgrounded and the toast auto-dismisses in ~3s.
5. **Logout (both apps):** detach watcher first (self-logout never shows the
   toast), then best-effort `signOutEverywhere` bounded to 5s (SDK
   `{ timeout }` + `Promise.race`; sit also bounds `removePushToken` to 3s),
   then local `signOut()`. A failing or hanging callable never traps the
   user; revocation is the backstop.

## Test surface

- Integration (`tests/integration/auth/sign-out-everywhere.test.ts`): epoch
  bump + strict `tokensValidAfterTime` advance + exactly-one-new audit entry
  (delta-counted, order-independent); second call advances the epoch;
  unauthenticated rejected; self-targeting (a second caller bumps only their
  own doc); missing-doc no-op (no ghost doc; revocation + audit still land).
- Rules pins: sessionEpoch denied as lone field and smuggled into an allowed
  update; normal profile update still passes with sessionEpoch present.
- Units (both apps): newer/equal/legacy/reload-re-arm epoch semantics,
  forward-only capture, bounded logout under fake timers, callable-before-
  signout ordering, epoch captured at login, watcher toast + visibility
  hold, handoff marks fresh before the custom-token sign-in.

## Decided residuals (recorded, not bugs)

- **≤1h ID-token window:** `revokeRefreshTokens` does not invalidate issued
  ID tokens; `onCall` does not check revocation and rules deliberately do
  not gate on `auth_time`. Correct for the stated threat model (cooperating
  clients on a shared computer); NOT a compromised-session kill switch.
- **`sessionEpoch` is readable** wherever the user doc is readable (active
  babysitter profiles, co-parents) — coarse last-logout metadata, consistent
  with `createdAt`/`lastLoginAt` exposure.
- **README functions table** deliberately not extended — it is not
  maintained per-function (guardian family, handoff, etc. already absent).
- Any authenticated user can call the callable in a loop (audit rows +
  Admin SDK hits) — self-inflicted, in line with the other callables.
