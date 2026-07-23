# Trial Sessions (V1.1 feature 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal (roadmap V1.1 §2):** the first session of a recurring plan can be flagged as a trial; both portals badge it. v1 is labeling + expectation-setting only — no pricing/cancellation mechanics attach to trials (nothing to enforce without payments; commented).

**DELIBERATE DEVIATION from the roadmap's letter (document in the PR):** the roadmap says "add `type: 'trial'` to SessionDoc", but a third top-level type would ripple through every `type === 'one_time' | 'recurring'` switch shipped across five PRs. Instead: `trialFirstSession?: boolean` on the RECURRING parent (booking-time family choice) and a denormalized `isTrial?: true` on the FIRST GENERATED instance (whichever date actually materializes first at confirm — holiday/conflict/notice drops shift it; the flag follows the first instance actually created with status 'scheduled', not the first candidate). Additive; zero migration; no switch changes.

**Templates to READ first:** validation/session.ts (recurring input shape); sessions/generateInstances.ts (where the first scheduled instance materializes — both confirm AND extendRecurring reuse it, but ONLY confirm can create the first-ever scheduled instance... EXCEPT the all-conflict→pending case followed by... no: parent stays pending on zero-scheduled, so confirm is the only creator of the first scheduled instance of a series. Verify and comment. Edge: first candidate conflict_skips and the SECOND becomes the first scheduled — the flag goes to the first SCHEDULED one); BookSessionPage weekly mode (the toggle's home); tutor SessionsPage pending recurring card + RecurringConflictPreview (badge sites); SessionInstanceList (instance badge).

## Task 1: backend (TDD)
- Types: `trialFirstSession?: boolean` (SessionDoc, comment) + `isTrial?: boolean` (SessionInstanceDoc).
- validation: optional `trialFirstSession` boolean on the recurring branch (one_time input carrying it → ignored-not-rejected, match the schoolWeeksOnly precedent — verify what that precedent actually does and be consistent).
- bookSession recurring path persists it. respondToSession confirm: generateInstances marks the FIRST instance it creates with status 'scheduled' as `isTrial: true` when the parent has trialFirstSession (conflict_skip instances never carry it; if ALL 8 dates skip, parent stays pending — no flag anywhere). extendRecurring: never sets it (the first scheduled instance always exists by then — assert via test that extension instances don't get flagged even on a series whose confirm scheduled zero... impossible per the pending rule; still pin extension-never-flags).
- Notification copy: the tutor's new-request email/push mentions the trial ('first session as a trial').
- Tests (red-first): booking persists the flag; confirm flags exactly the first SCHEDULED instance (incl. the case where candidate 1 conflict_skips → instance 2 carries it); non-trial series → no flags; extendRecurring adds unflagged instances; one_time input with the field → per the chosen precedent.
- Commit: `feat(study-functions): trial flag on recurring plans and their first scheduled instance`

## Task 2: UI (TDD)
- BookSessionPage weekly mode: 'Make the first session a trial' toggle (default OFF) + one-line explainer; payload includes trialFirstSession only when true (omit-when-false, match endDate's omit pattern); the projection panel marks the first non-greyed date 'Trial'.
- Tutor SessionsPage: pending recurring card shows a Trial badge + the request copy; instance lists (both portals via SessionInstanceList) badge the isTrial instance.
- i18n EN+FR ({family,tutor}.sessions.trial.* / family.book.trial.*).
- Tests: toggle → payload (and omit-when-false); projection marks the right date; badges render from isTrial/trialFirstSession fixtures on both portals.
- Commit: `feat(study-web): trial-session toggle and badges`

## Task 3: gates + push
- FULL emulator suite (baseline post-#98: expect 560/64 + yours); study-web (249 + yours), typecheck, lint (study-web ZERO — keep), build. Push feat/trial-sessions. NO PR.
