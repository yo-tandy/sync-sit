# Phase 1.1 Tier-A Smoke Checklist

**PR:** #45 — sync-study Phase 1 (`@ejm/shared-core` + `@ejm/shared-ui` extraction)
**HEAD:** `3eae638`
**Branch:** `feature/sync-study-tester-phase1-smoke`
**Date:** 2026-05-20
**Owner:** agent-8-tester
**Intended runner:** human operator at a Chromium-class browser
**Time budget:** ~15-20 min for a focused operator covering all eight surfaces

## How to use

The dev environment is already running and shared with team-lead. Do NOT restart it.

- Web app: http://localhost:5173/
- Firebase emulator UI: http://localhost:4000/ (for inspecting Firestore writes when a Pass-criteria asks for it)
- Test data seeded via `apps/functions/seed-test-data.cjs`; all passwords are `test1234`.

Open the web app, sign out if already signed in, then walk each section in order. For each surface, the section ends with **`[ ] PASS`** / **`[ ] FAIL`** tick boxes — tick exactly one. If FAIL, add a one-line note under "Notes" naming the symptom; a screenshot path can be pasted there too if useful.

Each surface is **P0 (Critical)** — these are the canonical sync-sit flows the binding test plan §4 enumerates as Tier-A. Any FAIL is a merge blocker pending team-lead triage.

## Phase 1 regression classes (what to watch for, in priority order)

1. **Tailwind theme-token drift.** Phase 1 split `apps/web/src/index.css` into `packages/shared-ui/src/theme/base.css` (font, radii, shadows, spacing, neutrals) + `sit.css` (red accent overrides). Any colour, radius, or shadow that visibly differs from the previous sync-sit build is a token regression. Compare against memory of the live app pre-extraction, or `git stash` reference if uncertain.
2. **Shared-ui prop-drift.** Components extracted to `@ejm/shared-ui` (Button, Input, Textarea, Select, Checkbox, Card, Dialog, Badge, Chip, Spinner, StepIndicator, Avatar, InfoBanner, TopNav, LanguageSelector, Icons, plus form/schedule components) are now consumed via the barrel re-export at `apps/web/src/components/ui/index.ts`. A prop dropped, renamed, or defaulted differently surfaces as a missing label, missing icon, broken disabled state, or layout shift.
3. **i18n key leaks.** If a barrel re-export changed an import path and an unused key now renders as the literal `t.foo.bar`, the surface shows the raw key instead of the translated string. Always toggle EN ⇄ FR via the LanguageSelector in the TopNav and re-verify the heading and primary CTA per surface.
4. **Dialog-scrim issue (agent-2's parallel investigation).** Section S-1 below defers to agent-2's fix. Other Dialog-based surfaces (S-2 EndorsementDialog, S-3 modify-appointment dialog, S-4 PhotoLightbox) should still be exercised — if they show the same scrim regression as the admin hamburger, note it.

## Test accounts (from `apps/functions/seed-test-data.cjs`, password `test1234` for all)

- **Admin:** `admin@syncsit.test`
- **Babysitters:** `lea.bernard@ejm.org`, `hugo.leroy@ejm.org`, `camille.moreau@ejm.org`, `tom.petit@ejm.org`
- **Parents:** `marie.dupont@test.com`, `pierre.dupont@test.com`, `sophie.martin@test.com`

---

## S-1: Admin dashboard hamburger menu — Dialog scrim (deferred to agent-2)

**Priority:** P0
**Objective:** Confirm the admin hamburger menu opens a Dialog with the expected scrim opacity and dismisses correctly. Agent-2-shared-ui is investigating a Dialog scrim regression on this surface in parallel; do not attempt detailed steps here until that fix lands.

**Login + URL:** Sign in as `admin@syncsit.test` / `test1234`. Land on `/admin`.

**Steps:**
1. Click the hamburger icon (top-left of the admin top bar). **Expected after agent-2's fix:** menu Dialog opens, scrim darkens content behind it, focus traps inside the Dialog, ESC closes it.

**Watch for:** the specific scrim regression agent-2 is fixing. If you see backdrop not appearing, or appearing fully opaque/transparent, or stuck after close — that's the known issue. Do NOT file it as a new bug; cross-reference agent-2's report.

**Pass criteria:** Tick PASS only after agent-2 reports their fix landed AND you re-run this section. Until then, leave both tick boxes blank with a "(holding for agent-2)" note.

- [ ] PASS
- [ ] FAIL
- [ ] HOLDING for agent-2

**Notes:**

---

## S-2: EndorsementDialog (parent submits endorsement on babysitter)

**Priority:** P0
**Objective:** Verify the EndorsementDialog opens, validates input, and writes to `references/{referenceId}` with `type='family_submitted'` and `status='private'` per the post-security-fix rule.

**Login + URL:** Sign in as `marie.dupont@test.com`. Navigate to **Family → Submitted endorsements** (path: `/family/submitted-endorsements` or similar — follow the in-app link from `/family`).

**Steps:**
1. Click "Add endorsement" / equivalent CTA. **Expected:** EndorsementDialog opens centred over the page with the scrim active. Focus lands on the first field.
2. Fill: babysitter selection (pick `Lea Bernard` from the picker), endorsement body (≥ 20 chars). **Expected:** form validates inline; submit button enables only when valid.
3. Click "Submit". **Expected:** Dialog closes, success toast or list refreshes.
4. In Firebase emulator UI (`/firestore`), open `references` and confirm a new doc was written with `babysitterUserId == lea.bernard's uid`, `submittedByUserId == marie.dupont's uid`, `type == 'family_submitted'`, `status == 'private'`. **Expected:** doc present with those four fields.
5. Toggle EN ⇄ FR via the TopNav language selector. **Expected:** the Dialog labels (title, field labels, CTAs) translate; no `t.endorsement.*` literal renders.

**Watch for:** Dialog mounted but invisible (scrim regression spillover from S-1); button defaulted to disabled in shared-ui shim; missing translation key.

**Pass criteria:** Dialog opens cleanly, doc with the four required fields is present, EN/FR labels both render translated.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-3: Modify-appointment dialog (babysitter modifies a confirmed appointment)

**Priority:** P0
**Objective:** Verify a babysitter can open a confirmed appointment and modify the end time via the modify dialog; backend records `modified=true` + `modifiedFields`.

**Login + URL:** Pre-condition: at least one `appointments` doc exists with `status='confirmed'` and `babysitterUserId == lea.bernard's uid` (the seed script creates appointments — confirm via emulator UI before signing in). Sign in as `lea.bernard@ejm.org`. Navigate to `/babysitter` → click the confirmed appointment → land on RequestDetailPage.

**Steps:**
1. Find the "Modify" CTA on RequestDetailPage. **Expected:** a Dialog opens with the appointment's current fields editable.
2. Change endTime by +30 minutes via the time picker. **Expected:** form accepts the new value, validation does not block.
3. Click "Save changes". **Expected:** Dialog closes; the appointment card reflects the new endTime; a notification is sent (visible in emulator UI under `notifications` for the family parents).
4. In emulator UI, open the appointment doc. **Expected:** `modified == true`, `modifiedFields` array contains `'endTime'`, `modifiedAt` is recent.
5. Toggle EN ⇄ FR. **Expected:** dialog labels translate cleanly.

**Watch for:** time-picker field that lost its label (PhoneInput-style shim regression for sibling form components); modify Dialog scrim spillover from S-1; missing French translation for the "Modify" CTA.

**Pass criteria:** Dialog completes the save, Firestore reflects `modified=true` + `modifiedFields=['endTime']`, EN/FR both render.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-4: PhotoLightbox (open + dismiss on babysitter profile)

**Priority:** P0
**Objective:** Verify PhotoLightbox opens on photo click, locks scroll, dismisses on backdrop click and on ESC. This component was deferred by agent-2 per their plan Q1 — verify the shim path still works.

**Login + URL:** Sign in as `marie.dupont@test.com`. Navigate to **Family → Search** (`/family/search`) → run a default search → click any result card → babysitter detail or expanded card with a photo.

**Steps:**
1. Click the babysitter's photo. **Expected:** PhotoLightbox opens full-screen / large overlay, page content visually behind the scrim.
2. Verify body scroll is locked: scroll-wheel over backdrop should not scroll the underlying page.
3. Press ESC. **Expected:** lightbox closes; scroll lock released.
4. Reopen the lightbox; click the backdrop outside the image. **Expected:** lightbox closes.
5. Verify on a viewport with no photo on the babysitter: the lightbox CTA is absent, not a broken empty box.

**Watch for:** scroll-lock leaked after dismiss; ESC not bound (focus-trap shim drift from shared-ui); backdrop with mis-styled colour (`base.css` neutrals drift).

**Pass criteria:** Open + close via ESC and backdrop both work; scroll lock applies and releases cleanly.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-5: SchedulePage WeeklyTimeline (babysitter toggles slots)

**Priority:** P0
**Objective:** Verify the WeeklyTimeline grid renders the 96-slot weekly schedule, allows toggling slots, and persists to `schedules/{uid}.weekly`.

**Login + URL:** Sign in as `lea.bernard@ejm.org`. Navigate to **Babysitter → Schedule** (`/babysitter/schedule`).

**Steps:**
1. Confirm the weekly grid renders with 7 day columns and a vertical 15-min slot scale visible. **Expected:** seeded availability shows pre-filled slots from the seed script (Lea has some morning availability).
2. Drag-select 4 consecutive slots on Tuesday 08:00-09:00 (slots 32-35). **Expected:** the four cells highlight as "available" in real-time.
3. Click "Save" (or rely on auto-save if implemented). **Expected:** success indicator; no error toast.
4. Refresh the page. **Expected:** the four slots persisted.
5. In emulator UI, open `schedules/{lea-uid}`. **Expected:** `weekly.tue` array has `true` at indices 32, 33, 34, 35.
6. Toggle EN ⇄ FR. **Expected:** day-of-week labels translate (Lundi/Mardi/... in FR).

**Watch for:** slot-highlight colour drift (red token from sit.css missing); day labels showing raw `t.schedule.weekday.tue`; auto-save spinner stuck.

**Pass criteria:** Drag-select works, persists, day labels translate.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-6: PhoneInput (enrollment / profile edit)

**Priority:** P0
**Objective:** Verify PhoneInput's country-code `<select>` + digit `<input>` behaves per the L6 oracle: leading-0 strip for +33, no-strip for non-FR, format on country change.

**Login + URL:** Two paths; pick one:
- Path A (enrollment): sign out, click "Sign up" → choose Parent → land on StepParentEmail → use a fresh email (e.g. `smoketest+phone@example.com`) → progress through verify (read code from emulator UI `/auth/users` or the function logs) and password → land on StepFamilyInfo. The PhoneInput is in that form.
- Path B (profile edit): sign in as `marie.dupont@test.com` → **Family → Account** → find the phone field.

**Steps:**
1. Initial state: country `<select>` defaults to `+33`, input empty.
2. Type `06` in the digits field. **Expected:** input renders `6` (leading 0 stripped under +33); the parent form's value is `+33 6`.
3. Change `<select>` to `+44`. **Expected:** the digits are re-formatted under +44; the parent form's value becomes `+44 6` (oracle: country change reformats but keeps the typed digits under the new code).
4. Type `06` again with `+44`. **Expected:** input renders `06` (no leading-0 strip for non-FR); form value `+44 06`.
5. Clear the input. **Expected:** form value `""` (formatFullNumber on empty digits returns empty).
6. Toggle EN ⇄ FR. **Expected:** label, placeholder, error messages translate.

**Watch for:** select dropdown options missing the country flag emoji or label drift; input cleared on country change (should preserve digits); the test passing in vitest but failing in the live form (would indicate a barrel shim mis-export).

**Pass criteria:** All five oracle behaviours match, EN/FR labels translate.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-7: AddressAutocomplete (enrollment / family settings)

**Priority:** P0
**Objective:** Verify AddressAutocomplete suggests addresses, lets the user pick one, and produces a structured `{address, latLng}` value to the parent form.

**Login + URL:** Sign in as `marie.dupont@test.com`. Navigate to **Family → Settings** (`/family/settings`) and find the address field. Or use enrollment Path A from S-6 and reach StepFamilyInfo.

**Steps:**
1. Click the address field. **Expected:** input gets focus; placeholder visible.
2. Type "10 rue de" (a partial Paris address). **Expected:** suggestion dropdown opens with at least one match within 1-2 seconds.
3. Click a suggestion. **Expected:** input populates with the full address; the dropdown closes; the form's hidden `latLng` value updates (visible in submit payload or in emulator UI after save).
4. Save the form. **Expected:** the saved doc (`families/{familyId}` for settings, `users/{uid}` for the enrollment family-info step) has `address` (string) and `latLng: {lat, lng}` (numbers).
5. Toggle EN ⇄ FR. **Expected:** placeholder, label, no-results state all translate.

**Watch for:** suggestions never appear (Geoapify / Mapbox / Google Places key missing in dev — environment, not Phase 1 regression — flag to team-lead before failing); selected suggestion doesn't push the latLng to the parent form (shim drift); save errors with "address required" despite text present (input wired to a different ref than the form).

**Pass criteria:** Type → suggest → pick → save → Firestore has `{address, latLng}` round-tripped.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## S-8: Babysitter enrollment happy path (end-to-end)

**Priority:** P0
**Objective:** Walk a new EJM-domain babysitter from sign-up to searchable=true, exercising every shared-ui form component on the path (Email → Verify → Password → Profile → Preferences).

**Login + URL:** Sign out. Visit `/` → "Sign up" → choose Babysitter → land on StepEmail.

**Steps:**
1. **StepEmail.** Enter `smoketest+babysitter@ejm.org` (or any unused `@ejm.org` address). Submit. **Expected:** `verifyEjmEmail` callable returns 200; advance to StepVerify; verification code written to `verificationCodes/{email}` (visible in emulator UI).
2. **StepVerify.** Read the 6-digit code from the emulator UI's Firestore tab, enter via CodeInput. Submit. **Expected:** `verifyCode` returns 200; advance to StepPassword.
3. **StepPassword.** Enter a strong password (12+ chars, mixed case, digit, symbol — e.g. `Smoke!Test2026`). Submit. **Expected:** account created in Firebase Auth (visible in emulator UI `/auth/users`); `users/{uid}` created with `role:'babysitter'`; advance to StepProfile.
4. **StepProfile.** Fill firstName, lastName, DOB (≥ MIN_BABYSITTER_AGE), classLevel, gender, languages (multi-select Chip), upload photo (any small PNG / JPG), address (uses AddressAutocomplete from S-7), PhoneInput (from S-6). Submit. **Expected:** `users/{uid}` updated with profile fields per `babysitterProfileSchema`; advance to StepPreferences.
5. **StepPreferences.** Set hourlyRate, areaMode (multi-select from ALL_AREAS), maxKids, kidAgeRange. Submit. **Expected:** `enrollBabysitter` callable returns 200; `users/{uid}` has `searchable:true`, `status:'active'`, `enrollmentComplete:true`.
6. Sign out. Sign in as `marie.dupont@test.com`, run search, confirm the new babysitter appears in results.
7. Toggle EN ⇄ FR at any step; spot-check the headings and primary CTA translate.

**Watch for:** StepIndicator wrong step highlighted (shared-ui shim regression); photo upload silently swallows the file (Storage write to `profile-photos/{uid}.ext` not happening); ALL_AREAS multi-select missing values; final search not finding the babysitter (likely `searchable=false` left by mis-mapped final payload).

**Pass criteria:** All five steps complete, final search returns the new babysitter, EN/FR both readable end-to-end.

- [ ] PASS
- [ ] FAIL

**Notes:**

---

## Disposition handoff

When all eight rows are ticked:

1. If every row is PASS (or S-1 is HOLDING with agent-2's confirmation that the fix lands separately): the merge gate is GREEN.
2. If any row is FAIL: the merge gate is RED. SendMessage team-lead with the surface ID, the failing step, and the symptom line from Notes.
3. If S-1 is HOLDING and the rest PASS: the merge gate is YELLOW — block on agent-2's Dialog scrim fix only.

Overall human verdict:

- [ ] GREEN — all rows PASS (or S-1 covered by agent-2's parallel fix)
- [ ] YELLOW — all rows PASS except S-1 holding for agent-2
- [ ] RED — one or more failing rows; see Notes

Operator name: _______________
Run completed at: _______________ (timestamp)
