# Issue #167: Tutor coverage area required + search location filtering — Implementation Plan

> **For agentic workers:** Work in `.claude/worktrees/coverage-area` (branch `feature/tutor-coverage-area`, off merged main 8632ccc). Tasks use checkboxes.

**Owner requirements (issue #167):**
1. A tutor offering sessions that are NOT online and NOT tutor's home must be REQUIRED to set "area you cover".
2. The area page must use the same multiple-choice style as sit's "area I can babysit in".
3. Parent search: parents specify the locations they want to search in; enabling "family home" or "other" filters tutors by their coverage area.

**Interpretation (controller-decided; a note will be posted on the issue):** "locations to search in" = the session-location TYPES (the existing `locationPref` filter, generalized to multi-select). Coverage matching uses the family's search address: the shared AddressAutocomplete already returns `postcode` + `city`, and Paris postcodes 75001–75020 map exactly to `ARRONDISSEMENTS` ('1er'…'20e'); `city` matches `NEARBY_TOWNS`. No geocoding heuristics.

**Verified current state:**
- `apps/study-web/src/pages/tutor/AreaPage.tsx`: areaMode 'arrondissement' | 'distance'; arrondissements entered as comma-separated TEXT (`arrText`) — the part requirement 2 replaces with the sit-style checkbox grid (`ARRONDISSEMENTS.map` + `NEARBY_TOWNS`, see `apps/web/src/pages/babysitter/BabysittingOptionsPage.tsx:147` and `apps/web/src/pages/enrollment/babysitter/StepPreferences.tsx:156-200`).
- `apps/study-functions/src/search/searchTutors.ts:99` single `filters.locationPref` include-check; `:117` distance-mode filtering works off `params.latLng`; `:127-128` arrondissement-mode currently includes ALL (comment admits it).
- `apps/study-web/src/pages/family/SearchPage.tsx`: single-select locationPref, address+latLng loaded from the family doc, AddressAutocomplete for override.
- Constants live in `packages/shared-core/src/constants/config.ts` (ARRONDISSEMENTS, NEARBY_TOWNS) — shared, importable by study-functions and study-web.
- Enrollment writes `areaMode: 'arrondissement', arrondissements: []` defaults (withPrefDefaults) — a fresh tutor has an EMPTY coverage area.

### Task 1: shared postcode→area mapping
**Files:** Create `packages/shared-core/src/utils/parisArea.ts` (+ test), export from utils index.
- `postcodeToArrondissement(postcode: string): string | null` — '75001'→'1er', '75002'→'2e' … '75116'→'16e' (handle the 75116 special case for the 16e), else null.
- `cityToNearbyTown(city: string): string | null` — case/diacritic-insensitive match against NEARBY_TOWNS.
- `resolveAreaLabel({postcode, city}): string | null` — arrondissement first, town fallback.
- Unit tests: the 20 postcodes + 75116, a town with accent variance, unknown inputs → null.

### Task 2: area page multi-choice + requirement
**Files:** `apps/study-web/src/pages/tutor/AreaPage.tsx` (+ its test), study i18n en+fr.
- Replace the arrondissement TEXT input with the sit-style checkbox grid: two groups (Arrondissements, Nearby towns) from the shared constants; state is `string[]`; keep areaMode toggle and the distance mode untouched.
- Requirement gate at save: read `tutor.locationPrefs`; if it contains any value other than 'online'/'tutor_home' AND (areaMode==='arrondissement' with empty selection OR areaMode==='distance' with no areaLatLng) → block save with a new i18n error explaining why the area is required (en+fr).
- Migration tolerance: existing docs may hold arrondissement strings not in the constant lists (free-text era) — render unknown stored values as checked extra entries so saving does not silently drop them; note this in a comment.
- Tests: grid renders all options; requirement error fires for family_home tutor with empty area; online-only tutor saves with empty area.

### Task 3: server-side requirement mirror
**Files:** `apps/study-functions/src/enrollment/enrollTutor.ts` is NOT gated (enrollment collects no area; tutors start online-eligible only if their prefs say so — see decision below); `apps/study-functions/src/search/searchTutors.ts` (+ integration tests).
- DECISION (implement as stated): the trust boundary for requirement 1 is SEARCH — `searchTutors` must not return a tutor for a location-typed query their coverage cannot serve. Client save-gating (Task 2) is UX.
- In the per-tutor filter: accept `filters.locationPrefs` as an ARRAY (keep accepting the legacy single `locationPref` for back-compat, normalizing internally; the client will send the array form). A tutor matches if their `locationPrefs` intersects the requested set.
- Coverage filtering: if the requested set includes 'family_home' or 'library' (treat 'library' as the issue's "other") and the intersection with the tutor's prefs includes one of those: distance-mode tutors → existing haversine radius check vs `params.latLng` (unchanged); arrondissement-mode tutors → match `params.areaLabel` (NEW param: the resolved arrondissement/town label the client computes via Task 1 from the family address postcode/city) against `tutor.arrondissements`; empty coverage or no areaLabel provided → EXCLUDE the tutor for those location types, but still include them if the requested set ALSO intersects their online/tutor_home prefs.
- `params.areaLabel` is untrusted display-agnostic filter input — validate it is a string ≤ 30 chars; anything else → treat as absent.
- Integration pins: arrondissement tutor matches family in a covered arrondissement; excluded for uncovered; online-only query ignores coverage; mixed query (online + family_home) includes an uncovered tutor only via the online leg; legacy single-locationPref param still works; empty-coverage family_home tutor never returned for family_home queries (requirement 1's teeth).

### Task 4: parent search UI
**Files:** `apps/study-web/src/pages/family/SearchPage.tsx` (+ test), study i18n en+fr.
- locationPref single-select → multi-select checkboxes (Online / Tutor's home / Family home / Library) sending `filters.locationPrefs` array.
- Compute `areaLabel` from the selected address via the autocomplete payload (postcode/city through Task 1's resolver; when the family-doc-saved address is used, the doc's saved postcode/city if present — check what the family doc stores; if it lacks postcode, derive only when the user picks via autocomplete and note the gap in the report).
- When family_home/library is checked and no areaLabel could be resolved, surface a small hint that area-filtered results need a Paris/nearby address (en+fr).
- Tests: multi-select sends the array; areaLabel passed when resolvable; hint renders when not.

### Task 5: gates
- FULL integration via `pnpm exec firebase emulators:exec --only auth,functions,firestore,storage --project demo-test "pnpm test:integration"` — NEVER the global firebase binary. Baseline 80 files / 855 tests + your new pins. PORT PROTOCOL: ports 8080/9099/5001/9199 are held by the user's dev stack — pkill first, and AFTER the final run restart from the MAIN checkout (`pnpm emulators` background, wait ready, `node apps/functions/seed-test-data.cjs`, `node apps/functions/patch-profiles-dev.cjs`).
- Units: study-web (baseline 498 + yours), shared-core (18 + Task 1), others unchanged — run web too (207) to prove no cross-app breakage. Lints exact (study 0; web 1/7). `pnpm -r typecheck` exit 0 captured unpiped.
- Grep sweeps: no leftover `arrText`; `filters.locationPref` singular only in the back-compat normalization + its pin; i18n keys consumers verified.

**Constraints (repo law):** no emoji; no Co-Authored-By; conventional commits; i18n en+fr in study; firestore.rules untouched (search is callable-side); grep-verify every scripted edit; never push; never touch GitHub; report back with SHAs, counts, pin names, deviations.
