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
- Snapshot at appointment creation in ALL THREE create paths (sendContactRequest, contactPublishedSearch, resubmitAppointment — the third was caught in PR #248 review round 1) —
  `sendContactRequest` (family-initiated) and `contactPublishedSearch`
  (sitter answers a post). Immutable per appointment: later profile edits
  never retro-classify.
- `cancelAppointment` computes lateness for a CONFIRMED one_time appointment
  and writes `lateCancellation: true` alongside the cancel fields, whoever
  cancels (study's allow-but-flag is a record, not a punishment).
  **Deviation:** recurring sit appointments are never flagged — study's
  recurring lateness lives per-instance and sit has no instance model; a
  whole-series cancel has no single start time to be late against.
- `searchBabysitters` returns `cancellationNoticeHours`;
  `ExpandableBabysitterCard` renders the humanized window (sit-local
  `cancellationPolicy.ts` util mirroring study's, noted as twin).
- i18n en/fr mirroring study's key set.

## Tests

Integration: snapshot present via all three create paths (resubmit re-reads the CURRENT profile); late family cancel on
confirmed one_time flags; on-time cancel does not; pending cancel does not;
babysitter late cancel ALSO flags (study semantics); recurring never flags.
Client: policy editor saves the dot-path; card renders the window line.
Shared predicate keeps study's unit pins (moved with it).
