# Agent 9 — Phase -1 UX Publish-Hide Alignment Check

**Overall verdict: PASS.** The UX hide cleanly aligns with the security-fix references-update rule. No remaining UI affordance for the `status → 'published'` transition that the rule denies.

**Reviewer:** agent-9-security
**Date:** 2026-05-15
**Branch under review:** `feature/sync-study-ux-publish-hide`
**HEAD reviewed:** `28e7687` (`hide publish buttons on EndorsementsPage — publishReference is denied by firestore.rules until a publish-callable lands`)
**Net diff:** 1 file, 0 insertions / 3 deletions (`apps/web/src/pages/babysitter/EndorsementsPage.tsx`)
**Specific question this review answers:** does the UI now offer no client-side path to the `status → 'published'` transition denied by the security-fix references-update rule (`feature/sync-study-security-fix` commit `1de176c`)?
**Dependency tracking:** closes the UX half of [BLOCK-LATER-6] (the missing publish callable itself remains BL-6 until a callable lands).

---

## 1. Spot-checks

### Q1 — JSX sites no longer pass `onPublish` → **PASS**

Diff at `apps/web/src/pages/babysitter/EndorsementsPage.tsx`:
- Line 370 (manual references list): `onPublish={() => publishReference(ref.referenceId)}` — **removed**.
- Line 387 (family-submitted references list): `onPublish={() => publishReference(ref.referenceId)}` — **removed**.
- Destructure at line 271: `publishReference,` — **removed**.

Verified by grep against the ux-publish-hide worktree:
```
grep -rn 'publishReference' .claude/worktrees/sync-study-ux-publish-hide/apps/web/src/pages/babysitter/EndorsementsPage.tsx
→ (no matches)
```
Both JSX sites are clean.

### Q2 — No other call site of `publishReference` → **PASS**

```
grep -rn 'publishReference' .claude/worktrees/sync-study-ux-publish-hide/apps/web/src/
→ apps/web/src/hooks/useEndorsements.ts:105:  const publishReference = useCallback(async (referenceId: string) => {
→ apps/web/src/hooks/useEndorsements.ts:125:    publishReference,
```
Two hits only — both inside `useEndorsements.ts`: the function definition (line 105) and its re-export from the hook (line 125). **Zero callers anywhere in the codebase.** The dormant placeholder (Q4 below) is the only thing that would attempt a client-side write, and nothing invokes it.

### Q3 — `unpublishReference` retention is correct → **PASS**

The security-fix references-update rule (`firestore.rules` of `feature/sync-study-security-fix` HEAD, lines 137-145) permits status writes only when:
```
!request.resource.data.diff(resource.data).affectedKeys().hasAny(['status'])
|| request.resource.data.status in ['private', 'removed']
```

`unpublishReference` at `useEndorsements.ts:112-116` writes:
```ts
await updateDoc(doc(db, 'references', referenceId), { status: 'private' });
```
`'private'` IS in the allowed set. The transition `published → private` is therefore a **legitimate, rule-permitted client path** and keeping the affordance is correct.

A subtler check: under the security-fix rules, the only way for a reference to be in `status: 'published'` going forward is if it was already in that state BEFORE security-fix lands (legacy data). The new create rule forces `status='private'` on every new reference, and the new update rule denies promotion to `'published'` from any client. So the unpublish button only ever surfaces on legacy-published references, all of which exist before the deploy. Unpublishing them — moving them from `'published'` to `'private'` — is the exact migration path a babysitter needs and is rule-permitted. ✓

The `ReferenceCard` component's render guard `{isPublished && onUnpublish && ...}` (line 103) correctly conditions on `isPublished`, so the unpublish button doesn't appear on `'private'` references where it would be a no-op.

### Q4 — Dormant `publishReference` export in the hook → **PASS** (with one non-blocking nit)

The dormant function at `useEndorsements.ts:105-110`:
```ts
const publishReference = useCallback(async (referenceId: string) => {
  await updateDoc(doc(db, 'references', referenceId), {
    status: 'published',
    approvedAt: serverTimestamp(),
  });
}, []);
```

Still attempts a client write of `status: 'published'`. Under the new references-update rule this write is **denied** (`'published'` is not in `['private', 'removed']`). The rule's deny is the **actual safety net**.

Behaviour if some future caller mistakenly invokes it:
- `updateDoc` rejects with a Firestore `permission-denied` error.
- No state changes.
- The promise rejects; if the caller doesn't handle the rejection, it surfaces as an uncaught promise rejection in the browser console.
- The reference document remains untouched.

**This is acceptable as a no-op-when-called state for security purposes** — the rule is the gate; defense-in-depth is preserved.

**Non-blocking nit (UX/maintainability, NOT security):** if a future developer wires this up to a UI element thinking it's functional, the failure surfaces only as a console error, not as a visible UI signal. Two cleaner alternatives:
- (a) Add an early throw inside the function: `throw new Error('publishReference is not yet implemented — pending the BL-6 publish callable; see docs/agent-runs/agent-9-security-baseline.md §7');` — fails fast at call site with a clear remediation pointer.
- (b) Delete the function entirely and re-add it (as a callable invocation) when the BL-6 publish callable lands — eliminates the placeholder ambiguity at the cost of a bigger BL-6 PR.

Either would slightly improve developer hygiene; **neither is required for security**. Flagging only because the rule layer is the only thing keeping this from regressing if someone accidentally re-wires it.

---

## 2. Whole-diff sweep

The diff is 3 lines deleted across one file — `EndorsementsPage.tsx` only. No other file changed. Confirmed:
- No change to `firestore.rules` or `storage.rules` ✓
- No change to any callable in `apps/functions/src/` ✓
- No change to `useEndorsements.ts` (the dormant publishReference + its re-export remain intact for BL-6) ✓
- No new client-side write site to any sensitive Firestore collection ✓
- The `unpublishReference`, `addManualReference`, `updateManualReference`, `removeReference` paths are all rule-permitted (status→`'private'`/`'removed'`, `type='manual'` create, content-only updates) ✓

---

## 3. Verdict

**PASS — UX publish-hide aligns with the security-fix references rule.** No client-side UI path remains for the `status → 'published'` transition the rule denies. The dormant hook export is acceptable as a placeholder (the rule denies it; defense-in-depth is preserved); a small developer-hygiene improvement is suggested as a non-blocking nit.

| Check | Verdict | Evidence |
|---|---|---|
| Q1 — JSX sites no longer pass `onPublish` | **PASS** | Two `onPublish=...` lines deleted at lines 370, 387; destructure at 271 cleaned. |
| Q2 — No other call site exists | **PASS** | `grep` returns only the dormant hook definition + re-export. |
| Q3 — `unpublishReference` retention correct | **PASS** | `status: 'private'` IS in the rule's allowed set; legacy-published references need this affordance to migrate. |
| Q4 — Dormant export is acceptable | **PASS** | The rule denies the write; defense-in-depth holds. Non-blocking hygiene nit recorded. |
| Whole-diff sweep | **PASS** | Single-file 3-line deletion; no rules/callable/sensitive-write changes. |

UX publish-hide may merge. BL-6 itself remains open until a publish callable lands (per the baseline §7 entry).
