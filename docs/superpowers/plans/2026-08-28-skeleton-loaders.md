# Skeleton loaders on the main list pages (UX F12, issue #126)

## Goal

Every list load was a centered spinner: zero footprint while loading, then
the full list lands and the layout jumps. F12's fix: one `SkeletonCard` in
shared-ui, used by the six main list pages, sized like the real cards so the
list area keeps (approximately) its loaded footprint from first paint.
Spinners stay for buttons and inline actions — a skeleton stands in for
CONTENT; a spinner reports an ACTION in flight.

## The component

`packages/shared-ui/src/components/SkeletonCard.tsx`, exported from the
barrel (and re-exported by sit's curated `@/components/ui` barrel — now 18
shared names).

- Card idiom: same `rounded-lg border border-gray-200 bg-white p-4` frame as
  `<Card>`, holding grey bars (`bg-gray-200`) at varied widths so a stack of
  them reads as rows, not stripes.
- Props: `lines?: number` (default 3) and `avatar?: boolean`, which prepends
  an `h-12 w-12` circle — the md `<Avatar>` size — for lists whose rows lead
  with one (study search results / TutorCard).
- Reduced motion: the pulse is `motion-safe:animate-pulse`, so a
  `prefers-reduced-motion` user gets a static placeholder. This sits on top
  of base.css's global animation collapse; the guard class keeps the
  component correct even where that stylesheet isn't loaded.
- `aria-hidden="true"`: the placeholder is decorative; assistive tech should
  hear the page's real states, not a fake card. `data-testid="skeleton-card"`
  is the test hook.

Each converted page renders 2-3 of them in a `space-y-3` stack — the same
gap the loaded lists use — rather than the component guessing a count.

## The six converted pages

| # | Page | Was | Now |
|---|------|-----|-----|
| 1 | sit `family/AppointmentsPage` | centered spinner over the whole list area | 3 SkeletonCards |
| 2 | sit `babysitter/DashboardPage` (appointments inbox) | centered spinner | 3 SkeletonCards |
| 3 | study `family/SessionsPage` | centered spinner | 3 SkeletonCards |
| 4 | study `tutor/SessionsPage` | centered spinner | 3 SkeletonCards |
| 5 | study `tutor/RequestsPage` | centered spinner | 2 SkeletonCards |
| 6 | study `family/SearchPage` (results area) | centered spinner | 3 SkeletonCards with `avatar` (rows are TutorCards led by an Avatar) |

Two substitutions vs the issue's initial guess, both consequences of newer
work:

- **sit `family/DashboardPage` is NOT converted.** The appointment list moved
  to the dedicated `family/AppointmentsPage` (issue #241, PR #256); the
  dashboard's remaining spinner guards a single summary-card link, not a
  list. `AppointmentsPage` — where the list actually lives now — is
  conversion #1.
- **sit `family/SearchPage` needs no conversion.** Its results arrive from
  the search callable behind the submit button, whose label already switches
  to "Searching…" (a button state, which F12 keeps); the page renders no
  list-area spinner at all.

## Spinners deliberately kept

- **Buttons and inline actions, everywhere** — submit/confirm buttons,
  `AppSwitchMenuItem`, study's `RecurringConflictPreview` availability check.
  Explicitly in-scope for staying (issue text).
- **Auth/route gates** — sit `AuthGuard`, study `FamilyLayout` /
  `TutorLayout` / `PublicLayout`. Nothing about the destination page's shape
  is known yet, so there is no footprint to preserve; a skeleton here would
  be a guess that then jumps anyway.
- **Full-page handoff/redirect states** — `HandoffPage`,
  `CrossAppWelcomePage`, `SharePage`, enrollment `JoinFamilyPage`. Same
  argument: transitional whole-screen states, not lists.
- **Secondary / non-list loads** — sit `family/DashboardPage` (summary card,
  see above), `NotificationsPage` (both apps), verification, governance,
  endorsements, schedule, invite, preferred-babysitters, families,
  book-session and detail pages, and study `family/RequestsPage` (secondary
  inbox; its primary twin, tutor `RequestsPage`, is converted). These load
  small or heterogeneous content where the jump F12 targets is minor; any
  that prove annoying can adopt `SkeletonCard` in a follow-up — the
  component is shared and the pattern is now established.
- **Admin pages** (sit `admin/*`) — internal tooling, out of F12's scope
  (the review covered the member-facing apps).

*Addendum (2026-08-29, #338):* the sit `family/DashboardPage` exclusion no
longer holds — its premise was that the page showed "a summary card, not a
list", and #338 replaced that card with the provider dashboards' collapsible
row sections. Both family dashboards are list surfaces now and both render
`SkeletonCard`s; study's `family/DashboardPage` joins them for the same
reason. Study's `family/RequestsPage` stays excluded on its own merits (it is
still the secondary inbox).

## Tests

- `apps/study-web/src/__tests__/shared-ui/SkeletonCard.test.tsx` — bar count
  (default 3, `lines` respected), avatar variant, Card idiom classes,
  `motion-safe:animate-pulse` guard (and NOT the unguarded utility),
  `aria-hidden`.
- Per-page pins (all six): skeletons render while the load is in flight
  (data read held open via deferred promise / withheld first snapshot), no
  `.animate-spin` in the list area, no premature empty state; skeletons
  disappear once data lands. Sit babysitter dashboard gets a new
  `DashboardPage.loading.test.tsx` (harness mirrors the lateWarn twin);
  the other five extend their existing page test files.
