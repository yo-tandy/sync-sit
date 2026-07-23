# Sit Override-Ledger Adoption (Hardening PR H3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** sit's schedule claims adopt the study-side `sessionBlocks` ledger so (a) cancelled sit appointments finally FREE their slots (today sit's cancelAppointment never touches overrides — blocked slots persist forever), and (b) cross-app restoration becomes lossless in both directions, closing the milestone-5 residual (a sit block overlapping a cancelled study claim currently reopens, because sit blocks are ledgerless).

**Ground truth (verify while reading):** apps/functions/src/appointments/respondToRequest.ts:57-83 does a LOSSY slot merge (flips false, no record); cancelAppointment.ts does NO override work at all. apps/study-functions/src/sessions/sessionOverride.ts holds the shipped, review-hardened helpers: buildMergedOverride (AND-only, append ledger, only-fill provenance, foreign preservation) and buildRestoredOverride (CURRENT-SLOTS restore: reopen only inside the removed entry's range where the weekly grid allows and no REMAINING entry covers; conditional delete only when ledger empty AND slots == weekly).

**Architecture:** extract the helpers to `packages/shared-functions/src/schedule/sessionOverride.ts` with a generalized ledger entry `{startIdx, endIdx, sessionId?, instanceId?, appointmentId?}` — the remaining-coverage check in restore uses only startIdx/endIdx, so sit and study entries coexist in one `sessionBlocks` array and each app's restore automatically respects the other's claims. Provenance: study docs keep `appSource:'study'`/`reason:'study_session'`; sit's NEW claim docs get `appSource:'sit'`/`reason:'appointment'`; each app's `isOurs` matches only its own provenance, so cross-app docs always take the conservative branch (ledger-entry removal + in-range current-slots restore that respects the other app's entries). LEGACY sit overrides (pre-H3, ledgerless) are untouched by restoration — conservative, status quo.

**Templates to READ first:** the two study files above + their tests (tests/integration/study-sessions/cancel-session*.test.ts — the grid-equality and foreign-conservation idioms); apps/functions/src/appointments/{respondToRequest,cancelAppointment}.ts; sit's appointment integration tests (tests/integration/ — find the respond/cancel suites); the parisTime extraction commit (1ce66e4) for the copy-then-re-export convention.

## Task 1: extract the helpers to shared-functions
- Move sessionOverride.ts content to packages/shared-functions/src/schedule/sessionOverride.ts; generalize the entry type + the `isOurs` check into a parameter (`ownProvenance: {appSource, reason}`) so each caller passes its own. Study's file becomes a thin re-export (or direct import swap in its 3 call sites — pick whichever keeps the study diff smallest; the study integration suite unchanged-green is the refactor proof).
- Unit-test the generalized helpers in shared-functions (port/extend study's implicit coverage into direct unit tests: merge-append, foreign preservation, current-slots restore, conditional delete, MIXED sit+study entries in one array — restore of one respects the other's range).
- Gates: builds; study-sessions integration suite unchanged; shared-functions unit suite green.
- Commit: `refactor(shared-functions): generalized session-override ledger helpers`

## Task 2: sit confirm writes the ledger
- respondToRequest's override write becomes buildMergedOverride with entry `{appointmentId, startIdx, endIdx}` + ownProvenance `{appSource:'sit', reason:'appointment'}`. The RESULTING SLOTS must be byte-identical to the old merge for every existing case (the old lossy behavior was correct at claim time — only the record was missing): prove it by the existing sit respond suites passing UNCHANGED, plus a new assertion that the ledger entry + provenance fields now exist. Handle both its paths (whole-day 'unavailable' writes and slot merges — READ what it actually does per type; recurring sit appointments may write multiple dates: each date gets its entry).
- Red-first: the new ledger-entry assertions fail against the old writer.
- Gates: full sit appointment suites + full integration suite.
- Commit: `feat(functions): sit schedule claims carry the sessionBlocks ledger`

## Task 3: sit cancel restores; cross-app closure
- cancelAppointment gains restoration: for a confirmed appointment being cancelled, remove its ledger entry/entries (all dates for recurring) via buildRestoredOverride with sit's ownProvenance. Legacy ledgerless docs: no entry to remove → doc untouched (assert this — conservative, no regression). Transactional per the study pattern (tx.get override before writes) — READ how cancelAppointment currently transacts and fit in.
- Tests red-first: (a) sit cancel restores the claimed slots (grid equality vs pre-claim, doc deleted when truly clean); (b) legacy ledgerless override untouched by cancel; (c) THE CLOSURE TESTS, both directions: sit claim + study claim on the same tutor-babysitter dual-role uid and date → cancel the STUDY session → sit's block survives (its ledger entry covers the range); cancel the SIT appointment → study's block survives. These two tests are the point of the whole PR.
- Gates: full integration suite (baseline 521 + yours); typecheck; lint baselines.
- Commit: `feat(functions): sit cancellation restores schedule slots via the ledger`

## Task 4: gates + push
- Full gates incl. `pnpm test:unit`; push feat/sit-override-ledger. NO PR — controller reviews and opens it.
