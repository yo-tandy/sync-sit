# Tutor Portal Admin Extension (PR 3 of tutor-portal-foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Single-task PR — one implementer, one review.

**Goal:** Admins can review tutor identity documents in sync-sit's existing `/admin` VerificationsPage: filter by `tutor_identity`, see tutor-appropriate cards, approve/reject through the existing `reviewVerification` flow (which flips the tutor's `enrollmentComplete` server-side, per #77).

**Scope:** apps/web ONLY, 4 files: `src/stores/verificationStore.ts`, `src/pages/admin/VerificationsPage.tsx`, `src/i18n/en.ts`, `src/i18n/fr.ts`. Nothing else. The backend already returns tutor docs from `listPendingVerifications` with `tutorName` and no `familyId`/family enrichment.

## Task (single)

1. **verificationStore.ts**: widen `VerificationDoc.type` to `'identity' | 'ejm_enrollment' | 'tutor_identity'`; make family-only enrichment fields optional if not already (`familyId?`, `familyName?`, `parentName?`, kids fields); add `tutorName?: string`. Widen the `fetchPendingVerifications` params type union similarly.
2. **VerificationsPage.tsx**: add a `tutor_identity` option to the type-filter Select (i18n key); in the card render, branch for tutor docs (`v.type === 'tutor_identity'`): show `tutorName`, a "Tutor ID" badge (i18n), and SKIP the family-specific block (family name/parent/kids comparison display) — keep the shared pieces (status badge, submitted date, view-document button, rejection reason, approve/reject buttons with the existing dialogs). The view-document path extraction already works for tutor fileUrls (verified in PR 2 — canonical `/o/`-format URLs).
3. **i18n en+fr**: `verification.typeTutorIdentity` ("Tutor ID" / "Pièce d'identité tuteur") + any filter-option label needed. Check how existing type labels are keyed and mirror.
4. **Tests**: apps/web has a jsdom harness (12 test files). Add `src/pages/admin/__tests__/VerificationsPage.test.tsx` IF the page is testable with the store mocked cheaply (mock `useVerificationStore` + authStore-equivalents per the app's existing patterns — check `src/pages/public/__tests__/LoginPage.test.tsx` and the SignUpRolePage test for the mocking idiom): cases — tutor doc renders tutorName + badge and NOT family fields; family doc renders family fields (regression); filter select contains the new option. If the page pulls in too much (dialogs etc.) to mock cheaply, a store-typing compile check + manual smoke note is acceptable — report which you did.
5. **Gates**: `pnpm --filter web test` (48+ green), `pnpm --filter web lint` (baseline 1 pre-existing router.tsx error — add none), `pnpm typecheck`. No emulators needed (no backend change).

Commit: `feat(web): tutor identity review in admin verifications`.

## Invariants
- Family card rendering byte-identical for family docs.
- No backend/shared-package changes.
- approve/reject handlers unchanged (the backend branches on doc type).
