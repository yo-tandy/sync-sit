# Study role guides for tutors and parents (issue #236, parity A3)

## Goal

Sit ships public how-to guide routes (`/guide/babysitters`, `/guide/parents`)
linked from its About page; study has none. Adopt the sit pattern in
apps/study-web: add `/guide/tutors` and `/guide/parents` with study-specific
copy in both locales, linked from the same surface sit links its guides.

## Where sit links its guides (verified by grep)

`grep -rn "guide/" apps/web/src` → exactly three files:

- `apps/web/src/router.tsx` — routes registered in the `PublicLayout` branch.
- `apps/web/src/pages/public/AboutPage.tsx` — a "How-to Guides" section with
  Parent Guide + Babysitter Guide + Install cards, placed between Safety and
  the sibling-app card.
- `apps/web/src/pages/public/__tests__/AboutPage.test.tsx` — asserts the two
  guide links' hrefs.

No other surface (enrollment, dashboards, emails) links them, so the About
page is the one surface to mirror.

## Flow facts the copy must respect (verified against code on origin/main)

- **Contact approval unlocks the relationship.** A verified family sends a
  contact request for one subject+level (`sendTutorContactRequest`); the tutor
  accepts or declines (`respondToTutorContactRequest`). Accepting adds the
  family to `profiles.tutor.approvedFamilies` and unlocks the tutor's contact
  details (email/phone/WhatsApp — `searchTutors` returns them only for
  approved families). There is no revoke path.
- **7-day decline cooldown.** `DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000`
  in `sendTutorContactRequest.ts`; keyed on `declined` only.
- **Withdrawal belongs to whoever opened a request.**
  - A family withdraws its own pending contact request
    (`cancelContactRequest`) — family-initiated, does NOT start the cooldown.
  - A tutor withdraws their own pending session proposal (tutor
    SessionsPage `withdrawProposal` flow).
  - A family cancels its own pending session request (family SessionsPage).
- **Sessions are booked inside the relationship.** `bookSession` requires an
  accepted contact request; one-time or weekly recurring; 24h notice
  (`NOTICE_HOURS = 24`); the per-subject rate is snapshotted server-side; a
  pending request is a proposal and claims no schedule slots until the tutor
  confirms. `proposeSession` is the tutor-side mirror (family confirms and
  picks the students). `cancelSession`: either party, any time, with a reason.
- **Cancellation notice policy.** The tutor's notice window is set on the
  Schedule page and snapshotted per session; late cancellations are flagged,
  not blocked (`cancellationPolicy.ts`).
- **Tutor visibility.** `profiles.tutor.searchable` defaults to false; the
  dashboard toggle makes the profile visible.
- **Enrollment.** Tutor: EJM email → code → password → profile+contact →
  subjects (levels + per-subject rate). Family: parent signup, kids +
  addresses in Family Settings, verification (EJM email or community
  vouching) gates search.

## Changes

1. `apps/study-web/src/pages/public/TutorGuidePage.tsx` — new; mirrors sit's
   `BabysitterGuidePage` structure (TopNav + numbered `Step`s, inline en/fr
   ternaries keyed off `i18n.language`, same section layout).
2. `apps/study-web/src/pages/public/ParentGuidePage.tsx` — new; mirrors sit's
   `ParentGuidePage` the same way.
3. `apps/study-web/src/lazyPages.ts` — lazy exports for both (study routes are
   code-split, unlike sit's eager imports — follow study's own convention).
4. `apps/study-web/src/router.tsx` — `/guide/tutors` + `/guide/parents` in the
   `PublicLayout` children (before the `*` catch-all).
5. `apps/study-web/src/pages/public/AboutPage.tsx` — "How-to Guides" section
   mirroring sit's placement (between Safety and the sibling-app card), with
   the existing Install card folded into it exactly as sit has it.

No backend changes. No new i18n keys (sit's guide pages use inline locale
ternaries; both locales ship in the page).

## Tests

- `TutorGuidePage.test.tsx` / `ParentGuidePage.test.tsx` — render in en and
  fr (headings + core-flow copy present in each locale; no raw i18n-key
  fallbacks), key flow facts asserted (7-day cooldown, contact unlock).
- `router.public.test.ts` — the two guide paths are registered in the same
  (guard-free `PublicLayout`) branch as `/login`, not under the tutor/family
  layouts. Sit has no such test (grep), so this is new, matching the issue's
  requirement that the routes be provably public.
- `AboutPage.test.tsx` — extended: guide links present with correct hrefs
  (mirrors sit's AboutPage test).

Gates: `pnpm exec vitest run` + `pnpm exec tsc --noEmit` in apps/study-web;
lint if it passes on main (issue #246 tracks a pre-existing failure).
