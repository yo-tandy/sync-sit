# Flow & UI Parity — Proposed Issues

Companion to `docs/flows-sit-vs-study.pdf` (flows) and `docs/ui-sit-vs-study.pdf`
(screens, captured live 2026-08-27). Goal: converge the two apps so that every flow
and screen is either **deliberately shared** or **deliberately different for a
documented domain reason** — nothing different by accident.

**Decision rule** (owner-set): Sync/Sit is production-verified, so its flow wins by
default. Sync/Study's shape is adopted only where it has a clear, large advantage.
Anything genuinely debatable was listed as a **question**.

**Status (2026-08-27): DECIDED AND OPENED.** The owner answered Q1–Q5
(Q1=b, Q2=a, Q3=a, Q4=leave as-is, Q5=b) and every actionable item now has an
issue: A1 #234 · A2 #235 · A3 #236 · B1 #237 · B2 #238 · D1 #239 · D2 #240 ·
Q1(b) #241 · Q5(b) #242. A4 stays inside #168; the UI defects #226/#227/#228
were opened earlier and are fixed by PRs #229/#231/#230.

Every claim below was verified against the code on 2026-08-27 (branch: main + PR #223),
not taken from the comparison PDF. Where a gap is already tracked, the existing issue
is referenced instead of duplicated.

---

## A. Ready to open — bring Study up to Sit

### A1 · Study: session modification with acknowledgement — **opened as #234**
Sit changes a booking via `modifyAppointment` + `acknowledgeModification` — the other
side must *see* the change. Study has **no session modification at all**: the only
paths are cancel-and-rebook (`cancelSession` / `cancelSessionInstance` / `bookSession`).
`sessionOverride.ts` is the availability ledger, not a modification flow — verified.

- **Direction:** adopt Sit. A time/location change to a confirmed session should be a
  `modifySession` + acknowledgement, not a cancel that (a) burns the relationship's
  history, (b) can trip the late-cancellation flag on an innocent reschedule.
- **Scope:** `modifySession` callable (times, location pref, rate), `modificationAcknowledged`
  flag + acknowledge callable, UI on both sessions pages, notification type + routing rows.
- **Interacts with:** the late-cancellation flag (a modify must not count as a cancel).

### A2 · Study: direct tutor lookup by personal code — **opened as #235**
Sit families can add a babysitter they already know via `lookupBabysitter` (personal
code, searchable-gated). Study has no equivalent — verified (`lookupTutor` /
`personalCode`: zero hits in study). A family whose tutor was found offline cannot
connect without the tutor appearing in search.

- **Direction:** adopt Sit. Same gate: code resolves only if the tutor is `searchable`;
  resolving a code mints the normal contact request, never a bypass of the
  `approvedFamilies` unlock.
- **Scope:** `lookupTutor` callable, code display on tutor account page, entry point on
  family search page.

### A3 · Study: role guides — **opened as #236**
Sit ships `/guide/babysitters` and `/guide/parents`. Study has **no guide routes** —
verified. New tutors and study-side parents get no onboarding reference at all, in the
app whose two-stage request flow needs more explaining than sit's.

- **Direction:** adopt Sit. `/guide/tutors` + `/guide/parents` (study copy), linked from
  the same places sit links its guides.
- **Scope:** content + two public routes; no backend.

### A4 · Study: push notification client
Sit's web push is live; study-web's PWA manifest exists but the push client
(VAPID key, foreground/background handlers, prompt) is pending owner decisions.
- **Direction:** adopt Sit. **Already tracked as #168 (phase 2)** — do not open a
  duplicate; this list just records it as the known remaining notification gap,
  together with recipient-affinity push routing and per-app prefs from the same issue.

---

## B. Study has the advantage — adopt into Sit (flagged per the decision rule)

These reverse the default direction, so each carries its "big advantage" argument
explicitly. If the argument does not convince, they become questions.

### B1 · Sit: cancellation policies on appointments — **opened as #237**
**Correction to the comparison doc's framing:** the notice-window / late-cancellation
system is **study-only** — tutors declare a policy (shown on `TutorCard`), cancels
inside the window are allowed but flagged (`lateCancellation: true` on
`cancelSession` / `cancelSessionInstance`). Sit appointments have **none of this** —
verified (`lateCancel|noticeWindow|cancellationPolicy`: zero hits in `apps/functions`
+ `apps/web`).

- **Advantage claim:** late family cancellations cost sitters income exactly as they
  cost tutors; the allow-but-flag design was reviewed and shipped, and the snapshot
  principle (policy captured at booking time) transfers unchanged.
- **Direction:** adopt Study into Sit — babysitter declares a notice window, shown on
  the search card; `cancelAppointment` flags late cancels.

### B2 · Sit: appointment notes — **opened as #238**
Study has per-session notes (`setSessionNote`, V1.1). Sit has no appointment notes —
verified. Sitting logistics (door codes, bedtime, allergies) are at least as
note-worthy as tutoring topics.

- **Advantage claim:** small feature, shipped and settled in study, with obvious sit
  demand.
- **Direction:** adopt Study into Sit — `setAppointmentNote` with the same
  visibility rules.

---

## C. Questions — your call before anything is opened

### Q1 · Should Sit families get dedicated Requests/Sessions pages? — **DECIDED: (b), opened as #241, landed in PR #256**
Study gives families `/family/requests` and `/family/sessions` as first-class pages;
sit embedded appointments in the family dashboard until #256 added
`/family/appointments` (the dashboard keeps a summary card). Sit's dashboard-centric layout is the production-verified one; study's
dedicated pages scale better as volume grows.
**Options:** (a) keep each app as-is and declare it deliberate · (b) add
`/family/appointments` to sit mirroring study's page shape · (c) fold study's pages
into its dashboard to match sit. My read: (b) if sit families ever have >3 concurrent
appointments, else (a).

### Q2 · Preferred tutors list? — **DECIDED: (a) deliberate, no issue**
Sit has a family-curated preferred-babysitters list (independent of any request).
Study's `approvedFamilies` requires a mutual accept, so there is no way to bookmark a
tutor you have not contacted yet.
**Options:** (a) deliberate — the relationship model replaces bookmarking · (b) add a
lightweight preferred-tutors list (client-side, rules-gated, no contact unlock).
My read: (a); a bookmark that reveals nothing is close to worthless in a two-stage flow,
but you know the families' habits better.

### Q3 · Babysitter-initiated bookings? — **DECIDED: (a) sit stays unidirectional, no issue**
Study is bidirectional (`proposeSession` shipped in V1.1). Sit sittings are
family-initiated only. A sitter proposing "I could come Thursday" to a family they
have sat for before is plausible — but it changes sit's production-verified contract.
**Options:** (a) keep sit unidirectional (deliberate) · (b) port proposals to sit for
returning families only. My read: (a) for now; revisit with usage data from study's
proposal uptake.

### Q4 · Contact-sharing consent vs relationship unlock — **DECIDED: leave as-is, no issue**
Sit reveals parent contacts through a per-appointment consent
(`respondToContactSharing`); study reveals through the standing relationship. These are
the §5 core divergence in the comparison doc and I recommend **no issue** — but flagging
it here because it is the one asymmetry a user will actually *feel* when using both
apps, so it deserves an explicit "deliberate, will not converge" decision from you
rather than silence.

### Q5 · Enrollment success page — **DECIDED: (b), opened as #242**
RESOLVED by #242 / PR #257 (owner picked option b): study's
`/enroll/tutor/success` removed; both apps now end enrollment on the
dashboard, with a redirect kept for stale links and a guarded-navigation
fallback for best-effort sign-in trouble.

---

## D. UI parity — from the screenshot comparison

The UI capture (`ui-sit-vs-study.pdf`) split its findings into **defects** (opened
immediately — a bug is a bug) and **differences** (parity items, listed here under
the same sit-first rule).

### Opened as defects

- **#226 — published-searches widget: Withdraw overlaps the squeezed title/date
  column at 390px.** Both apps, one shared component (UI doc §3, Finding 2).
- **#227 — availability grid clips the Sunday column at 390px, no scroll
  affordance.** Both apps, one shared component (UI doc §9, Finding 3).
- **#228 — TutorCard renders a dangling "€/h" and a trailing "·" separator when
  optional fields are absent.** Study only; surfaced by the same capture (UI doc
  §4, Finding 4).

(The capture's Finding 1 — the stranded PR #212 — is a delivery failure, not a UI
issue; recovered by PR #224.)

### D1 · Unify the dashboard greeting/header idiom — **opened as #239**
Sit greets "Hello, Marie 👋" with a context subtitle ("DUPONT family"); study greets
"Hello Claire" with neither comma, wave, nor subtitle (UI doc §2/§7 — the provider
dashboards drift the same way).

- **Direction:** adopt Sit. One shared greeting header (name idiom + role/family
  context line) in shared-ui, consumed by all four dashboards.
- **Scope:** small; copy + one component, four call sites.

### D2 · Unify person-name presentation on provider cards — **opened as #240**
Sit's result cards print "Lea BERNARD" (Firstname SURNAME, the French form
convention); study's cards print "Camille Moreau" (title case) — verified in the
capture, both apps disclose full surnames pre-approval, so this is pure formatting
drift with no privacy rationale behind it (UI doc §4).

- **Direction:** adopt Sit's convention (production-verified default); a small
  shared name formatter consumed by both card sets.
- **Scope:** the two card components plus a formatter in shared-ui.

### Cross-references into existing items

- **Q1 (dedicated family pages vs dashboard)** now has visual evidence: UI doc §2
  shows sit content-first vs study tile-hub side by side.
- The search **entry** difference (sit two-step wizard vs study single form, UI doc
  §3) is *not* proposed for convergence: the wizard exists because sit must choose
  one-time vs recurring before the form makes sense; study has no type split. Added
  to the deliberate list below.

## Explicitly *not* proposed (deliberate differences, per the comparison doc)

- Search axis (availability-window vs subject/level) — the domain difference itself.
- No preferred-tutors list in study (Q2 = a): the relationship model replaces
  bookmarking; a bookmark that reveals nothing is close to worthless in a
  two-stage flow. Owner-confirmed deliberate.
- Sit bookings stay family-initiated only (Q3 = a); revisit with usage data from
  study's tutor-proposal uptake. Owner-confirmed deliberate.
- Contact-sharing consent (sit, per-appointment) vs relationship unlock (study,
  standing): the §5 core divergence — owner-confirmed as a permanent,
  deliberate non-convergence (Q4).
- Search entry shape: sit's two-step wizard vs study's single form — forced by sit's
  one-time/recurring type split (UI doc §3); the underlying form components are
  already shared.
- One-stage appointment vs two-stage relationship+sessions — core divergence (§5); see Q4.
- `approvedFamilies` (study-only) — required by the two-stage model.
- Manual reference import (sit-only) — legacy migration path; study started native.
- Admin console hosted in sit — one console by design.
- Settings pages: **checked and not a gap** — sit's `/babysitter/settings` is a
  redirect to the account page; notification prefs live in AccountPage in all four
  role surfaces.
- Holidays / school-weeks in recurring bookings: **checked and already at parity**
  (`schoolWeeksOnly` + holiday awareness live in study's `bookSession` /
  `generateInstances` / availability).
- Endorsement count on search cards: **checked and already at parity**
  (`searchTutors` returns `endorsementCount`; sit shipped its badge in #198).

## Suggested implementation order

#234 (A1, largest, touches notifications) → #237 (B1, reuses study's reviewed
design) → #235 → #238 → #236 → #239 → #240 → #241 → #242. A4 stays inside #168.
