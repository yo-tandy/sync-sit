# Guardian Study-Web UI (Parental Governance PR 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All study-web governance surfaces: the family governance dashboard (multi-kid monitoring, create-kid-invite with the consent trio, cancel/resend), the governed-child oversight detail with protective controls, the kid-side supervision surfaces (claim confirm, supervised indicator, transparency page), and the Supervision Agreement static page (copy below — EN authoritative, FR translation).

**Backend contract (all merged — #102/#104/#105):** callables `createKidInvite`, `cancelKidInvite({inviteId})`, `resendKidInvite({inviteId})`, `respondToSupervisionRequest({accept})`, `getGovernedChildren()`, `getGovernedChildDetail({childUid})`, `guardianSetChildSearchable({childUid, app, searchable})`; guardian declines/cancels go through the EXISTING `cancelSession`/`cancelSessionInstance`/`respondToSession`/`respondToTutorContactRequest` (guardian is an auth extension — decline-only; accept attempts throw details.code `guardian/decline-only`). Consent versions come from shared-core constants `TOS_VERSION`/`PRIVACY_POLICY_VERSION`/`SUPERVISION_AGREEMENT_VERSION` — send them verbatim. `guardianLinks/{ownUid}` is client-readable by the child; `governedBy` sits on the own user doc. Mirrored notifications arrive as type `guardian_mirror`.

**House rules:** TDD red-first per surface; i18n EN + real FR for every string; study-web lint stays ZERO; non-optimistic mutations (refetch after resolve); client Firestore reads keep provable equality filters; follow FamilyLayout/TopNav/Card/Badge/lazyPages idioms exactly. ANTI-ENUMERATION UX: the create-invite success screen says "Invitation sent" — never anything implying whether an account existed.

---

## Task 1: routes, nav, types

- `apps/study-web/src/types/guardian.ts`: mirror the callable payload types (GovernedChildSummary, GovernedChildDetail, KidInviteRow — read the backend source in packages/shared-functions/src/guardian/ and type what it returns; do not invent fields).
- Routes (lazyPages + router): `/family/governance` (GovernancePage), `/family/governance/:childUid` (GovernedChildPage), `/supervision-agreement` (public static page, both roles can view).
- FamilyLayout nav/dashboard entry: "Governance" card/link (i18n `family.governance.navTitle`, short desc). Follow how existing family dashboard cards link to search/sessions.
- Commit: `feat(study-web): governance routes and types`

## Task 2: GovernancePage (dashboard)

Sections:
1. **Supervised kids** — card per `children[]` row: name, age, link status badge (pending → "awaiting confirmation", active, revoked), profile chips (tutor/babysitter + searchable state), upcoming-30-day counts; active links link to the detail page.
2. **Pending invitations** — per `invites[]`: kid name/email, expires date (expired styling past expiresAt), Resend + Cancel buttons (non-optimistic, confirm dialog for cancel, refetch after each).
3. **"Add a child" CTA** → Task 3 form.
Empty state copy for a family with nothing yet. Loading + error states per house pattern.
Tests: renders rows from mocked getGovernedChildren; resend/cancel pin callable names + payloads + refetch; expired invite styling; empty state.
Commit: `feat(study-web): family governance dashboard`

## Task 3: create-kid-invite flow

Full-page form (not a cramped dialog): kid EJM email, first name, last name, date of birth (date input), then the CONSENT TRIO — three required checkboxes, each linking to its document (ToS + privacy: the apps' existing static pages; Supervision Agreement: `/supervision-agreement`), labeled with versions from the shared-core constants. Submit disabled until all three checked + fields valid (client-side EJM email format check via `validateEjmEmail` for fast feedback — the invalid-email error is safe to show).
On success: **uniform confirmation screen** — title `family.governance.inviteSent`, body explaining the kid will receive an email OR an in-app request if they already have an account, and that this screen looks the same either way BY DESIGN (one neutral sentence: "For your child's privacy, we don't reveal whether an account already exists."). Back-to-dashboard CTA (refetches).
Error mapping: `guardian/not-a-family-parent` → needs-family explainer; invalid email/consent → inline.
Tests: submit blocked until consents checked; payload pins (consent versions verbatim from constants); uniform success regardless of mocked backend branch (assert SAME screen for two different mocked resolves); email-format inline error.
Commit: `feat(study-web): create kid invite with consent trio`

## Task 4: GovernedChildPage (oversight + protective controls)

From `getGovernedChildDetail`: header (kid identity, age, link since date); profile section (subjects/rates/levels for tutor profile, sit profile presence); schedule summary; **sessions list** (reuse/adapt existing session-card patterns; instances expandable; SHOW pre/postSessionNote and message content per ruling 8 — pin in test); **pending requests** (session requests + contact requests, with messages).
Protective controls:
- Searchable toggle per app profile → `guardianSetChildSearchable` (non-optimistic switch, confirm modal explaining visibility effect).
- Cancel on confirmed sessions/instances → existing ReasonModal → `cancelSession`/`cancelSessionInstance` (reason required; the callable authorizes the guardian).
- Decline on pending requests → `respondToSession {action:'decline'}` / `respondToTutorContactRequest` decline (confirm modal). NO accept affordances anywhere on this page — pin a test asserting no accept/confirm button renders for pending items.
Denied state: backend permission-denied (revoked/pending link) → friendly "supervision not active" screen.
Tests: notes visible; controls pin callable payloads; no-accept-affordance pin; non-optimistic refetch; denied state.
Commit: `feat(study-web): governed child oversight and protective controls`

## Task 5: kid-side supervision surfaces

- **Supervision request card** on the tutor dashboard (and family dashboard if the kid somehow has the parent role — tutor dashboard is the required one): live read of `guardianLinks/{ownUid}` (doc get, child-readable by rules) when status pending+origin claim → "A parent of the X family asked to supervise your account" + Accept/Decline → `respondToSupervisionRequest({accept})` (non-optimistic; decline confirm explains the parent is not told).
- **Supervised indicator**: when own user doc has `governedBy` → a badge/section in tutor AccountPage ("Supervised account") linking to the transparency page.
- **Transparency page** `/family... no — `/supervision-info` (public route, i18n): "What supervision means" — guardians see everything including session notes and messages, can hide you from search / cancel / decline but never accept for you, all parents in the supervising family share these rights, supervision ends only by a parent (15+) or admin. Content mirrors ruling 8 honestly.
Tests: pending claim renders + accept/decline payload pins; no card when no link doc; indicator renders iff governedBy.
Commit: `feat(study-web): kid supervision surfaces`

## Task 6: Supervision Agreement page

Static page at `/supervision-agreement` (linked from the consent trio + transparency page). Copy is AUTHORITATIVE below (EN) — implement verbatim, translate to real French (vous form), version heading from SUPERVISION_AGREEMENT_VERSION. Note above the fold: "Version 1.0 — you accept this agreement when creating or requesting supervision of a child's account."

EN copy (authoritative):
> # Supervision Agreement
> **What you confirm**
> - You are a parent or legal guardian of the child, and a parent of the family account you are using.
> - You consent, on the child's behalf, to the Terms of Service and Privacy Policy, and to the processing of the child's data needed to run this service.
> **What you can see** — Supervision is full visibility: your family's parents see the child's sessions and appointments, schedules, incoming and outgoing requests with their messages, and all session notes. The child is informed that supervision is active.
> **What you can do** — You can hide the child from search, cancel their sessions or appointments (with a reason), and decline requests on their behalf. You can never accept or commit on their behalf — the child always makes their own commitments.
> **Your responsibilities** — You agree to supervise the child's use of the service, to make sure commitments the child accepts are honored or cancelled with proper notice, and to remain reachable by families and by the EJM administration for matters concerning the child.
> **Sharing of rights** — Every parent in your family account holds the same supervision rights, and each is notified of the child's activity.
> **Duration** — For a child under 15, supervision is required and cannot be removed. From 15, any parent of the family (or an administrator) may end supervision. The child cannot remove it themselves.
Tests: page renders headings + version; FR present; linked from consent form + transparency page.
Commit: `feat(study-web): supervision agreement page`

## Task 7: gates

`pnpm --filter study-web test && lint && build`, root typecheck. Lint ZERO. Report: per-task status, test counts, i18n keys, deviations. NOTE in the report anything in the backend payloads that made a surface awkward (feeds PR 5).

## Self-review notes

- The uniform-success test (Task 3) is this PR's version of the anti-enumeration pin — two different mocked backend behaviors, ONE identical rendered screen.
- No accept affordances on guardian surfaces — pinned, not just omitted.
- Mirrored notifications need NO new surface (existing notification list renders them; add the `guardian_mirror`/`guardian_action`/`supervision_request` type labels to whatever type→label map exists).
- All new client reads: `guardianLinks/{ownUid}` doc get only (child-readable). Everything else is callables.
