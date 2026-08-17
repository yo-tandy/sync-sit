# Drop Tutor ID Verification (owner decision, 2026-08-17) Implementation Plan

> **For agentic workers:** Work in `.claude/worktrees/drop-tutor-idv` (branch `feature/drop-tutor-id-verification`, stacked on `feature/cross-app-identity` = PR #146). Steps use checkbox syntax.

**Owner decision:** students (tutors) get the SAME trust model as babysitters — the EJM-email verification-code gate only. No ID upload, no admin approval. The FAMILY verification system (`identity` / `ejm_enrollment` types, `families/{id}.verification`) is untouched — only the `tutor_identity` branch goes.

**Consequences:** `enrollTutor` (all paths incl. crossApp) writes `enrollmentComplete: true` at creation, and tutors become search-eligible the moment they flip their own `searchable` toggle (which still requires subjects + schedule slots via the dashboard activation gate). No verification banner, no /tutor/verification page, no admin review queue entry.

**Architecture / removal map (verified by grep):**
1. **Backend**
   - `apps/study-functions/src/enrollment/enrollTutor.ts`: `enrollmentComplete: false` → `true` (both write paths share `tutorProfile`); stop writing `verification: { identityStatus: 'not_submitted' }` on NEW profiles.
   - `packages/shared-functions/src/verification/submitVerification.ts` + `reviewVerification.ts`: remove the `tutor_identity` branches and the `'tutor_identity'` member of the `type` union; family flows must be byte-equivalent after. If the tutor branch is large enough that removal leaves dead helpers, remove those too.
   - `apps/functions/src/index.ts` / `packages/shared-functions/src/index.ts`: exports unchanged unless something becomes empty.
2. **Rules** (`firestore.rules`): `tutorIdentityUnchanged()` — KEEP `ejemEmail`/`approvedFamilies`/`endorsementCount` pins. `enrollmentComplete`: now server-set-true at creation and never legitimately client-changed — KEEP it pinned (server-owned; simpler than opening it). `verification`: keep the pin for legacy docs (a client must still not fabricate/clear it). Net: NO rules change expected — confirm and state so.
3. **Study client**
   - Delete `/tutor/verification` route + `VerificationPage.tsx` + its tests; `apps/study-web/src/stores/verificationStore.ts` — delete if tutor-only (verify: grep its consumers).
   - `apps/study-web/src/pages/tutor/DashboardPage.tsx`: remove `VerificationBanner` and the `identityStatus` plumbing; the activation card's gate becomes `enrollmentComplete && ...` (which is now always true for new tutors — keep reading the field, legacy-safe) — effectively subjects+slots only. Update the header comment (the PR #77 state contract is superseded — say so, don't delete history).
   - Any `identityStatus` reads elsewhere in study-web (grep) — remove with their UI.
4. **Sit admin**
   - `apps/web/src/pages/admin/VerificationsPage.tsx`: remove the `tutor_identity` filter option, badge color, and render branch. Family verification flows unchanged.
   - `apps/web/src/stores/verificationStore.ts`: remove tutor-specific bits if any (verify).
   - Admin dashboard pendingVerificationCount: check whether it counts tutor_identity docs (`adminStore` / the stats callable) — if yes, it now naturally excludes them once none are created; no code change unless the count query filters by type.
5. **Migration note (deploy)**: prod has ZERO tutors (verified 2026-08-12 scan), so no backfill. State in the PR body: any pre-existing dev/test tutor docs with `enrollmentComplete: false` remain invisible to search until manually flipped — acceptable.
6. **Docs/i18n**: remove now-dead `tutor.verification.*` and admin `typeTutorIdentity` keys (grep-verified zero consumers, en+fr per app). The enrollment success copy — check whether it mentions verification/approval wait ("successSubtitle") and reword to reflect immediate activation via subjects+availability.

**Constraints (repo law):** no emoji; no Co-Authored-By; i18n en+fr per owning app; lints at baselines (study 0, web 1/7); grep-verify every scripted edit; mutation-verify load-bearing pins; run the FULL integration suite via emulators:exec with rebuilt shared packages + both functions (the emulator ports may be held by the user's dev emulators — pkill, run, then restart `pnpm emulators` from the MAIN checkout in background and reseed with `node apps/functions/seed-test-data.cjs`, noting it in the report); rules suite (expect no changes — run to prove it). Do NOT push or touch PRs — report back.

---

### Tasks (server-first)

- [ ] **T1 backend**: enrollTutor complete-at-creation + no verification field; strip `tutor_identity` from submit/reviewVerification. Commit.
- [ ] **T2 integration pins**: update every pin asserting `enrollmentComplete: false` / `verification.identityStatus` on new tutor profiles (enroll-tutor, cross-app-enroll-tutor, tutor-age-gate, respond-to-* fixtures that seed searchable tutors can simplify but do NOT need to). NEW pins: a freshly enrolled tutor with subjects + searchable:true (set via the owner toggle path) appears in searchTutors WITHOUT any admin step; submitVerification with type tutor_identity now rejects invalid-argument. Commit.
- [ ] **T3 study client**: route/page/store/banner removal, dashboard gate simplification, success-copy reword, i18n cleanup. Update dashboard tests (banner pins become gate pins). Commit.
- [ ] **T4 sit admin**: VerificationsPage tutor branch removal + store + i18n; update its tests. Commit.
- [ ] **T5 gates**: full unit suites both apps + study-functions, rules suite, FULL integration via emulators:exec, lints, `pnpm -r typecheck`. Grep sweeps: `tutor_identity` → 0 outside git history/plan docs; `identityStatus` → only legacy-tolerant reads you deliberately kept (list them); removed i18n keys → 0 consumers. Report exact outputs.
