# Session Notes (V1.1 feature 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal (roadmap V1.1 §1):** `preSessionNote` + `postSessionNote` on sessions. Pre = FAMILY-authored ("focus on fractions this week"), editable until the session starts. Post = TUTOR-authored (what was covered / homework), writable once the session has STARTED (not gated on the completion cron). Both sides read both notes. One_time notes live on the parent SessionDoc; recurring notes live per-instance.

**Decisions (controller-made, documented for review):** callable-only writes per house style (rules stay deny-all); ONE callable `setSessionNote`; silent in v1 (no notifications — ledgered); notes editable/overwritable by their author within their window; max 2000 chars.

**Templates to READ first:** sessions/cancelSessionInstance.ts (party detection against instance denorms + parent/instance guards — the closest shape); types/{session,sessionInstance}.ts; validation/session.ts; tutor + family SessionsPage(s) + SessionInstanceList (shared component — notes UI touches it); tests/integration/study-sessions/* idioms.

## Task 1: backend — setSessionNote (TDD)
- types: `preSessionNote?: string`, `postSessionNote?: string` on SessionDoc AND SessionInstanceDoc (comments: authorship + windows).
- validation: `setSessionNoteSchema = {sessionId, instanceId?: string, kind: z.enum(['pre','post']), text: z.string().trim().max(2000)}` — empty text ALLOWED (clears the note).
- `sessions/setSessionNote.ts`: load session (+instance when instanceId given; not-found as appropriate; instanceId only valid on recurring parents — invalid-argument otherwise). Role gate: kind 'pre' → caller is a parent of session.familyId (permission-denied otherwise); kind 'post' → caller === session.tutorUserId. Status gates: the target (parent for one_time, instance for recurring) must be confirmed/'scheduled' or completed — declined/cancelled/pending targets rejected (failed-precondition; pending has no session to annotate). Timing gates via parisWallTimeToUtc: 'pre' rejected once start has passed ('failed-precondition: session already started'); 'post' rejected before start. Write the field on the correct doc (trimmed; delete the field when text is empty — FieldValue.delete()). Audit 'session_note_set'. No notifications (comment the v1 decision).
- Tests (red-first): family sets pre on upcoming one_time; tutor sets post after start (inject a past-started confirmed fixture); wrong-role each direction (tutor tries pre → permission-denied, family tries post); pre after start rejected; post before start rejected; recurring instance targeting (note on instance 2 doesn't touch instance 1 or the parent); empty text clears; cancelled/pending targets rejected; 2000-char bound.
- Commit: `feat(study-functions): session notes via role-gated setSessionNote`

## Task 2: UI — both portals (TDD)
- Shared: extend SessionInstanceList (props-driven) to render existing notes (pre labeled 'From the family', post 'From the tutor' — i18n) and surface an edit affordance via a callback prop; a small `SessionNoteDialog` in components/sessions/ (textarea, 2000 max, save via setSessionNote, non-optimistic, clear-by-emptying supported).
- Family SessionsPage: upcoming one_time rows + upcoming scheduled instances get 'Add a note' / 'Edit note' (pre); completed rows show the tutor's post-note read-only.
- Tutor SessionsPage: started/completed targets get 'Add session notes' (post); pre-notes visible on upcoming rows (read-only).
- After save: update local state from the callable success (non-optimistic; no refetch needed — single-field).
- Tests: payloads ({sessionId, instanceId?, kind, text}); windows drive affordance visibility (upcoming family row shows pre-edit, started tutor row shows post-edit); both notes render with author labels; clear flow; i18n EN+FR parity ({family,tutor}.sessions.notes.*).
- Commit: `feat(study-web): session notes UI for families and tutors`

## Task 3: gates + push
- FULL emulator suite (baseline post-sweep: verify on main — expect 541/63 + yours); study-web suite (236 baseline + yours), typecheck, lint (study-web baseline is now ZERO errors — keep it), build. Push feat/session-notes. NO PR.
