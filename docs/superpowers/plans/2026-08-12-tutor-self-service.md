# Tutor Self-Service Editing (UX F9 / issue #123) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un-freeze the four enrollment-only tutor fields (issue #123 — read its elaboration comment first): session lengths, transit padding, location preferences, and area/coordinates. Two new tutor-portal surfaces; no backend changes (search/booking read these live; all four fields are owner-editable under the users rules — verify none are pinned before starting).

**Idiom sources (read before writing):** the cancellation-policy section in tutor `AccountPage.tsx` (save-section idiom: local state seeded from userDoc, direct `updateDoc` dot-paths, `refreshUserDoc`, transient success), `SubjectsPage.tsx` (a full edit page with validation), enrollment `StepPrefs.tsx` (the canonical inputs for lengths/padding/locations AND the area block with `AddressAutocomplete` → `areaLatLng` geocoding — reuse its option lists/validation, don't reinvent).

## Task 1: "Session preferences" section on tutor AccountPage (TDD)

Below the cancellation-policy section: session lengths (checkbox group from the same options enrollment offers — verify its list, e.g. 45/60/90; at least one required), transit padding (same select/input as StepPrefs), location preferences (checkbox group online/family_home/tutor_home; at least one required). One Save button for the section → single `updateDoc` with dot-paths `profiles.tutor.sessionLengthsMin` / `paddingMin` / `locationPrefs` + `updatedAt` — non-optimistic, transient saved banner, `t('common.error')` on failure. Client validation mirrors enrollment's.
Tests (red-first): seeds from userDoc; SAVE payload dot-paths + values pinned; validation blocks empty lengths/locations; i18n keys `tutor.account.sessionPrefs.*` EN + real FR.
Commit: `feat(study-web): tutor session preferences are editable`

## Task 2: "Area" editor (TDD)

Decide placement by reading AccountPage's current length: if the page is already long, a separate `/tutor/area` page linked from Account (route + lazyPages, follow SubjectsPage's pattern); otherwise a section. The editor reuses StepPrefs' area block behavior: areaMode toggle (arrondissements multi-select vs distance), `AddressAutocomplete` picking sets `areaAddress` + `areaLatLng` (the geocode), radius input for distance mode. Save writes exactly the fields enrollment writes (`profiles.tutor.areaMode/arrondissements/areaAddress/areaLatLng/areaRadiusKm`), clearing the fields not relevant to the chosen mode (FieldValue.delete or explicit null — match how the profile stores absent fields today; verify with a seeded doc).
**The legacy case is the acceptance test:** a tutor doc with `areaMode: 'distance'` but NO `areaLatLng` (pre-fix enrollee) opens the editor, sees an honest "no location set — distance won't show in search until you set one" note, picks an address, saves → doc now has coordinates.
Tests: payload pins per mode incl. clearing; the legacy-doc flow; validation (distance mode requires a picked address — typing without picking must not fake coordinates: pin that save is blocked or areaLatLng untouched); i18n `tutor.area.*` EN + FR.
Commit: `feat(study-web): tutor area editor with self-service geocoding`

## Task 3: discoverability + gates

- Account page links/labels so both surfaces are findable (and the search-distance note in the area editor explains WHY it matters).
- Gates: root typecheck/build; study-web test/lint(ZERO)/build; sit web suites untouched but run once; FULL integration+rules once (client-only proof; report measured baseline).
- Report: which placement Task 2 chose and why; the legacy-flow test evidence; i18n keys.

## Self-review notes
- Dot-path updates only touch the four fields — never rewrite `profiles.tutor` wholesale (would clobber server-owned siblings like approvedFamilies/endorsementCount; the rules would reject it anyway — do not rely on that).
- AddressAutocomplete is shared-ui — no new geocoding code.
- If any of the four fields turns out rules-pinned, STOP and report (plan premise broken).
