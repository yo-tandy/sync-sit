# Sit Cancellation Policies (issue #237, parity B1 — adopt from study)

**Goal:** port study's V2-feature-7 notice-window system to sit appointments,
keeping the twins byte-similar: babysitter declares a notice window, the
policy is snapshotted onto each appointment at creation, cancels inside the
window are allowed but flagged.

## Design (mirroring study exactly, deviations noted)

- Predicate MOVES to shared-functions (`schedule/lateCancellation.ts`);
  study's `sessions/lateCancellation.ts` becomes a re-export so its five
  call sites are byte-unchanged. One lateness definition for both apps.
- Profile field `profiles.babysitter.cancellationNoticeHours`; editor on the
  sit SchedulePage with study's exact presets (none/24h/48h/1 week) and the
  same dot-path save.
- Snapshot at appointment creation in ALL THREE create paths:
  `sendContactRequest` (family-initiated), `contactPublishedSearch` (sitter
  answers a post), and `resubmitAppointment` (family retries after a decline;
  reads the sitter's CURRENT policy — a resubmission is a new ask). The third
  path was caught in PR #248 review round 1. Immutable per appointment:
  later profile edits never retro-classify.
- `cancelAppointment` computes lateness for a CONFIRMED one_time appointment
  and writes `lateCancellation: true` alongside the cancel fields, whoever
  cancels (study's allow-but-flag is a record, not a punishment).
  **Deviation:** recurring sit appointments are never flagged — study's
  recurring lateness lives per-instance and sit has no instance model; a
  whole-series cancel has no single start time to be late against.
  **Deviation (round 2):** a cancel of an appointment that already STARTED is
  never flagged. Study never reaches that case (its completed-sweep cron
  makes past sessions uncancellable); sit has no sweep, so stale confirmed
  appointments stay cancellable as cleanup and must not mint badges.
- **Inside-window modify guard (round 3):** `modifyAppointment` blocks
  startTime moves on a confirmed one_time appointment inside its window --
  study's "cannot move what you could not cleanly cancel" contract. The
  round-2 claim that same-day moves cannot escape was WRONG: a 24h window
  with the start 23h away moves to 37h away and cancels clean. Message and
  additionalInfo edits stay allowed; pending appointments are unguarded (no
  claim to escape).
- **Snapshot clamp (round 3):** every snapshot site (sit's three create
  paths + study's bookSession/proposeSession) normalizes the profile value
  through `clampNoticeWindow` -- legacy pre-rules values are grandfathered
  by the rules diff-gate, so the snapshot rounds DOWN to the nearest preset,
  never flagging more than a real preset would.
- `searchBabysitters` returns `cancellationNoticeHours`; the family
  `SearchPage` result card renders the humanized window (sit-local
  `cancellationPolicy.ts` util mirroring study's, noted as twin).
  **Disclosure surfaces (round 2):** study shows the window on TutorCard +
  BookSessionPage + a cancel-time warning; sit ships the search-card line
  plus a cancel-time warning in BOTH dashboards' cancel dialogs
  (`isLateCancellationClient` ported). Sit has no booking page analog — the
  request card IS the booking surface, so no third surface exists to match.
  The flag's read surfaces: sitter RequestDetailPage badge, family
  ExpandableBabysitterCard line, GovernedChildPage history badge, and the
  guardian oversight payload.
- i18n en/fr mirroring study's key set.

## Tests

Integration: snapshot present via all three create paths (resubmit re-reads
the CURRENT profile); late family cancel on confirmed one_time flags; on-time
cancel does not; pending cancel does not; babysitter late cancel ALSO flags
(study semantics); recurring never flags; already-started cancel never flags
(cleanup deviation). Rules: preset-set membership, diff-gated for legacy
values, both profiles.
Client: policy editor saves the dot-path; card renders the window line.
Shared predicate keeps study's unit pins (moved with it).
