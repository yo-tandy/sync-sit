# Admin Families List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can see and search the list of registered families — not just users. Read-only v1: a Families admin page listing every family with its parents, kids, verification state, and supervision count, with search and status filtering, plus a per-family detail expansion.

**Architecture:** One admin callable `listFamilies` in `packages/shared-functions/src/admin/` (re-exported from apps/functions like every other admin callable — mirror `listUsers`'s shape: search/filter/limit/startAfterId paging). It joins each family with: parent summaries (name + email from users docs via batched `getAll`), kids (the `families/{id}/kids` subcollection — verify the actual kids storage location in code before implementing; sit family settings pages are ground truth), counts (preferredBabysitters, governed kids via guardianLinks where familyId ==), and verification state. UI: new `FamiliesPage.tsx` in the sit admin section, following AdminUsersPage idioms exactly (adminStore extension, fetch-on-mount + search form, paged "load more", non-optimistic).

**House rules:** TDD red-first; EN + real FR i18n; sit web lint baseline 1 error/7 warnings — add none; admin-only auth matrix tests; no new indexes (verify: status equality filter on families + orderBy createdAt may need one — if so, STOP and report to team-lead before adding).

---

## Task 1: listFamilies callable (TDD)

Files: `packages/shared-functions/src/admin/listFamilies.ts` (new), export in package index + `apps/functions/src/index.ts`; test `tests/integration/admin/list-families.test.ts` (new; follow the existing admin integration-test harness, e.g. the exemptions or listUsers tests if present).

Input (zod): `{ searchQuery?: string, statusFilter?: 'active'|'deleted', verifiedFilter?: boolean, limit?: number (default 50, max 100), startAfterId?: string }`.

Behavior:
- Admin-gated via `verifyAdmin` (same as listUsers).
- Query `families` ordered by `createdAt desc`, `where('status','==',statusFilter)` when set, cursor via startAfterId doc snapshot. IMPORTANT: check firestore.indexes.json — status+createdAt on families may need a composite; if listUsers solved the same shape some way, mirror it; otherwise report before adding an index.
- searchQuery: case-insensitive match on familyName OR any parent name/email — implement the same way listUsers implements its search (read its code; if it filters in memory post-fetch, do the same for consistency).
- verifiedFilter: filter on `verification.isFullyVerified` (in memory if not indexed).
- Join per page (batched `db.getAll`, not N+1 loops where avoidable): parents → `{uid, firstName, lastName, email, status}`; kids from wherever sit actually stores them (VERIFY: grep the family settings/kids CRUD code) → `{firstName, age}[]`; `governedKidsCount` = count of guardianLinks docs with familyId == id (one equality query per family is acceptable at admin scale — comment it).
- Return `{ families: AdminFamilyRow[], hasMore: boolean }` with `AdminFamilyRow = { familyId, familyName, address, status, createdAt (ISO), verified: boolean, parents: [...], kids: [...], kidsCount, governedKidsCount, preferredCount }`.

Tests (red-first): non-admin denied; admin gets seeded families with correct joins (parents, kids, counts); statusFilter works; searchQuery matches by family name AND by parent email; paging (limit 1 → hasMore true → cursor fetches the next); deleted family visible only with statusFilter 'deleted' or no filter (match listUsers semantics — read them and mirror; pin whichever it is).
Commit: `feat(shared-functions): admin listFamilies callable`

## Task 2: admin Families page

Files: `apps/web/src/pages/admin/FamiliesPage.tsx` (new), route + admin nav link (follow how UsersPage is routed/linked), `apps/web/src/stores/adminStore.ts` (add families state + fetchFamilies), tests `apps/web/src/pages/admin/__tests__/FamiliesPage.test.tsx`, i18n `admin.families.*` EN+FR.

UI (AdminUsersPage idioms):
- Search input + status filter (active/deleted) + verified filter; results as cards/rows: family name, address, verification badge, status badge, parent names+emails, kids summary ("3 kids: Léa (8), …"), counts (governed kids when > 0), createdAt.
- Expandable per-row detail (same pattern the page already uses if any; else a simple expand): full parent list with status, preferred babysitters count, link to the user in Users search (if a deep-link idiom exists; else omit).
- "Load more" paging via startAfterId; non-optimistic; loading/error/empty states per idiom.

Tests: callable name + payload pins (search/filters/paging args), rows render joined data, load-more appends, empty state, store runs against recording httpsCallable mock (repo idiom).
Commit: `feat(web): admin families page`

## Task 3: gates

`pnpm --filter web test && lint && build`; root typecheck; full integration + rules suite (callable touched shared-functions). Report per established format.

## Self-review notes

- Read-only v1 — NO mutations (no delete/edit family from this page); actions stay in Users/Verifications pages.
- The join must not explode reads: batched getAll for parents; kids reads bounded by page size.
- Mirror listUsers semantics wherever a choice exists (search impl, deleted visibility) — consistency beats novelty in the admin panel.
