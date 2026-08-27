# Sit: appointment notes (issue #238, parity B2 — adopt from study)

## Goal

Study has per-session notes (`setSessionNote`, V1.1): the family writes a
PRE-session note ("focus on fractions"), the tutor writes a POST-session note
(what was covered). Sit has no appointment notes, yet sitting logistics (door
codes, bedtime, allergies) are at least as note-worthy. Adopt study into sit:
`setAppointmentNote` with the SAME visibility and permission rules — the twins
must not disagree on note privacy.

## Study contract being mirrored (setSessionNote)

- ONE callable serves both notes; `kind: 'pre' | 'post'` selects which note,
  and thus which party may write and which timing window applies.
  - `pre` — FAMILY-authored. Any parent of the session's family, ONLY until
    the session's start time passes.
  - `post` — PROVIDER-authored (tutor/babysitter). Only the session's
    provider, ONLY once the session has started.
- Both notes are visible to both parties (they live on the doc both already
  read); nobody else gains read access.
- Status gate: only a live/settled engagement is annotatable (study:
  confirmed/completed; declined/cancelled/pending have no session to
  annotate).
- Timing is Paris wall-clock (`parisWallTimeToUtc` — DST-safe).
- Empty `text` clears the note (`FieldValue.delete()` — field goes absent).
  The author overwrites their own note freely within its window.
- Max 2000 chars, trimmed. Zod-validated.
- Writes are callable-only (rules stay deny-all on appointments). v1 is
  SILENT: no notification to the counterparty (ledgered study decision).
- Audit trail via `writeUserActivity`.

## Structural adaptations (sit's appointment model differs)

1. **Field names**: `preAppointmentNote` / `postAppointmentNote` on the
   appointment doc (`familyNote` is taken — it's the denormalized family
   profile note).
2. **No instances**: study's recurring series stores notes per-occurrence on
   SessionInstanceDocs (`instanceId` required). Sit's recurring appointment is
   ONE ongoing doc with no per-occurrence children, so there is no
   `instanceId` anywhere. Notes on a recurring sit appointment live on the
   appointment doc itself.
3. **Timing on recurring**: a confirmed recurring arrangement has no single
   start instant — every week there is both a next occurrence (pre-note
   meaningful: door codes, allergies) and, in steady state, past occurrences
   (post-note meaningful). Both windows stay OPEN while the arrangement is
   confirmed. One_time appointments keep study's exact gates (pre before
   start, post after start).
4. **Status gate**: sit has no `completed` status — a past sitting stays
   `confirmed`. So annotatable == `status === 'confirmed'`, which naturally
   covers study's "completed" case (post-note on a finished engagement).
5. **No guardian path**: study's setSessionNote has no guardian-actor branch,
   so sit's gets none either (guardians read notes through the appointment
   doc they can already see via their own surfaces, exactly like study
   supervision does).

## Architecture

### Backend (apps/functions)

- `apps/functions/src/appointments/setAppointmentNote.ts` — new callable,
  ported from `apps/study-functions/src/sessions/setSessionNote.ts`. Zod
  schema `{ appointmentId, kind: 'pre'|'post', text: trim().max(2000) }`
  (sit keeps zod schemas next to the callable, cf. enrollmentExemptions).
- Register in `apps/functions/src/index.ts`.
- `packages/sit-core/src/types/appointment.ts`: add
  `preAppointmentNote?: string; postAppointmentNote?: string` to
  AppointmentDoc.
- **No firestore.rules change**: notes ride on the appointment doc, already
  readable by exactly {family members, the babysitter, admin} and
  client-write-denied. Visibility therefore matches study automatically.

### Web (apps/web)

- `components/appointments/AppointmentNotes.tsx` — port of study's
  `SessionNotes` (read view of both notes + single edit affordance for the
  viewer's own kind; copy passed in).
- `components/appointments/AppointmentNoteDialog.tsx` — port of study's
  `SessionNoteDialog` (remount-on-open textarea, non-optimistic save, char
  counter, empty save allowed = clear).
- `lib/appointmentTime.ts` — `hasStarted(date?, startTime?)` Paris wall-clock
  helper (study duplicates this per page; sit shares it).
- **Family side**: `ExpandableBabysitterCard` renders AppointmentNotes in the
  expanded section for `confirmed` (pre editable while not started, or always
  for recurring), and read-only on `past`/`rejected` when notes exist. The
  card owns the dialog + callable (it already owns its own reference reads);
  the dashboard's live onSnapshot refreshes the note after save — no local
  patching, no DashboardPage change.
- **Sitter side**: `RequestDetailPage` gets a notes Card — family pre-note
  read-only, own post-note editable once started (always for recurring),
  status confirmed only. Page already holds a live onSnapshot.
- i18n: `familyDashboard.notes.*` (family copy) + `request.notes.*` (sitter
  copy), en + fr.

## Tasks

1. Plan doc (this file).
2. sit-core type fields.
3. Callable + registration (TDD against the integration suite).
4. Integration pins `tests/integration/appointments/set-appointment-note.test.ts`
   mirroring study's `set-session-note.test.ts` one-for-one, adapted:
   - happy: family pre on upcoming confirmed one_time; sitter post on started
     one_time; post on a long-past confirmed one_time (sit analog of study's
     `completed` pin).
   - role gates: sitter cannot write pre; family cannot write post; stranger
     family cannot write pre; stranger sitter cannot write post.
   - timing gates: pre rejected once started; post rejected before start.
   - status gates: cancelled, pending, rejected all failed-precondition.
   - not-found: unknown appointment.
   - recurring adaptation: pre allowed with no date; post allowed with no
     date (replaces study's instanceId-shape pins, which have no sit analog).
   - clear-by-emptying: field goes ABSENT, not blank.
   - independence: writing post preserves an existing pre (adapts study's
     "note on one instance does not touch siblings" pin).
   - length: 2001 rejected, exactly 2000 accepted; text is trimmed.
5. Web UI (components + card + detail page + i18n en/fr).
6. Web unit pins mirroring study's UI tests:
   - family card: confirmed offers add-note; save calls
     `setAppointmentNote {appointmentId, kind:'pre', text}`; past shows both
     notes with author labels and no edit; editing seeds the textarea and
     clearing sends empty text; recurring confirmed offers add-note.
   - sitter detail: pre-note read-only + no post affordance before start;
     post affordance once started; save calls callable with kind:'post'.
   - `hasStarted` unit pins.
7. Emulator lane 3 run + web suite + tsc; mutation-check load-bearing pins.
8. PR with study-twin file citations; screenshots follow from parent session.
