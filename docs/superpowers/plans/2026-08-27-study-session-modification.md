# Study Session Modification (issue #234, parity A1)

**Goal:** a family changes a one_time session's when/where/who without cancelling
it; the tutor is notified and must acknowledge. Mirrors sit's
modifyAppointment + acknowledgeModification contract, adapted to study's
availability ledger.

## Scope decisions (with reasons)

- **one_time only (v1).** Recurring-series mutation means regenerating
  instances and re-claiming per-occurrence ledger blocks — a different
  feature. `reason: 'recurring_unsupported'` tells the client to say
  cancel-and-rebook for series.
- **date IS modifiable** (deviation from sit, which oddly cannot move the
  date). Rescheduling to another day is THE reschedule; excluding it guts A1.
- **rate is NOT modifiable** (deviation from issue text): study's rate is the
  tutor's per-subject offering locked at booking, not a family-set offer like
  sit's offeredRate. A family cannot unilaterally reprice the tutor.
- **Who:** the FAMILY modifies (any parent of the session's family), the TUTOR
  acknowledges — sit's exact role split. A family cannot "modify" a
  tutor-proposed PENDING (that is a counter-offer; they accept or decline) →
  `failed-precondition`, reason `proposal_not_modifiable`.
- **Statuses:** pending (family-initiated) and confirmed. Confirmed
  time-changes move the ledger claim atomically; pending changes are plain
  updates (no claim exists yet).
- **Never touches lateCancellation** — the entire point per the flows doc; pinned.

## Mechanics for a confirmed time-change (the hard part)

In one transaction: read session + tutor override docs for old and new date;
`buildRestoredOverride` the old padded block out; re-check the new block
against weekly availability + overrides (`overlaps`/`paddedBlock`, same
predicates respondToSession's confirm uses) → refuse with
`reason: 'time_unavailable'`; `buildMergedOverride` the new claim in; write
session fields + `modified: true, modifiedAt, modifiedFields` (clearing
`modified` IS the acknowledgement -- no separate flag, sit's contract). Post-transaction: auto-decline overlapping
dated one_time PENDINGS at the new time (respondToSession's post-confirm
sweep, same copy), notify the tutor (`study_session_modified`).

## Tasks

1. `modifySessionSchema` (sessionId + optional date/startTime/
   sessionLengthMinutes/location/studentIds/message) in validation; types.
2. `modifySession` callable + unit-testable field-diff helper.
3. `acknowledgeSessionModification` callable (tutor-only; clears
   modified/modifiedFields -- that IS the ack, no separate flag; audit log; no
   notification — sit's ack is silent, mirror it).

   AMENDED IN REVIEW (PR #244): a PENDING modify does NOT set `modified` --
   the tutor answers the UPDATED request, so confirm/decline is the
   acknowledgement; a flag would have no pending-card surface to clear it
   and would resurface post-confirm.
4. Routing: `study_session_modified` → tutor `/tutor/sessions`; add to
   VISIBLE_NOTIFICATION_TYPES; pin the row (tutor branch — the #214 lesson).
5. study-web: family sessions page Modify dialog (one_time only); tutor
   sessions page Modified badge + changed-field list + Acknowledge.
6. i18n en/fr.
7. Integration pins (lane 2): role/status/type gates; diff semantics (no-op
   returns modified:false); ledger move verified on the override docs (old
   block gone, new block present, padding honored); time_unavailable refusal;
   overlapping-pending auto-decline; ack clears; lateCancellation never set;
   notification doc shape.
8. Suites + mutation checks on the load-bearing pins.

## Round-2 amendments (PR #244 review)

- **Offering-length gate:** a CHANGED `sessionLengthMinutes` must be in the
  tutor's `sessionLengthsMin` (bookSession's second offering gate); the stored
  length is grandfathered so legacy docs stay modifiable in other fields.
  `reason: 'length_not_offered'`.
- **Cancellation-policy interaction (decision):** modify was an unguarded
  escape hatch — move a 48h-notice session away, then cancel clean. Taken as
  a GUARD, not a trade-off: a claim-affecting modify on a confirmed session is
  refused (`reason: 'inside_notice_window'`) whenever cancelling NOW would be
  late by the session's own `cancellationNoticeHours` snapshot — you cannot
  move what you could not cleanly cancel. Symmetric with cancelSession's
  lateness predicate; message/students edits remain allowed inside the window.
- **modifiedFields union:** a second modify before acknowledgement unions
  field lists — the badge describes everything unseen.
- **Edits-only client payload:** the dialog omits untouched when-fields.
