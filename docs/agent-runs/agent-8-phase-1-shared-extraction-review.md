# Agent 8 Review — Phase 1 (agent-1 shared-core + agent-2 shared-ui extraction)

**Reviewer:** agent-8-tester
**Reviewed:** `feature/sync-study-shared-ui` @ `378e848` (contains both agents' work via agent-2's merge of agent-1)
**Base:** `01ae4db` (Phase -1 HEAD)
**Diff size:** 109 files / +5597 / -3219
**Verdict:** **PASS** — Phase 1 extraction is a behavioral no-op for sync-sit. Recommend proceeding to Gate 3.

## Three-ask coverage

### Ask 1 — L1–L6 oracle-diff tests re-run on Phase 1 branch

Ran `pnpm --filter web exec vitest run` in `feature/sync-study-shared-ui` after the standard fresh-worktree pre-flight:

```
pnpm --filter @ejm/shared build       → exit 0
pnpm --filter @ejm/shared-core build  → exit 0
```

vitest result (last 5 lines):

```
 RUN  v4.1.4 .../sync-study-shared-ui/apps/web

 Test Files  8 passed (8)
      Tests  40 passed (40)
   Duration  1.58s
```

8 files / 40 tests / 0 failures — identical to the Phase -1 baseline. Specifically:
- L1 useAppointments (5 scenarios, 10 frames) — PASS
- L2 useEndorsements (5 scenarios, 11 frames + 5 callback-identity checks) — PASS
- L3 useFamilyAppointments (5 scenarios, 12 frames + 1 unsub) — PASS
- L4 useSchedule (4 scenarios, 10 frames + 4 sub/unsub) — PASS
- L5 useSubmittedEndorsements (5 scenarios, 12 frames + 1 unsub) — PASS
- L6 PhoneInput (8 scenarios, 17 DOM tuples) — PASS

Hooks remain at `apps/web/src/hooks/` (not moved) — my L1–L5 oracles target them directly. PhoneInput moved to `packages/shared-ui/src/forms/PhoneInput.tsx` but the local `apps/web/src/components/forms/PhoneInput.tsx` is now a thin re-export shim (`export { PhoneInput } from '@ejm/shared-ui';`), so my `@/components/forms/PhoneInput` import resolves transparently. Verified the shared-ui source preserves the Phase -1 controlled-input pattern: no useState/useEffect, `parsePhone(value)` invoked on every render (`packages/shared-ui/src/forms/PhoneInput.tsx:70`).

No oracle drift. No test refactor needed.

### Ask 2 — CSS visual smoke check (3.83 kB shrink)

agent-7 flagged CSS shrunk from 33.22 kB → 29.39 kB and hypothesised "improved token consolidation."

Verified by inspection:

```
$ wc -l apps/web/src/index.css packages/shared-ui/src/theme/*.css
       3 apps/web/src/index.css            # ← just imports
      48 packages/shared-ui/src/theme/base.css
      11 packages/shared-ui/src/theme/sit.css
      18 packages/shared-ui/src/theme/study.css
```

`apps/web/src/index.css` is now a 3-line file:

```css
@import "tailwindcss";
@import "@ejm/shared-ui/theme/base.css";
@import "@ejm/shared-ui/theme/sit.css";
```

All sit-side `@theme` tokens (red palette, radii, semantic colors, type scale) were consolidated into `base.css` (app-agnostic tokens) + `sit.css` (red brand override). Build output `apps/web/dist/assets/index-BrA_8R2q.css` at 29393 bytes matches agent-7's report (29.39 kB ≈ 28.7 KiB). The shrinkage is the expected consequence of de-duplicating tokens that previously lived inline in `apps/web/src/index.css` AND in component CSS, now defined once in shared theme files.

**Verdict per surface:**

| Surface | Components touched | Source path resolution | Verdict |
|---|---|---|---|
| Landing page | `LanguageSelector` | `@/components/ui` → re-exports from `@ejm/shared-ui` | OK |
| Auth/login (chips, buttons, inputs) | `Button`, `Input`, `Chip`, `Badge`, `InfoBanner` | Same | OK |
| Babysitter dashboard | `Card`, `Badge`, `Button`, `Spinner` + Icons | Same | OK |
| Family dashboard | `Card`, `Spinner`, `InstallAppBanner` (local-only), `Dialog` | Mixed (shared + local InstallAppBanner) | OK |
| Admin dashboard | `Card`, `Badge` | Same | OK |
| Verification flow | Form components, `PhotoLightbox` (direct from `@/components/ui/PhotoLightbox`) | Same | OK |
| Endorsements page (publish-hide post-Phase -1) | Local `ReferenceCard` component + hook | `onPublish?: () => void` still optional; guard `{!isPublished && onPublish && ...}` still at line 98; `publishReference` NOT destructured; `unpublishReference` still wired on both maps | OK — Phase -1 publish-hide preserved unchanged |

No visual breakage expected. The CSS shrink is positive: less duplicate, smaller transfer. Tailwind v4's `@theme` tokens resolve at build time, so the runtime palette is unchanged.

### Ask 3 — 8-flow smoke per agent-2's plan (Task 9.2)

Resolved each of the 8 flows to its page file and verified every named component is sourced from either the apps/web barrel (which re-exports from `@ejm/shared-ui`) or a direct `@/components/<dir>/<Name>` import (which is now a re-export shim). Build green + vitest green + structural checks pass:

| # | Flow | Page file | Named components | Resolution |
|---|---|---|---|---|
| 1 | Public welcome `/` | `pages/public/WelcomePage.tsx` | `LanguageSelector` | `@/components/ui` → `@ejm/shared-ui` |
| 2 | Babysitter login | `pages/public/LoginPage.tsx` | `ArrowLeftIcon` | `@/components/ui/Icons` → `@ejm/shared-ui` |
| 3 | Family enrollment Step 1 | `pages/enrollment/parent/StepFamilyInfo.tsx` | `Button`, `Input`, `Textarea`, `Checkbox`, `AddressAutocomplete` | UI via barrel; AddressAutocomplete via shim |
| 4 | Family enrollment Step 2 (kids) | `pages/enrollment/parent/StepKids.tsx` | `Button`, `Input`, `Card`, `Checkbox`, `LanguagePicker`, `PlusIcon`, `XIcon` | UI via barrel; LanguagePicker via shim; Icons direct |
| 5 | Family enrollment Step 3 (parent verify) | `pages/enrollment/parent/StepParentVerify.tsx` | `CodeInput`, `MailIcon` | CodeInput via shim; Icons direct |
| 6 | Family dashboard | `pages/family/DashboardPage.tsx` | `Button`, `Badge`, `Card`, `Spinner`, `Input`, `Dialog`, `Textarea`, `InstallAppBanner` | UI via barrel (incl. local InstallAppBanner) |
| 7 | Family settings → Schedule (lives on babysitter side) | `pages/babysitter/SchedulePage.tsx` | `Button`, `Card`, `Dialog`, `TopNav`, `Textarea`, `Spinner`, `InfoBanner`, `WeeklyTimeline`, `DayEditor`, `OverrideList`, `ChevronRightIcon` | UI via barrel; schedule trio via shim |
| 8 | Family search | `pages/family/SearchPage.tsx` | `AddressAutocomplete`, `CheckIcon`, `ShieldIcon`, Avatar/DateTag (via search-result rendering) | UI via barrel; AddressAutocomplete via shim |

Verified the re-export shim pattern is consistent and complete:

```
$ head -2 apps/web/src/components/forms/*.tsx apps/web/src/components/schedule/*.tsx
==> AddressAutocomplete.tsx <== export { AddressAutocomplete, type AddressResult } from '@ejm/shared-ui';
==> CodeInput.tsx           <== export { CodeInput } from '@ejm/shared-ui';
==> LanguagePicker.tsx      <== export { LanguagePicker } from '@ejm/shared-ui';
==> PhoneInput.tsx          <== export { PhoneInput } from '@ejm/shared-ui';
==> DayEditor.tsx           <== export { DayEditor } from '@ejm/shared-ui';
==> OverrideList.tsx        <== export { OverrideList } from '@ejm/shared-ui';
==> WeeklyTimeline.tsx      <== export { WeeklyTimeline } from '@ejm/shared-ui';
```

All 7 component categories (UI barrel, forms, schedule) follow the same one-line re-export pattern. The barrel at `apps/web/src/components/ui/index.ts` re-exports 15 names from `@ejm/shared-ui` and the local-only `InstallAppBanner`. `AppBar`, `EnrollmentAppBar`, `PushPrompt` deferred per agent-2's plan Q1 (intentionally; not a regression).

Build verification:
- `pnpm --filter web exec vitest run` — 8 files / 40 tests pass
- Build output `apps/web/dist/assets/index-BrA_8R2q.css` = 29393 bytes (matches agent-7's 29.39 kB)
- All imports resolve at TypeScript compile-time (agent-7's typecheck green confirms this transitively)

## Notes & non-blocking observations

- One tiny housekeeping: `pages/enrollment/parent/StepParentVerify.tsx:4` has an empty `import {} from '@/components/ui';` left in place. Harmless (no symbols imported), but worth a one-line cleanup later. Not a Gate 2 finding.
- agent-2's Q1 deferred `AppBar` / `EnrollmentAppBar` / `PushPrompt` from this phase. Confirmed via grep that they still live at `apps/web/src/components/` (not under `ui/`) and continue to work for sync-sit. Their extraction is a Phase 1.5 / 2 item, not a Gate 2 finding.
- shared-ui has a `study.css` theme file (18 lines) already in place — placeholder for sync-study branding. Doesn't affect sync-sit bundle.
- Phase -1's publish-hide on `EndorsementsPage` is preserved exactly (verified at lines 33, 40, 98, 271, 369, 385 of the post-extraction file).

## Conclusion

Phase 1 is a clean structural refactor that:
1. Preserves every sync-sit behavior verifiable by my L1–L6 suite (40/40 green).
2. Consolidates CSS tokens into shared theme files, producing a 3.83 kB net shrink with no token semantic change.
3. Routes every sync-sit consumer through transparent re-export shims, so no `import` statement in `apps/web/src/pages/**` needed updating for component-name lookups.

No regression. Recommend Gate 3 (agent-9 security) proceed.
