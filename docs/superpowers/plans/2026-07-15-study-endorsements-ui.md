# Study Endorsements UI (PR D of tutor-search milestone) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** tutors moderate incoming endorsements (accept publishes to their search profile, dismiss hides); families endorse tutors they have an accepted contact request with.

**Backend contracts (from PR A — do not change):**
- `submitTutorEndorsement({tutorUserId, referenceText (≥10 chars), refName, subject?})` → `{referenceId}`. Errors: permission-denied ('Endorsements require an accepted contact request' / not a parent), already-exists (one per family+tutor), invalid-argument (short text / self).
- `respondToTutorEndorsement({referenceId, action: 'accept'|'dismiss'})` → `{ok}`. accept → status 'approved' (counts in search), dismiss → 'removed'.
- Study endorsement docs live in shared `references`: `appSource=='study'`, `tutorUserId`, `submittedByFamilyId`, `submittedByName`, `refName`, `referenceText`, `subject?`, `status: private|approved|removed`, `isEjmFamily`. Client-readable (isAuth); tutor-keyed composite `(tutorUserId, createdAt desc)` exists. Submitter content edits are rules-frozen once status != 'private'.

**Templates to READ first:** PR C's TutorCard endorsement expansion + tutor RequestsPage (accept/decline optimistic idiom); sit apps/web babysitter references UI if a moderation precedent exists (READ apps/web/src/pages/babysitter — adapt loosely; study's accept/dismiss is simpler).

**Invariants:** apps/web untouched; no client writes to references (both actions go through callables); i18n EN+FR; one endorsement per (family, tutor) surfaced as a friendly error, not hidden.

## Task 1: Tutor EndorsementsPage
- `src/pages/tutor/EndorsementsPage.tsx` at `/tutor/endorsements`: getDocs `references` where `tutorUserId==me` orderBy `createdAt desc`; sections: Pending (status 'private') with referenceText/refName/submittedByName/subject + Accept / Dismiss (confirm dialog on dismiss: permanent), Published ('approved'/'published'), dismissed hidden.
- Calls `respondToTutorEndorsement`; optimistic move between sections + rollback on error.
- Tutor DashboardPage: pending-endorsements count card → /tutor/endorsements; AppBar menu item. (The submit callable's email already links to /tutor/endorsements — route must match.)
- TDD: query args, section grouping by status, accept/dismiss payloads, optimistic move + rollback.
- Commit: `feat(study-web): tutor endorsements moderation page`

## Task 2: Family endorse flow
- `src/components/family/EndorseTutorDialog.tsx`: textarea (≥10 chars client check mirroring the zod message), refName prefilled from the caller's display name (editable), subject Select prefilled from the request's subject (optional); submit → `submitTutorEndorsement`; success state explains it goes live only after the tutor accepts.
- Entry point: PR C's family RequestsPage — accepted rows gain "Endorse [tutorName]" (tutorUserId + subject are on the request doc). After `already-exists`, show "already endorsed" state (persist nothing client-side; just map the error).
- Submitted list: a small "Your endorsements" section on the family RequestsPage (query `references` where `submittedByFamilyId==mine && appSource=='study'` — equality-only, no composite needed) showing status (pending with tutor / published / removed).
- TDD: payload (trim, subject omit-when-empty), min-length gate, error mapping (permission-denied / already-exists), submitted-list rendering per status.
- Commit: `feat(study-web): family endorse-tutor flow`

## Task 3: gates + review + PR
- Full study-web suite + typecheck + lint baseline; i18n parity (`tutor.endorsements.*`, `family.endorse.*` EN+FR).
- Whole-branch review; push + PR (body: consent model recap — relationship-gated submit, private-until-accepted, content frozen post-acceptance; follow-ups: endorsement admin moderation, endorsementCount denormalization).
- BEFORE merge: controller extends the FE browser smoke (endorse from accepted request → tutor accepts → count appears in search).
