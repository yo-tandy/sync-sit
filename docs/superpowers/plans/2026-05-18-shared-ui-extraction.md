# Shared-UI Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is agent-2-shared-ui's Phase 1 deliverable, executed inline (single agent, sequential tasks) — not subagent-driven, because every task must verify with `pnpm typecheck && pnpm build` between commits and a fresh subagent per task would re-pay the workspace-build cost each time.

**Goal:** Extract sync-sit's reusable UI primitives, form components, schedule editors, and theme tokens into a new `packages/shared-ui/` workspace package (`@ejm/shared-ui`), replacing each original file in `apps/web/src/components/` with a thin re-export. Zero visual regressions in sync-sit.

**Architecture:** Additive copy-then-re-export per §7. New package `@ejm/shared-ui` is a React 19 + Tailwind 4 component library, peer-depending on `react`, `react-dom`, `react-router`, `react-i18next` (no Firebase, no Zustand, no Zod). Theme tokens split: `base.css` (font/radii/shadows/neutrals/semantic), `sit.css` (red brand), `study.css` (blue/teal brand). sync-sit's `apps/web/src/index.css` imports `base.css` + `sit.css` from the package via `@import` and keeps the `@theme` block populated. Each component is copied to `packages/shared-ui/src/...`, then the original file at `apps/web/src/components/...` becomes a one-line re-export so all existing `@/components/ui/...` imports keep working unchanged. The component-barrel `apps/web/src/components/ui/index.ts` finally becomes a curated re-export from `@ejm/shared-ui` plus the two sync-sit-only files (`InstallAppBanner`, `PushPrompt`).

**Tech Stack:** pnpm workspaces, TypeScript 5.9 (`moduleResolution: bundler`, `verbatimModuleSyntax: true`), React 19, Tailwind 4, Vite 8, Vitest 4.

---

## Scope decisions (ratified by team-lead 2026-05-18)

Both questions below were raised before execution and approved by team-lead with the agent-2 recommendations. Recorded for posterity.

### Q1 — AppBar / EnrollmentAppBar / PushPrompt: extract now, defer, or refactor first?

These three Tier-3 components imported by §8 today depend on sync-sit-specific modules:
- `AppBar.tsx` → `@/stores/authStore` (Zustand) + `@ejm/shared` (`UserRole`)
- `EnrollmentAppBar.tsx` → `@/stores/authStore`
- `PushPrompt.tsx` → `@/stores/authStore` + `@ejm/shared` (`isRunningAsPWA`) + `@/lib/pushNotifications` + Firestore client (`@/config/firebase`, `firebase/firestore`)

Additionally `AppBar.tsx` hard-codes sync-sit navigation routes (`/babysitter/...`, `/family/...`, `/admin/...`) and tab labels.

Pulling them as-is forces `@ejm/shared-ui` to depend on Firebase client SDK and a sync-sit-specific store — an architectural mistake. The clean alternative is to refactor them to "headless" / props-driven (accept `user`, `onLogout`, `navItems`, `featureFlags` as props; let each app wire its own store and routes). That refactor is invasive — touches three layouts (`BabysitterLayout`, `FamilyLayout`, `AdminLayout`), one enrollment page, and `App.tsx`.

**Decided (team-lead, 2026-05-18):** Defer all three. Leave their files in `apps/web/src/components/ui/` untouched. Phase 1 extracts 13 of 16 §8-listed UI components + 4 forms + 3 schedule = 20 total. Agent 5's instruction (per team-lead): when building sync-study's AppBar, build it fresh from shared-ui primitives — do not try to share these three with sync-sit. Headless/props refactor is a Phase 2/3 backlog item.

**Risk if not deferred:** `@ejm/shared-ui` ships with a hard dependency on `firebase` + Zustand + `@ejm/shared`, defeating the point of an isolated UI library and forcing sync-study to install Firebase just to render an app bar.

### Q2 — `@ejm/shared-ui` depends on `@ejm/shared` or `@ejm/shared-core`?

Schedule components (`WeeklyTimeline`, `DayEditor`, `OverrideList`) import from `@ejm/shared`: `slotIndexToTime`, `timeToSlotIndex`, `createEmptySlots`, `setSlotRange`, `DAYS_OF_WEEK`, `DayOfWeek`, `ScheduleOverrideDoc`. Per Agent 1's §8 brief, all of these move to `@ejm/shared-core` (with `@ejm/shared` keeping a re-export shim).

**Decided (team-lead, 2026-05-18):** `packages/shared-ui` depends on `@ejm/shared-core` directly. The `@ejm/shared` shim is reserved for sync-sit's legacy import paths; new packages take the canonical dep.

**Coordination protocol (team-lead, 2026-05-18):** Before Task 7 starts, check `git -C .claude/worktrees/sync-study-shared-core log --oneline`. Agent 1's commits land in 8 batches; the Task 7 preconditions land at:
  - C2 — constants (`DayOfWeek` from `constants/config.ts`)
  - C3 — utils (slot utilities from `utils/schedule.ts`)
  - C4 — pure types (`ScheduleOverrideDoc` from `types/schedule.ts`)
So agent-1 must be at C4 or later before Task 7 starts. If not, STOP and SendMessage team-lead — they'll nudge agent-1 or authorize a shim-fallback as a temporary measure. Use `git fetch` to pull the latest commits before re-checking.

---

## File Structure

### New files (created by this plan)

```
packages/shared-ui/
├── package.json                          # @ejm/shared-ui — name, exports, peerDeps
├── tsconfig.json                         # Extends root base.json + bundler resolution + JSX react-jsx
├── README.md                             # Skip — repo convention is no README per file
├── src/
│   ├── index.ts                          # Barrel: components/* + forms/* + schedule/*
│   ├── theme/
│   │   ├── base.css                      # Font, radii, shadows, neutral colors, semantic tokens
│   │   ├── sit.css                       # Red brand override (--color-red-*)
│   │   └── study.css                     # Blue/teal brand override (placeholder values)
│   ├── components/
│   │   ├── index.ts                      # Barrel for UI primitives only
│   │   ├── Spinner.tsx
│   │   ├── Badge.tsx
│   │   ├── Chip.tsx
│   │   ├── Avatar.tsx
│   │   ├── Checkbox.tsx
│   │   ├── Icons.tsx
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Textarea.tsx
│   │   ├── Select.tsx
│   │   ├── Card.tsx
│   │   ├── InfoBanner.tsx
│   │   ├── Dialog.tsx
│   │   ├── StepIndicator.tsx
│   │   ├── TopNav.tsx
│   │   ├── DateTag.tsx
│   │   ├── LanguageSelector.tsx
│   │   └── PhotoLightbox.tsx
│   ├── forms/
│   │   ├── index.ts
│   │   ├── AddressAutocomplete.tsx
│   │   ├── CodeInput.tsx
│   │   ├── LanguagePicker.tsx
│   │   └── PhoneInput.tsx
│   └── schedule/
│       ├── index.ts
│       ├── WeeklyTimeline.tsx
│       ├── DayEditor.tsx
│       └── OverrideList.tsx
```

### Files modified (in `apps/web/`)

Each component file in `apps/web/src/components/{ui,forms,schedule}/` that is extracted becomes a one-line re-export:

```ts
// apps/web/src/components/ui/Button.tsx
export { Button } from '@ejm/shared-ui';
```

For `Icons.tsx` (uses `export *`):
```ts
// apps/web/src/components/ui/Icons.tsx
export * from '@ejm/shared-ui';
```
(safe because shared-ui's `index.ts` re-exports the Icons module; consumers do named imports.)

- `apps/web/src/components/ui/index.ts` — final form re-exports from `@ejm/shared-ui` for the 16 extracted UI components, and keeps direct re-exports of the two sync-sit-only files (`InstallAppBanner`, plus we still need to keep `PushPrompt` reachable via `@/components/ui/PushPrompt` if deferred per Q1).
- `apps/web/package.json` — add `"@ejm/shared-ui": "workspace:*"` to `dependencies`.
- `apps/web/src/index.css` — strip the `@theme` block contents and instead `@import` `base.css` + `sit.css` from the package.
- `apps/web/vite.config.ts` — no changes needed (workspace package is resolved by pnpm + Vite automatically); verified by Task 1 build check.
- **Tailwind 4 content scanning:** apps/web uses Tailwind 4 via `@tailwindcss/vite` (no `tailwind.config.js`, no `postcss.config.*` — verified). Tailwind 4's Vite plugin auto-discovers content from the Vite module graph: any source file imported by the app is scanned for class names. Because every shared-ui component file is imported by apps/web (via the re-export chain), its classes are detected automatically. No content-glob configuration is required. If we ever ship a sync-study app that imports shared-ui in isolation, the same auto-discovery applies there.

### Files NOT touched (explicit non-targets)

- `apps/web/src/components/ScrollToTop.tsx` (not in §8 list)
- `apps/web/src/components/ui/InstallAppBanner.tsx` (not in §8 list — sync-sit-coupled)
- `apps/web/src/components/ui/AppBar.tsx` (deferred per Q1)
- `apps/web/src/components/ui/EnrollmentAppBar.tsx` (deferred per Q1)
- `apps/web/src/components/ui/PushPrompt.tsx` (deferred per Q1)
- `apps/web/src/components/appointments/` (sync-sit-specific per §8 "Does NOT touch")
- `apps/web/src/components/endorsements/` (sync-sit-specific per §8 "Does NOT touch")
- `packages/shared/` (Agent 1's territory)

### Inter-component dependency graph (drives extraction order)

```
Tier 1 (no internal deps):     Spinner, Badge, Chip, Avatar, Checkbox, Icons
Tier 2a (depend on Tier 1):    Button, Input, Textarea, Select, Card, InfoBanner,
                               DateTag (uses Badge), LanguageSelector,
                               PhotoLightbox (uses Avatar), TopNav (uses Icons)
Tier 2b:                       Dialog, StepIndicator
Forms (depend on Tier 1/2):    AddressAutocomplete, CodeInput, PhoneInput,
                               LanguagePicker (uses Chip)
Schedule (depend on Tier 2 + @ejm/shared-core):
                               WeeklyTimeline, DayEditor, OverrideList
```

---

## Task 0 — Pre-flight checks and team-lead sign-off

**Files:** none modified.

- [ ] **Step 0.1: Confirm worktree and branch**

Run: `pwd && git branch --show-current`
Expected:
```
/Users/yoav/TandY/EJM-Babysitter-app/.claude/worktrees/sync-study-shared-ui
feature/sync-study-shared-ui
```

- [ ] **Step 0.2: Baseline build is green**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three commands exit 0.

- [ ] **Step 0.3: Confirm team-lead decisions on Q1 and Q2**

Do NOT proceed until team-lead has answered both open questions above. Capture the decision in this plan (edit the "Recommendation" lines to "Decided: …").

---

## Task 1 — Create `@ejm/shared-ui` package skeleton

**Files:**
- Create: `packages/shared-ui/package.json`
- Create: `packages/shared-ui/tsconfig.json`
- Create: `packages/shared-ui/src/index.ts`
- Create: `packages/shared-ui/src/components/index.ts`
- Create: `packages/shared-ui/src/forms/index.ts`
- Create: `packages/shared-ui/src/schedule/index.ts`
- Modify: `apps/web/package.json` (add dependency)

- [ ] **Step 1.1: Write `packages/shared-ui/package.json`**

```json
{
  "name": "@ejm/shared-ui",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts"
    },
    "./theme/base.css": "./src/theme/base.css",
    "./theme/sit.css": "./src/theme/sit.css",
    "./theme/study.css": "./src/theme/study.css"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "echo 'lint inherited from apps/web for now' && exit 0"
  },
  "peerDependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-i18next": "^17.0.0",
    "react-router": "^7.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-i18next": "^17.0.1",
    "react-router": "^7.13.2",
    "typescript": "~5.9.3"
  }
}
```

Notes:
- No `main`/`types` field — `exports.import` source-only (Vite + tsc-bundler-mode consume `.ts` directly, matching `@ejm/shared`'s pattern).
- `@ejm/shared-core` is added as a dependency in Task 7 (only schedule components need it).
- `lint` is a stub that exits 0 — wiring its own ESLint config is a follow-up; the apps/web lint pass still covers the re-export files.

- [ ] **Step 1.2: Write `packages/shared-ui/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

- [ ] **Step 1.3: Write empty barrels**

`packages/shared-ui/src/index.ts`:
```ts
export * from './components/index.js';
export * from './forms/index.js';
export * from './schedule/index.js';
```

`packages/shared-ui/src/components/index.ts`:
```ts
// Populated incrementally by Tasks 3–6. Intentionally empty for skeleton.
export {};
```

`packages/shared-ui/src/forms/index.ts`:
```ts
export {};
```

`packages/shared-ui/src/schedule/index.ts`:
```ts
export {};
```

- [ ] **Step 1.4: Add workspace dependency to `apps/web/package.json`**

Edit `apps/web/package.json` — add `"@ejm/shared-ui": "workspace:*"` to the `dependencies` block (alphabetically: between `@ejm/shared` and `@hookform/resolvers`).

- [ ] **Step 1.5: Install + verify resolution**

Run: `pnpm install`
Expected: no errors; new package linked.

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three exit 0. (Nothing imports from `@ejm/shared-ui` yet, so an empty barrel is fine.)

- [ ] **Step 1.6: Commit**

```bash
git add packages/shared-ui apps/web/package.json pnpm-lock.yaml docs/superpowers/plans/2026-05-18-shared-ui-extraction.md
git commit -m "feat(shared-ui): scaffold @ejm/shared-ui workspace package

Empty skeleton: package.json, tsconfig, three empty barrels, theme
directory placeholder. apps/web takes a workspace dep on @ejm/shared-ui
so subsequent extraction tasks can re-export through it.

Refs Phase 1 §8 Agent 2."
```

---

## Task 2 — Extract theme tokens

**Files:**
- Create: `packages/shared-ui/src/theme/base.css`
- Create: `packages/shared-ui/src/theme/sit.css`
- Create: `packages/shared-ui/src/theme/study.css`
- Modify: `apps/web/src/index.css`

- [ ] **Step 2.1: Write `packages/shared-ui/src/theme/base.css`**

Holds: font + radii + shadows + neutral/semantic colors. Brand red stays out (lives in `sit.css`).

> **Plan revision (during execution):** the original draft had `@import "tailwindcss"` inside this file, but Vite fails to resolve `tailwindcss` from `packages/shared-ui/src/theme/` because pnpm hoists `tailwindcss` under `apps/web/node_modules`. Fix: each app's entry CSS owns the `@import "tailwindcss"` — base.css contributes only `@theme` tokens + reset.

```css
/* ═══════════════════════════════════════════
   @ejm/shared-ui — BASE THEME TOKENS
   App-agnostic. Imported by both sync-sit and sync-study.

   NOTE: this file does NOT @import "tailwindcss" — each app's
   entry CSS owns that import (because Tailwind needs to resolve
   against the app's own node_modules under pnpm's hoisting).
   This file contributes only @theme tokens + reset.
   ═══════════════════════════════════════════ */

@theme {
  /* Semantic feedback colors (shared) */
  --color-green-600: #16A34A;
  --color-green-100: #DCFCE7;
  --color-amber-600: #D97706;
  --color-amber-100: #FEF3C7;
  --color-blue-600: #2563EB;
  --color-blue-100: #DBEAFE;

  /* Radii */
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.25rem;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);

  /* Font */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
}

/* Base reset */
html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 17px;
}

@media (min-width: 768px) {
  html {
    font-size: 16px;
  }
}

body {
  font-family: var(--font-sans);
}
```

- [ ] **Step 2.2: Write `packages/shared-ui/src/theme/sit.css`**

```css
/* ═══════════════════════════════════════════
   @ejm/shared-ui — sync-sit BRAND OVERRIDE
   Red accent family. Import alongside base.css.
   ═══════════════════════════════════════════ */

@theme {
  --color-red-600: rgb(223, 26, 48);
  --color-red-500: rgb(233, 64, 83);
  --color-red-100: rgb(252, 214, 219);
  --color-red-50: rgb(254, 238, 240);
}
```

- [ ] **Step 2.3: Write `packages/shared-ui/src/theme/study.css`**

```css
/* ═══════════════════════════════════════════
   @ejm/shared-ui — sync-study BRAND OVERRIDE
   Blue/teal accent family. Placeholder values —
   final palette will be ratified by design before
   sync-study UI work begins (Agent 5).
   ═══════════════════════════════════════════ */

@theme {
  --color-red-600: #0D9488;  /* teal-600 placeholder */
  --color-red-500: #14B8A6;  /* teal-500 placeholder */
  --color-red-100: #CCFBF1;  /* teal-100 placeholder */
  --color-red-50:  #F0FDFA;  /* teal-50 placeholder */
}
```

Note: keeping the variable names `--color-red-*` (rather than introducing `--color-brand-*`) means components don't need their `bg-red-600` classes rewritten. Tailwind 4 resolves `red-600` to whichever value the active `@theme` block sets. This is a deliberate, mechanical choice — a token rename is a separate refactor.

- [ ] **Step 2.4: Rewrite `apps/web/src/index.css`**

```css
@import "tailwindcss";
@import "@ejm/shared-ui/theme/base.css";
@import "@ejm/shared-ui/theme/sit.css";
```

That's the entire file. The `tailwindcss` import stays here (must resolve from apps/web's node_modules); all token content moved to the two imported sheets.

- [ ] **Step 2.5: Verify build + visual smoke**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three exit 0.

Run: `pnpm --filter web dev` in a background terminal, open `http://localhost:5173`, visually confirm:
- Font is Inter
- Red brand color appears on primary buttons / accents
- Card shadows render
- Mobile font-size bump still applies (resize window below 768px)

Stop dev server.

- [ ] **Step 2.6: Commit**

```bash
git add packages/shared-ui/src/theme apps/web/src/index.css
git commit -m "feat(shared-ui): extract theme tokens into base.css + sit.css + study.css

apps/web now imports @ejm/shared-ui/theme/base.css and sit.css instead
of holding the @theme block inline. study.css ships with teal
placeholders for sync-study; final palette ratified later.

No visual regressions in sync-sit (verified with pnpm --filter web dev)."
```

---

## Task 3 — Extract Tier-1 leaf components (no internal deps)

Components: `Spinner`, `Badge`, `Chip`, `Avatar`, `Checkbox`, `Icons`.

**Files per component (example: Spinner):**
- Create: `packages/shared-ui/src/components/Spinner.tsx` (copy of original)
- Modify: `apps/web/src/components/ui/Spinner.tsx` (becomes re-export)
- Modify: `packages/shared-ui/src/components/index.ts` (add export line)

- [ ] **Step 3.1: Copy `Spinner.tsx` into the package**

Run:
```bash
cp apps/web/src/components/ui/Spinner.tsx packages/shared-ui/src/components/Spinner.tsx
```

Verify file contents are byte-identical — no edits.

- [ ] **Step 3.2: Add export to `packages/shared-ui/src/components/index.ts`**

Append:
```ts
export { Spinner } from './Spinner.js';
```

(Use `.js` extension in import specifiers because `verbatimModuleSyntax: true` + bundler resolution accept either, and `.js` matches the published-package convention.)

- [ ] **Step 3.3: Replace original with re-export**

Overwrite `apps/web/src/components/ui/Spinner.tsx` with:
```ts
export { Spinner } from '@ejm/shared-ui';
```

- [ ] **Step 3.4: Verify**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three exit 0.

- [ ] **Step 3.5: Commit**

```bash
git add packages/shared-ui/src/components/Spinner.tsx \
        packages/shared-ui/src/components/index.ts \
        apps/web/src/components/ui/Spinner.tsx
git commit -m "feat(shared-ui): extract Spinner

Copy-then-re-export per §7. Original file now re-exports from @ejm/shared-ui."
```

- [ ] **Step 3.6: Repeat 3.1–3.5 for `Badge`**

Append to index: `export { Badge } from './Badge.js';`
Re-export file body: `export { Badge } from '@ejm/shared-ui';`

- [ ] **Step 3.7: Repeat 3.1–3.5 for `Chip`**

Append: `export { Chip } from './Chip.js';`
Re-export: `export { Chip } from '@ejm/shared-ui';`

- [ ] **Step 3.8: Repeat 3.1–3.5 for `Avatar`**

Append: `export { Avatar } from './Avatar.js';`
Re-export: `export { Avatar } from '@ejm/shared-ui';`

- [ ] **Step 3.9: Repeat 3.1–3.5 for `Checkbox`**

Append: `export { Checkbox } from './Checkbox.js';`
Re-export: `export { Checkbox } from '@ejm/shared-ui';`

- [ ] **Step 3.10: Repeat 3.1–3.5 for `Icons`**

`Icons.tsx` exports many named icons via individual `export function FooIcon(...)` statements. The barrel uses `export *`.

Append: `export * from './Icons.js';`
Re-export file body (`apps/web/src/components/ui/Icons.tsx`):
```ts
export * from '@ejm/shared-ui';
```

Then run typecheck. The risk: `export * from '@ejm/shared-ui'` re-exports everything the package barrel surfaces (currently Spinner, Badge, Chip, Avatar, Checkbox, plus all Icons). That's fine because existing consumers import icons by name (`import { ArrowLeftIcon } from '@/components/ui/Icons'`) — re-exporting extras is harmless, name collisions only matter if duplicated. Verify no consumer does `import * as Icons from '@/components/ui/Icons'`:

Run: `grep -rn "import \* as.*from '@/components/ui/Icons'" apps/web/src/`
Expected: no matches. (If any match, switch the re-export file to enumerate icons explicitly.)

Run typecheck + build + lint. Commit.

---

## Task 4 — Extract Tier-2 primitives (simple deps)

Components: `Button`, `Input`, `Textarea`, `Select`, `Card`, `InfoBanner`.

These are all self-contained (only React imports). Same copy-then-re-export pattern as Task 3.

- [ ] **Step 4.1: Extract `Button`**
  - Copy, add to barrel as `export { Button } from './Button.js';`
  - Re-export: `export { Button } from '@ejm/shared-ui';`
  - Verify + commit.

- [ ] **Step 4.2: Extract `Input`**
  - Copy, add to barrel as `export { Input } from './Input.js';`
  - Re-export: `export { Input } from '@ejm/shared-ui';`
  - Verify + commit.

- [ ] **Step 4.3: Extract `Textarea`**
  - Copy, add to barrel as `export { Textarea } from './Textarea.js';`
  - Re-export: `export { Textarea } from '@ejm/shared-ui';`
  - Verify + commit.

- [ ] **Step 4.4: Extract `Select`**
  - Copy, add to barrel as `export { Select } from './Select.js';`
  - Re-export: `export { Select } from '@ejm/shared-ui';`
  - Verify + commit.

- [ ] **Step 4.5: Extract `Card`**
  - Copy, add to barrel as `export { Card } from './Card.js';`
  - Re-export: `export { Card } from '@ejm/shared-ui';`
  - Verify + commit.

- [ ] **Step 4.6: Extract `InfoBanner`**
  - Copy, add to barrel as `export { InfoBanner } from './InfoBanner.js';`
  - Re-export: `export { InfoBanner } from '@ejm/shared-ui';`
  - Verify + commit.

---

## Task 5 — Extract composed components that depend only on Tier-1/2

Components in this task: `DateTag` (uses Badge), `LanguageSelector` (uses react-i18next), `PhotoLightbox` (uses Avatar), `TopNav` (uses Icons + react-router), `Dialog`, `StepIndicator`.

- [ ] **Step 5.1: Extract `DateTag`**

`DateTag.tsx` imports `import { Badge } from './Badge';`. The relative import works inside the package once we copy it. Copy, then keep the relative import as-is (`./Badge`).

- Copy: `cp apps/web/src/components/ui/DateTag.tsx packages/shared-ui/src/components/DateTag.tsx`
- Append to barrel: `export { DateTag } from './DateTag.js';`
- Re-export: `export { DateTag } from '@ejm/shared-ui';`
- Verify + commit.

- [ ] **Step 5.2: Extract `LanguageSelector`**

Imports only `react-i18next`. Copy, add to barrel, re-export, verify, commit.

Append: `export { LanguageSelector } from './LanguageSelector.js';`
Re-export: `export { LanguageSelector } from '@ejm/shared-ui';`

- [ ] **Step 5.3: Extract `PhotoLightbox`**

Imports `./Avatar` (relative — fine post-copy). Copy, add to barrel, re-export, verify, commit.

Append: `export { PhotoLightbox } from './PhotoLightbox.js';`
Re-export: `export { PhotoLightbox } from '@ejm/shared-ui';`

- [ ] **Step 5.4: Extract `TopNav`**

Imports `react-router` (peer dep — fine) and `./Icons` (relative). Copy, add to barrel, re-export, verify, commit.

Append: `export { TopNav } from './TopNav.js';`
Re-export: `export { TopNav } from '@ejm/shared-ui';`

- [ ] **Step 5.5: Extract `Dialog`**

Self-contained. Copy, add to barrel, re-export, verify, commit.

Append: `export { Dialog } from './Dialog.js';`
Re-export: `export { Dialog } from '@ejm/shared-ui';`

- [ ] **Step 5.6: Extract `StepIndicator`**

Self-contained (no imports beyond React types). Copy, add to barrel, re-export, verify, commit.

Append: `export { StepIndicator } from './StepIndicator.js';`
Re-export: `export { StepIndicator } from '@ejm/shared-ui';`

---

## Task 6 — Extract form components

Components: `PhoneInput` (self-contained), `CodeInput` (self-contained), `AddressAutocomplete` (self-contained — Google Maps loaded via window), `LanguagePicker` (uses Chip — already in shared-ui).

- [ ] **Step 6.1: Extract `PhoneInput`**

The Phase -1 rewrite (fully-controlled, no internal `useState`) must be preserved — verify the file already contains the comment block "PhoneInput is a fully controlled input" before copying. Do not change a line.

- Copy: `cp apps/web/src/components/forms/PhoneInput.tsx packages/shared-ui/src/forms/PhoneInput.tsx`
- Append to `packages/shared-ui/src/forms/index.ts`: `export { PhoneInput } from './PhoneInput.js';`
- Re-export `apps/web/src/components/forms/PhoneInput.tsx`:
  ```ts
  export { PhoneInput } from '@ejm/shared-ui';
  ```
- Run: `pnpm typecheck && pnpm build && pnpm lint`
- Run: `pnpm --filter web test -- PhoneInput`
  Expected: existing `PhoneInput.behavior.test.tsx` still passes (the test imports from `@/components/forms/PhoneInput`, which now re-exports).
- Commit.

- [ ] **Step 6.2: Extract `CodeInput`**

Self-contained. Copy, barrel-export as `export { CodeInput } from './CodeInput.js';`, re-export, verify + commit.

- [ ] **Step 6.3: Extract `AddressAutocomplete`**

Self-contained (Google Maps JS API accessed via `window.google`). Copy, barrel-export as `export { AddressAutocomplete, type AddressResult } from './AddressAutocomplete.js';` (must export the `AddressResult` type — multiple consumers import it).

Verify the type re-export by grepping after the change:
```bash
grep -rn "type AddressResult" apps/web/src/
```
Expected: all consumer imports still resolve.

Re-export file (`apps/web/src/components/forms/AddressAutocomplete.tsx`):
```ts
export { AddressAutocomplete, type AddressResult } from '@ejm/shared-ui';
```

Verify + commit.

- [ ] **Step 6.4: Extract `LanguagePicker`**

`LanguagePicker.tsx` imports `import { Chip } from '@/components/ui';` — that's an alias path that won't resolve inside `packages/shared-ui` (no `@/` alias configured there). Edit the copy to use a relative import to the in-package Chip.

- Copy: `cp apps/web/src/components/forms/LanguagePicker.tsx packages/shared-ui/src/forms/LanguagePicker.tsx`
- Edit `packages/shared-ui/src/forms/LanguagePicker.tsx` — replace:
  ```ts
  import { Chip } from '@/components/ui';
  ```
  with:
  ```ts
  import { Chip } from '../components/Chip.js';
  ```
- Append to `packages/shared-ui/src/forms/index.ts`: `export { LanguagePicker } from './LanguagePicker.js';`
- Re-export `apps/web/src/components/forms/LanguagePicker.tsx`:
  ```ts
  export { LanguagePicker } from '@ejm/shared-ui';
  ```
- Verify + commit.

---

## Task 7 — Extract schedule components (depends on @ejm/shared-core)

**Precondition:** Agent 1 has landed `slotIndexToTime`, `timeToSlotIndex`, `createEmptySlots`, `setSlotRange`, `DAYS_OF_WEEK`, `DayOfWeek`, and `ScheduleOverrideDoc` in `@ejm/shared-core` and they are exported from the package's `src/index.ts`. Verify before starting:

```bash
grep -E "slotIndexToTime|timeToSlotIndex|createEmptySlots|setSlotRange|DAYS_OF_WEEK|DayOfWeek|ScheduleOverrideDoc" packages/shared-core/src/index.ts
```

If any are missing, STOP and message team-lead — Agent 1 has work left.

- [ ] **Step 7.1: Add `@ejm/shared-core` dependency to `packages/shared-ui/package.json`**

Edit `dependencies` block (add one — there's no `dependencies` block yet):
```json
"dependencies": {
  "@ejm/shared-core": "workspace:*"
}
```

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 7.2: Extract `WeeklyTimeline`**

Source imports: `@ejm/shared` (DAYS_OF_WEEK, slotIndexToTime, DayOfWeek), `@/components/ui` (Dialog, Button, Select). Rewrite both.

- Copy: `cp apps/web/src/components/schedule/WeeklyTimeline.tsx packages/shared-ui/src/schedule/WeeklyTimeline.tsx`
- Edit `packages/shared-ui/src/schedule/WeeklyTimeline.tsx`:
  - Replace `from '@ejm/shared'` (both runtime and type-only imports) with `from '@ejm/shared-core'`.
  - Replace `from '@/components/ui'` with `from '../components/index.js'`.
- Append to `packages/shared-ui/src/schedule/index.ts`: `export { WeeklyTimeline } from './WeeklyTimeline.js';`
- Re-export `apps/web/src/components/schedule/WeeklyTimeline.tsx`:
  ```ts
  export { WeeklyTimeline } from '@ejm/shared-ui';
  ```
  (If the original file exports types — verify with `grep "^export" apps/web/src/components/schedule/WeeklyTimeline.tsx` before overwriting — list them in the same re-export line, e.g. `export { WeeklyTimeline, type WeeklyTimelineProps } from '@ejm/shared-ui';`.)
- Verify + commit.

- [ ] **Step 7.3: Extract `DayEditor`**

Same shape as 7.2. Source imports: `@ejm/shared` (createEmptySlots, setSlotRange, slotIndexToTime, timeToSlotIndex, DayOfWeek), `@/components/ui` (Dialog, Button, Select).

- Copy, edit imports as in 7.2.
- Append: `export { DayEditor } from './DayEditor.js';`
- Re-export.
- Verify + commit.

- [ ] **Step 7.4: Extract `OverrideList`**

Source imports: `@ejm/shared` (slotIndexToTime, timeToSlotIndex, setSlotRange, createEmptySlots, ScheduleOverrideDoc), `@/components/ui` (Card, Button, Dialog, Input, Select), `@/components/ui/Icons` (XIcon, PlusIcon, CalendarIcon).

- Copy, then:
  - `from '@ejm/shared'` → `from '@ejm/shared-core'`
  - `from '@/components/ui'` → `from '../components/index.js'`
  - `from '@/components/ui/Icons'` → `from '../components/Icons.js'`
- Append: `export { OverrideList } from './OverrideList.js';`
- Re-export.
- Verify + commit.

---

## Task 8 — Update the apps/web UI barrel and final cleanup

**Files:**
- Modify: `apps/web/src/components/ui/index.ts`

After Tasks 3–5, the per-file re-exports already make `import { Button } from '@/components/ui/Button'` work via shared-ui. But many consumers use the barrel — `import { Button, Card } from '@/components/ui'`. The barrel currently re-exports from local files, which now re-export from shared-ui. That double indirection works but is wasteful and noisy.

- [ ] **Step 8.1: Rewrite the UI barrel to import directly from `@ejm/shared-ui`**

Replace `apps/web/src/components/ui/index.ts` with:

```ts
// Curated re-exports for sync-sit. Shared primitives come from @ejm/shared-ui;
// sync-sit-specific UI stays local.
export {
  Button,
  Input,
  Textarea,
  Select,
  Card,
  Badge,
  Chip,
  Dialog,
  Spinner,
  StepIndicator,
  Avatar,
  InfoBanner,
  TopNav,
  LanguageSelector,
  Checkbox,
  DateTag,
  PhotoLightbox,
} from '@ejm/shared-ui';
export * from '@ejm/shared-ui'; // Icons (export *) + any future additions

// sync-sit-only components — NOT extracted to shared-ui:
export { InstallAppBanner } from './InstallAppBanner';
```

Note: if AppBar/EnrollmentAppBar/PushPrompt are deferred per Q1, they were never in the barrel (correctly — current barrel doesn't export them; consumers import them directly via `@/components/ui/AppBar` etc.). So the barrel needs no entries for them.

- [ ] **Step 8.2: Verify barrel is exhaustive**

Run:
```bash
grep -rn "from '@/components/ui'" apps/web/src/ | grep -oE "\{[^}]+\}" | tr ',' '\n' | sed 's/[{} ]//g' | sort -u
```

Expected output should be a subset of the names exported in Step 8.1. Any name missing → add it.

- [ ] **Step 8.3: Full verify**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: all three exit 0.

Run: `pnpm --filter web test`
Expected: all tests pass.

- [ ] **Step 8.4: Commit**

```bash
git add apps/web/src/components/ui/index.ts
git commit -m "refactor(web): point UI barrel directly at @ejm/shared-ui

Drop the double-indirection (barrel → per-file re-export → package).
sync-sit-only components (InstallAppBanner) stay local."
```

---

## Task 9 — Final visual smoke test and completion report

- [ ] **Step 9.1: Full clean build**

Run:
```bash
pnpm install
pnpm typecheck && pnpm build && pnpm lint
pnpm --filter web test
```
Expected: every command exits 0.

- [ ] **Step 9.2: Browser smoke test**

Run: `pnpm --filter web dev` (background terminal).

In browser at `http://localhost:5173`, walk these flows and confirm no visual regressions:

1. **Public welcome** (`/`) — brand red, button styles, language selector menu, font.
2. **Babysitter login** — Input components, Button, error banners.
3. **Family enrollment, Step 1** — StepIndicator, Card, Input, Button.
4. **Family enrollment, Step 2 (kids)** — LanguagePicker chips, PhoneInput, AddressAutocomplete.
5. **Family enrollment, Step 3 (parent verify)** — CodeInput grid.
6. **Family dashboard** — Card grid, Spinner during load, InstallAppBanner shows for non-PWA, Dialog open/close.
7. **Family settings → Schedule** — WeeklyTimeline render, DayEditor open + slot drag, OverrideList add + remove.
8. **Family search** — DateTag badge, Avatar fallback initials, PhotoLightbox lightbox on click.

Stop dev server. Capture any visual mismatch with a screenshot path in the completion report.

- [ ] **Step 9.3: Verify §8 "Done when" criteria**

For each criterion, confirm in writing:
- [x] All reusable components live in `packages/shared-ui/`. (16 ui + 4 forms + 3 schedule = 23 components; AppBar/EnrollmentAppBar/PushPrompt deferred per Q1.)
- [x] `apps/web/src/components/ui/index.ts` re-exports from `@ejm/shared-ui`.
- [x] sync-sit renders correctly with no visual regressions (verified Step 9.2).

- [ ] **Step 9.4: Send completion report to team-lead**

SendMessage to team-lead with:
- Branch: `feature/sync-study-shared-ui`
- Final SHA: (output of `git rev-parse HEAD`)
- File counts: components, theme files, modified-in-apps/web
- Verification: pnpm typecheck/build/lint/test all green; manual smoke walked (list the 8 flows)
- Done-when met: 3 of 3
- Risks / deferred: AppBar/EnrollmentAppBar/PushPrompt deferred per Q1 (link to plan); study.css placeholder palette pending design ratification.

- [ ] **Step 9.5: Mark Phase 1 task #19 ready for triple gate**

Per existing task list, task #20 ("triple gate after agents 1 + 2 commit") is the next coordinator step. No action from this plan — the completion-report message signals readiness.

---

## Self-Review

**Spec coverage (against §8 brief):**
- §8 Task 1 (package shell): Task 1. ✓
- §8 Task 2 (theme split): Task 2. ✓
- §8 Task 3 (16 UI components, Tier 1/2/3): Tasks 3, 4, 5 — but AppBar/EnrollmentAppBar/PushPrompt deferred per Q1 (13 of 16 extracted; gap explicitly raised for team-lead decision).
- §8 Task 4 (4 form components): Task 6. ✓
- §8 Task 5 (3 schedule components): Task 7. ✓
- §8 Task 6 (replace originals with re-exports): every extraction step does it. ✓
- §8 verification (typecheck+build per component + visual smoke at end): every commit step + Task 9. ✓
- §8 Done-when (all reusable in shared-ui, barrel re-exports, no visual regression): Task 9.3. ✓ (with documented gap).

**Placeholder scan:** no "TBD"/"TODO"/"similar to Task N"/"add validation" found. Every step has exact code or exact commands. study.css's "placeholder palette" is content (intentional choice, documented), not a plan placeholder.

**Type consistency:**
- `AddressResult` type is re-exported in Step 6.3. ✓
- `DayOfWeek` and `ScheduleOverrideDoc` types are imported via `@ejm/shared-core` in Task 7. ✓
- Re-export specifier style is consistent: `'@ejm/shared-ui'` everywhere; `.js` extension on relative imports inside the package everywhere; `from '../components/index.js'` from forms/schedule into components. ✓

No issues found.

---

## Execution handoff

Inline execution via `superpowers:executing-plans`. agent-2-shared-ui runs all tasks sequentially in this worktree; team-lead reviews at the completion-report checkpoint (Step 9.4). No subagent dispatch — the `pnpm install && pnpm typecheck && pnpm build` cycle per task makes fresh-subagent overhead prohibitive (each cold subagent re-walks the workspace install).
