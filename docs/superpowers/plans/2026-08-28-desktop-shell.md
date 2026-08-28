# Desktop shell — width caps + persistent nav at `md+` (issue #119, UX F5)

## Goal

Both apps render a phone shell at every width: unconstrained single column +
burger-only nav. Per the issue's elaboration (owner spec), this is a **pure
layout pass** — no data changes, no new routes, no behavior:

1. **Content width caps.** Default reading/form cap `max-w-2xl mx-auto` applied
   centrally in the 5 portal layouts; grid/table pages opt into a wider
   `max-w-5xl` tier.
2. **Persistent nav at `md+`.** Burger items promoted to top tabs
   (tutor/family/babysitter portals) and a grouped sidebar (admin — 10
   destinations, grouped People / Trust & safety / Operations per the #140
   dashboard regrouping). Burger unchanged below `md`.

## Where the width assumption lives (verified)

- Shells are centralized in 5 layout files, all `AppBar + <Outlet/>` with no
  container: `apps/study-web/src/layouts/{TutorLayout,FamilyLayout}.tsx`,
  `apps/web/src/layouts/{AdminLayout,BabysitterLayout,FamilyLayout}.tsx`.
- Pages own their padding (`px-5 …` on the page root); only a handful set any
  `max-w` (6 of ~20 in study, 8 of ~30 in sit, mostly enrollment).
- Chrome is intentionally duplicated per portal: sit `AppBar` (one component,
  3 roles), study `AppBar` (tutor) + `FamilyAppBar`. All are a sticky
  `h-12 bg-brand-600` bar + burger `Dialog`.
- No `fixed bottom-*` full-bleed page elements exist; no page uses
  `matchMedia` for layout. Tailwind is v4 (CSS-first config, brand tokens in
  `packages/shared-ui/src/theme/{base,sit,study}.css`).

## Mechanism

### Width cap: layout-level container + CSS `:has()` opt-in

New shared-ui `PageContainer` used by each portal layout to wrap `<Outlet/>`:

```
mx-auto w-full max-w-2xl has-[[data-page-width=wide]]:max-w-5xl
```

- Default cap is inert below 672px, so **phone rendering is untouched by
  construction** — no `md:` prefix needed.
- A page opts into the wide tier by putting `data-page-width="wide"` on its
  root element. Pure CSS (`:has()`, baseline since 2023), no context, no
  double render, no flash; jsdom tests pin the attribute and the container
  classes (viewport-conditional *render* pins are unnecessary because the
  responsive behavior is class-driven, which is exactly what makes the
  existing burger-interaction tests keep passing unmodified).

### Persistent nav: two shared-ui primitives, per-portal link lists

- `NavTabs` (`hidden md:block sticky top-12 z-30`, white row, bottom border,
  `NavLink` active state = brand-600 underline + text): rendered by each
  portal AppBar directly under the sticky bar. Items = **the same primary
  link list the burger renders** ("same link list, two renderings" per the
  issue) — including the endorsements badge in study tutor. Row content
  centered under the same `max-w-5xl` cap; `overflow-x-auto` guard for the
  8-item sit-family list at exactly-`md` widths.
- `SideNav` (`hidden md:block`, grouped sections, uppercase xs gray-500
  section headers matching the admin dashboard idiom, active item
  `bg-brand-50 text-brand-600`): rendered by `AdminLayout` as a flex-row
  sibling of the content (`md:flex` on the shell; content `flex-1 min-w-0`).
  Sections/items = the 10 destinations exactly as grouped on the admin
  dashboard (People / Trust & safety / Operations), Dashboard link on top.
- **The burger stays at all widths.** At `md+` it still holds the secondary
  items (about, privacy, terms, share, app switch, language, feedback, sign
  out) and the user identity header; primary items remain in it too — the
  dialog is "same link list, two renderings", and pruning items per
  breakpoint inside a modal buys nothing while churning every burger test.
  This is the one deliberate softening of "keeping the burger below md" and
  is called out in each PR body.

### Wide-tier page pass

Wide (`data-page-width="wide"`), decided page-by-page against the actual
markup (grid/table-shaped only): the admin DataTable pages (Users, Families,
Appointments, AuditLog), the study family dashboard (the #142 2-col tile
grid), and both schedule pages (weekly timeline grids). Pages examined and
deliberately KEPT at the reading cap: both search pages (single-column
result lists, no grid), the sit dashboards and admin dashboard (card
columns, no tile grid), and every admin form/queue/config page —
forms and prose are the surfaces the issue calls out as worst-hit.

## Parity

Both apps get identical mechanisms and idioms (shared-ui primitives, same
classes, same tier semantics). The only per-app divergence is the admin
sidebar — sit-only because study has no admin portal (stated in PR body).

## PR split (per the issue: three PRs, each independently green)

1. **PR A — shared-ui primitives + study shell** (`feature/desktop-shell`):
   `PageContainer` and `NavTabs` in `packages/shared-ui` (+ exports; `SideNav`
   ships with PR C where it is first used, to keep PR A free of dead code);
   study `TutorLayout`/`FamilyLayout` adopt `PageContainer`; study `AppBar` /
   `FamilyAppBar` extract their primary link list to an array consumed by
   both the burger dialog and a new `NavTabs` row; wide-tier pass on study
   pages; tests (shared-ui tests live in
   `apps/study-web/src/__tests__/shared-ui/` per existing idiom).
2. **PR B — sit non-admin shell** (stacked on A): sit `FamilyLayout` +
   `BabysitterLayout` adopt `PageContainer`; sit `AppBar` gains role-keyed
   primary link arrays + `NavTabs` for parent/babysitter; wide-tier pass on
   sit non-admin pages.
3. **PR C — sit admin shell** (stacked on B): `AdminLayout` gains
   `PageContainer` + `SideNav` flex-row shell; admin wide-tier pass; sit
   `AppBar` renders no tabs for the admin role (sidebar owns primary nav).

## Out of scope (per issue: 5 portal shells)

PublicLayout / enrollment flows (already `max-w`-capped where it matters),
`docs/ux-f5-evidence` branch untouched.

## Task list

- [x] PR A (#288): PageContainer + NavTabs + study adoption + tests
- [x] PR B (#289): sit non-admin adoption + tests
- [x] PR C (#290): SideNav + sit admin adoption + tests
- [x] Gates per push: web+study-web+shared-ui `tsc -p tsconfig.app.json
      --noEmit`; both apps' full vitest suites with honest exit codes
- [ ] Screenshots: parent session captures (list in report)
- [ ] Follow-up: name the remaining ~70 Dialog call sites (ariaLabel) to opt
      them into the modal semantics the #288 review added
