# Study Signup Reorder + Padding Semantics + Tutor Photo (issue #143) Implementation Plan

> **For agentic workers:** Work in THIS worktree (`.claude/worktrees/signup-order`, branch `feature/study-signup-order`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Three changes from issue #143: (1) the tutor signup collects subjects/levels/rate FIRST after auth, and drops the session-prefs step entirely (server defaults; editable later in the portal); (2) padding is "appointment padding" (not transit), default 30; (3) tutors get profile-photo support like sit babysitters.

**Architecture:** The wizard (`TutorEnrollment.tsx`, steps 0-4) becomes: Email → Verify → Password → **Subjects** (new) → Profile(+contact). The dropped prefs fields get server-side defaults in `tutorSessionPrefsSchema`/`enrollTutor`, and remain editable at `/tutor/account` and `/tutor/area` (shipped in #137). Photo mirrors the sit babysitter mechanism (`profile-photos/{uid}` storage path, `photoUrl` on the profile, initials fallback in cards).

**Tech Stack:** React 19 + TS, zod (study-functions validation), Firebase storage, i18next en+fr, Tailwind brand tokens.

**Constraints (repo law):**
- No emoji. No Co-Authored-By. study-web lint ZERO; web lint exactly 1 error/7 warnings; typecheck clean.
- Every string via i18n in BOTH `apps/study-web/src/i18n/en.ts` and `fr.ts` (real French).
- firestore.rules is the trust boundary — client guards are UX only. Do not weaken `tutorNumericBoundsValid()` or the identity freeze.
- Grep-verify post-state of every scripted edit. Mutation-verify load-bearing new tests (plant the regression, watch the pin fail, restore).
- Never rewrite `profiles.tutor` wholesale — dot-paths only in portal edits.
- Full gates at the end: study-web + web tests, study-functions tests (`pnpm --filter study-functions test` — check the filter name in package.json first), lints, `pnpm -r typecheck`, rules tests if you touch storage.rules (`tests/rules/`).

**Files (verify each before editing):**
- `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx` (step order, payload assembly)
- Create: `apps/study-web/src/pages/enrollment/tutor/StepSubjects.tsx`
- `apps/study-web/src/pages/enrollment/tutor/StepProfile.tsx` (gains contact fields)
- Delete: `apps/study-web/src/pages/enrollment/tutor/StepPrefs.tsx` (+ its tests → replaced)
- `apps/study-functions/src/validation/tutor.ts` (prefs fields optional + defaults)
- `apps/study-functions/src/enrollment/enrollTutor.ts` (apply defaults; contact check)
- `apps/study-web/src/pages/tutor/AccountPage.tsx` (padding copy + photo upload section)
- `apps/study-web/src/components/family/TutorCard.tsx` + tutor detail page (photo display)
- `apps/study-functions/src/search/searchTutors.ts` or equivalent (return photoUrl — find the actual file)
- `storage.rules` (check whether `profile-photos/{uid}` already permits any authed owner — sit babysitters use it; if the rule is role-gated, extend to tutors; if owner-keyed, no change)
- i18n both locales; wizard + account tests

---

### Task 1: Backend — prefs become optional with defaults

In `tutorSessionPrefsSchema` (apps/study-functions/src/validation/tutor.ts):
- `sessionLengthsMin`: `.min(1)` array → `.optional()`; default applied in enrollTutor: `[60]`.
- `locationPrefs`: → `.optional()`; default: ALL values of `LOCATION_PREFS` (widest discoverability; the tutor narrows later in AccountPage).
- `paddingMin`: → `.optional()`; default **30** (issue: "general appointment padding... default of 30 mins"). Bounds 0-60 unchanged.
- `areaMode`: → `.optional()`; default `'arrondissement'` with `arrondissements: []` (the honest "distance unknown" state; tutor sets area at /tutor/area).
- Contact stays REQUIRED at the callable level (families see it on TutorCard after accept) — but it moves to the Profile step client-side (Task 3). Keep the "at least one contact field" check in enrollTutor.
- Apply defaults in `enrollTutor.ts` where the profile doc is assembled — grep every place `enrollment.sessionLengthsMin` etc. are read (~lines 150-155 and the user-doc write ~220-250) so BOTH writes get the defaulted values (compute once: `const prefs = withPrefDefaults(enrollment)`).

- [ ] Update schema + enrollTutor; extend `apps/study-functions/src/validation/__tests__/tutor.test.ts`: payload with NO prefs fields parses; defaults land in the written docs (if the suite tests the callable, pin `paddingMin: 30`, `sessionLengthsMin: [60]`, `locationPrefs: <all>`, `areaMode: 'arrondissement'`, `arrondissements: []`).
- [ ] Run study-functions tests. Commit: `feat(study-functions): session prefs optional at enrollment with server defaults`

### Task 2: StepSubjects — first post-auth step

New `StepSubjects.tsx`. Look at `apps/study-web/src/pages/tutor/SubjectsPage.tsx` FIRST and reuse its row idiom (subject select + level chips + rate input) — same validation rules (rate >= 0, at least one level per subject). Require **at least one subject row** to proceed (the whole point of the issue is that this is the primary information; enrollment with zero subjects produces an invisible tutor).

Wizard (`TutorEnrollment.tsx`): steps become 0=Email, 1=Verify, 2=Password, 3=**Subjects**, 4=Profile. Update the step-count constant / `StepIndicator` props, the `renderStep` switch, and payload assembly (subjects from step 3, profile+contact from step 4, prefs fields OMITTED from the payload entirely — the server defaults them).

- [ ] Write the step + wire the wizard. Update `enrollment/tutor/__tests__/` wizard tests: step order pin (after password, the subjects step renders BEFORE the profile step), at-least-one-subject gate pin, payload pin (subjects array present; no sessionLengthsMin/paddingMin keys in the payload).
- [ ] Commit: `feat(study-web): signup collects subjects, levels and rate first`

### Task 3: Contact fields fold into StepProfile; StepPrefs deleted

- Move contactEmail/contactPhone (+ whatsapp if StepPrefs had it) into `StepProfile` below the identity fields, with the same at-least-one-required validation StepPrefs enforced (`hasContact`).
- Delete `StepPrefs.tsx` and its test file; make sure no imports remain (grep `StepPrefs` → 0).
- aboutMe: StepPrefs collected it — it moves NOWHERE (deferred to AccountPage if it's editable there; check. If AccountPage lacks an aboutMe editor, add a plain textarea to the session-prefs section — it is owner-writable and bounded at 1000 chars by the schema).
- [ ] Wizard tests updated (contact gate now pinned on the profile step). Grep sweeps. Commit: `feat(study-web): contact moves to the profile step; prefs step removed`

### Task 4: Padding rename + default surfacing

- i18n en+fr: `tutor.account.sessionPrefs.*` (grep `Transit padding` / `paddingMin` keys — en.ts ~417-418, ~1009): "Transit padding (minutes)" → "Appointment padding (minutes)"; hint "Time needed before/after in-person sessions for travel" → neutral buffer wording ("Buffer before/after sessions"). French equivalents.
- AccountPage: new tutors now arrive with paddingMin 30 from the server — no client change needed beyond copy; verify the input renders the stored 30.
- [ ] Grep: zero occurrences of "Transit"/"transit" in study i18n (both locales) referencing padding. Commit: `fix(study-web): padding is appointment padding, not transit`

### Task 5: Tutor profile photo

Read `apps/web/src/pages/babysitter/AccountPage.tsx` photo section (~lines 130-210) first and mirror it:
- Study tutor `AccountPage`: photo section (preview, pick file, size/type validation exactly as sit does, upload to `profile-photos/{uid}.{ext}`, `getDownloadURL`, dot-path write `profiles.tutor.photoUrl` + `updatedAt`; remove → `photoUrl: null` + storage delete if sit does that).
- `storage.rules`: read the existing `profile-photos` match. If it is owner-keyed (`request.auth.uid == uid`), tutors already pass — add a rules test pinning a tutor CAN write their own and CANNOT write another uid. If it is role-gated to babysitters, extend to any authed owner and pin both directions.
- Display: TutorCard (family search results) + the family-facing tutor detail page — image with initials fallback (match how sit renders babysitter cards; grep `photoUrl` in `apps/web/src` search components for the fallback idiom).
- `searchTutors` backend: include `photoUrl` in the returned result rows (find where the result objects are built; add the field; it is public-safe — sit exposes babysitter photos the same way).
- firestore.rules: `photoUrl` is a new owner-writable field on profiles.tutor — confirm the identity freeze (`tutorIdentityUnchanged`) does NOT pin it (it pins ejemEmail/enrollmentComplete/verification/approvedFamilies/endorsementCount only) so no rules change is needed; if any validator enumerates allowed fields, extend it.
- [ ] Tests: AccountPage photo pin (file pick → uploadBytes called with `profile-photos/{uid}` path, updateDoc dot-path `profiles.tutor.photoUrl`), TutorCard renders img when photoUrl present / initials when absent, rules test for the storage path if touched, searchTutors test extended for photoUrl passthrough.
- [ ] Commit: `feat(study): tutor profile photos — upload, search card display`

### Task 6: Gates + sweeps

- [ ] `pnpm --filter study-web test`, `pnpm --filter web test`, study-functions suite, rules suite if storage.rules changed.
- [ ] Lints at baselines; `pnpm -r typecheck` clean.
- [ ] Greps: `StepPrefs` → 0; "Transit" (padding contexts) → 0 in both locales; every new i18n key in BOTH files; no `red-*`/`gray-400`; no emoji.
- [ ] Do NOT push, do NOT open a PR, no GitHub comments. Report back with exact gate outputs and deviations.

## Notes
- Existing tutors are untouched: defaults apply only at enrollment; stored prefs are never rewritten.
- The wizard's dropped fields must disappear from the PAYLOAD, not be sent as empty values — the server defaults are the single source of the defaults.
- If the enrollment flow has an e2e spec (grep `tests-e2e/` for study/tutor enrollment), update it to the new step order.

---

## Post-implementation addendum (owner clarifications)

1. **Step order corrected**: the issue meant "demote the prefs", not
   "subjects before the tutor's base information". Shipped order: Email ->
   Verify -> Password -> Profile(+contact) -> Subjects (Subjects submits).
2. **Post-enrollment sign-in added**: the new-account path signs the tutor
   in (best-effort, timeout-backstopped) before the success page — the
   account is created server-side and the wizard previously navigated
   unauthenticated, bouncing the success CTA to login.
The plan text above is kept as history; the code and its pins are the
authority.
