# Agent 9 — Phase -1 Security-Fix Review

**Overall verdict: PASS.** All 4 BLOCK-LATER findings from the Phase 0 baseline are closed at the rules layer with no other collection's posture loosened.

**Reviewer:** agent-9-security
**Date:** 2026-05-15
**Branch under review:** `feature/sync-study-security-fix`
**HEAD reviewed:** `1de176c` (`tighten references update: lock identity tuple, block self-promotion`)
**Base:** `feature/sync-study-orchestration` @ `7eb83e7`
**Net diff:** +66 / -10 lines, `firestore.rules` only. No application code, no callable code, no client code modified.
**Baseline reference:** `docs/agent-runs/agent-9-security-baseline.md` §7, as amended by commit `36aa0c1` (BLOCK-LATER-2 split).

---

## 1. Per-finding verdicts

### BLOCK-LATER-1 — `families` doc has no field-level write guard → **PASS**

**Commit:** `48ee6b9` — `tighten families update rule: whitelist client-editable fields`

**Rule before** (`firestore.rules:43`):
```
allow update: if isFamilyMember(familyId);
```

**Rule after** (`firestore.rules:43-49` of security-fix HEAD):
```
allow update: if isFamilyMember(familyId)
              && request.resource.data.diff(resource.data).affectedKeys()
                  .hasOnly(['familyName', 'address', 'latLng', 'pets', 'note', 'photoUrl', 'updatedAt']);
```

**Verification — auth-bypass closed:**
The previous bypass route was: a parent uses the client SDK to write `verification.isFullyVerified=true`, then calls `searchBabysitters` (which gates on `verification.isFullyVerified`) to extract babysitter contact info. The new whitelist `hasOnly(['familyName','address','latLng','pets','note','photoUrl','updatedAt'])` denies every mutation outside that set, so any client-side write to `verification.*`, `parentIds`, `preferredBabysitters`, `searchDefaults`, `status` now fails. ✓

**Verification — no legitimate write site is broken:**
Grepped for `updateDoc(doc(db, 'families', ...))` across `apps/web/src/`. The only client-side write to a `families/{familyId}` doc is `apps/web/src/pages/family/FamilySettingsPage.tsx:126-134`, which writes exactly the seven whitelisted fields:
```
await updateDoc(doc(db, 'families', familyId), {
  familyName,
  address,
  latLng: latLng || null,
  pets: pets || null,
  note: note || null,
  photoUrl,
  updatedAt: serverTimestamp(),
});
```
Every server-side mutation (`enrollFamily`, `joinFamily`, `removeCoParent`, `addPreferredBabysitter`, `removePreferredBabysitter`, `submitVerification`, `reviewVerification`, `approveCommunityCode`) goes through the Admin SDK, which bypasses Firestore rules. ✓

### BLOCK-LATER-2 — `users` doc owner-update doesn't block `approvedFamilies` → **PASS**

**Commit:** `f6e8fc7` — `tighten users update rule: block client writes to approvedFamilies`

**Rule before** (`firestore.rules:36`):
```
.hasAny(['role', 'status', 'uid', 'email', 'ejemEmail', 'createdAt']);
```

**Rule after** (`firestore.rules:46-48`):
```
.hasAny(['role', 'status', 'uid', 'email', 'ejemEmail', 'createdAt',
         'approvedFamilies']);
```

**Verification — GDPR-audit bypass closed:**
The previous bypass was: a babysitter overwrites `users/{uid}.approvedFamilies` directly via client SDK, granting/revoking contact-sharing without going through `respondToContactSharing` (the only path that writes `auditLogs` entries for the consent change). Adding `approvedFamilies` to the `hasAny()` list makes any owner-update touching it deny. The only remaining write path is the Admin SDK call inside `respondToContactSharing` itself. ✓

**Verification — `searchable` correctly NOT added (per WORKING-AS-INTENDED-1):**
Confirmed `searchable` is not in the new blocklist. The commit message documents the product-owner decision and matches `[WORKING-AS-INTENDED-1]` in the amended baseline §7. ✓

**Verification — no other writable user field is broken:**
Other owner-writable fields (`firstName, lastName, phone, whatsapp, photoUrl, dateOfBirth, gender, classLevel, languages, aboutMe, kidAgeRange, maxKids, hourlyRate, areaMode, areaLatLng, areaRadiusKm, contactEmail, contactPhone, fcmTokens, notifPrefs, language, searchable, enrollmentComplete, updatedAt`) remain client-writable as before. ✓

### BLOCK-LATER-3 — `references` rule lets any auth user create a reference about themselves → **PASS** (with carry-over noted as new BLOCK-LATER)

**Commit:** `6ecbaf6` — `tighten references create: force private status, block self-puffery`

**Rule before** (`firestore.rules:81-84`):
```
allow create: if isAuth() && (
  request.resource.data.babysitterUserId == request.auth.uid
  || request.resource.data.submittedByUserId == request.auth.uid
);
```

**Rule after** (`firestore.rules:99-124` of security-fix HEAD):
```
allow create: if isAuth()
  && request.resource.data.status == 'private'
  && (
    (
      request.resource.data.babysitterUserId == request.auth.uid
      && request.resource.data.type == 'manual'
      && (!('submittedByUserId' in request.resource.data)
          || request.resource.data.submittedByUserId == null)
    )
    || (
      request.resource.data.submittedByUserId == request.auth.uid
      && request.resource.data.babysitterUserId != request.auth.uid
      && request.resource.data.type == 'family_submitted'
    )
  );
```

**Verification — fraud vector closed at the rules layer:**
- Self-puffery via `family_submitted` is denied: the second branch requires `babysitterUserId != request.auth.uid`. ✓
- Submitter-impersonation as oneself is denied: the second branch requires `submittedByUserId == request.auth.uid` AND `babysitterUserId != request.auth.uid`. ✓
- Initial fraud via direct `status='approved'` or `status='published'` on create is denied: the rule forces `status == 'private'`. Combined with `searchBabysitters` filtering on `status in ['approved','published']`, no newly-created reference can surface in search until something other than the create path promotes it (and the update rule from commit #4 also denies that promotion from any client). ✓

**Verification — no legitimate create site is broken:**
- `apps/web/src/components/endorsements/EndorsementDialog.tsx:115-133` (parent endorses babysitter): writes `type: 'family_submitted', status: 'private', babysitterUserId, submittedByUserId: parent.uid`. Caller is the parent, target is a babysitter. Matches the second branch exactly. The follow-up `updateDoc(ref, { referenceId: ref.id })` at line 134 also passes the new update rule (`referenceId` is not in the identity-tuple lock list, the caller is the submitter). ✓
- `apps/web/src/hooks/useEndorsements.ts:72-78` (`addManualReference`, babysitter records own offline reference): writes `babysitterUserId: uid, type: 'manual', status: 'private'` with no `submittedByUserId`. Matches the first branch exactly. ✓ (Note: the hook spreads `...cleaned` AFTER `status: 'private'`, so a typed `ManualRefInput` cannot contain a `status` field that would override; an attacker bypassing TypeScript and injecting `status: 'approved'` into the spread would be caught by the rule's `status == 'private'` check.)

**Carry-over → new finding `[BLOCK-LATER-5]`:**
The rule cannot verify the submitter's relationship to the babysitter (no shared-appointment lookup expressible in Firestore rules). A malicious parent can still create `family_submitted` references for arbitrary babysitters they have never interacted with — they just can't promote them to surface state from the client. Combined with the carry-over from BL-4 below, the worst remaining scenario is: parent A creates a `private` family_submitted reference about babysitter B with libelous content; B can read it (every auth user can read any reference) and remove it (status='removed' transition is allowed for B as the babysitterUserId-owner). So the BL-3 fraud-into-search vector is closed, but the spam/libel vector at create time remains until the proposed callable lands. The security-fix commit msg explicitly tracks this. Recommend recording as a new baseline entry on the next baseline amendment.

### BLOCK-LATER-4 — `references` rule allows any auth user to forge endorsements as themselves → **PASS** (with carry-over noted as new BLOCK-LATER)

**Commit:** `1de176c` — `tighten references update: lock identity tuple, block self-promotion`

**Rule before** (`firestore.rules:85-88`):
```
allow update: if isAuth() && (
  resource.data.babysitterUserId == request.auth.uid
  || resource.data.submittedByUserId == request.auth.uid
);
```

**Rule after** (`firestore.rules:125-145`):
```
allow update: if isAuth()
  && !request.resource.data.diff(resource.data).affectedKeys()
       .hasAny(['babysitterUserId', 'submittedByUserId', 'type', 'createdAt'])
  && (
    resource.data.babysitterUserId == request.auth.uid
    || resource.data.submittedByUserId == request.auth.uid
  )
  && (
    !request.resource.data.diff(resource.data).affectedKeys().hasAny(['status'])
    || request.resource.data.status in ['private', 'removed']
  );
```

**Verification — promotion-to-search fraud vector closed:**
- Identity tuple `(babysitterUserId, submittedByUserId, type, createdAt)` cannot change after create — prevents transferring an endorsement to a different babysitter post-create or laundering identity. ✓
- Status can only be set to `'private'` or `'removed'`. Promotion to `'approved'` or `'published'` is denied — the path through which a reference could appear in `searchBabysitters` results is now exclusively server-side. ✓

**Verification — no legitimate update site is broken:**
- `apps/web/src/hooks/useEndorsements.ts:84-86` (`removeReference`): writes `status: 'removed'`. ✓ Allowed transition.
- `apps/web/src/hooks/useEndorsements.ts:100` (`updateManualReference`): writes content fields, no status change, no identity-tuple change. ✓
- `apps/web/src/hooks/useEndorsements.ts:113-115` (`unpublishReference`): writes `status: 'private'`. ✓ Allowed transition.
- `apps/web/src/components/endorsements/EndorsementDialog.tsx:104-113` (edit existing): content fields + `updatedAt` only. ✓
- `apps/web/src/pages/family/SubmittedEndorsementsPage.tsx:57-60`: `status: 'removed', updatedAt`. ✓

**Acknowledged collateral — `useEndorsements.ts:105-110` `publishReference()` is broken:**
Writes `status: 'published'`. The new rule denies. This call site is reached from `apps/web/src/pages/babysitter/EndorsementsPage.tsx:370` and `:387` (the babysitter's "Publish" buttons in two list locations). The commit message acknowledges this explicitly: "publishReference() (which flipped status to 'published' from the client) no longer works. This was the fraud vector; killing it IS the fix." Confirmed. The buttons will silently fail until the proposed publish-callable lands. **Not a regression, intentional.**

**Carry-over → new finding `[BLOCK-LATER-6]`:**
Restoring the legitimate manual-reference publish flow needs a callable with admin or peer-approval gating. The current state is "no client path can promote to published," which means the only way a manual reference surfaces in search is via Admin SDK writes — which no callable currently does. Recommend recording as a new baseline entry on the next baseline amendment, and noting that the babysitter UI should hide the publish button until the callable exists (otherwise users will click it and see no effect). UX cleanup is out of Agent 9's scope; flagging for product-owner.

### BLOCK-LATER-2's `searchable` half (previously expected close, now WORKING-AS-INTENDED) → **PASS by design**

`searchable` is correctly absent from the new `users` blocklist. Behaviour matches `[WORKING-AS-INTENDED-1]` in the amended baseline §7 and the security-fix commit message explicitly references the product-owner decision. ✓

---

## 2. Whole-rules-file regression sweep

I read the resulting `firestore.rules` end-to-end. Confirmed every other collection block (`users` read posture, `families/kids`, `schedules`, `searches`, `appointments`, `notifications`, `inviteLinks`, `verificationCodes`, `holidays`, `auditLog`, `contactSharingRequests`, default-deny tail) is byte-for-byte identical to the Phase 0 baseline state. **No other rule was loosened or tightened in this commit set.** ✓

---

## 3. `firebase-security-rules-auditor` — independent self-audit

Ran the auditor against the resulting `firestore.rules`. Skill returned **score 3 (Moderate)** for the rules file as a whole — the security-fix delta is solid PASS, but the file retains pre-existing moderate issues outside this review's scope:

**Moderate-severity, pre-existing, NOT introduced by security-fix:**
- `users` read posture leaks babysitter PII (DOB, phone, contact fields) to every authenticated user.
- `references` read posture leaks parent PII (refPhone, refEmail, refWhatsapp) to every authenticated user.
- `references` update lets the babysitter (target) tamper with the body fields of a parent's endorsement (status is now locked, content is not).

**Minor-severity, pre-existing, NOT introduced by security-fix:**
- No type checks (`is string`, `is int`) anywhere in the file.
- No size caps on user-writable strings (`referenceText`, `aboutMe`, `familyName`, `note`, `pets`, `address` — all unbounded).
- `users.fcmTokens` owner-writable with no validation (self-leak vector via push.ts).
- Dead `auditLog` (singular) rule.

These are recorded in the Phase 0 baseline §7 (or implicit in §3's "no field-level guard" / "any auth user can read" notes) and are appropriately deferred to Phase 4 when Agent 6 owns the rules update. **Not BLOCKED for this security-fix review.**

---

## 4. Decision on note (2) — rules-test harness

Security-fix flagged: no `@firebase/rules-unit-testing` harness exists, syntax verification was via emulator-boot only. Asked me to surface this as `[WATCH]` or `[BLOCK-LATER]`.

**Decision: `[WATCH]` — accept the gap for Phase -1, recommend the harness for Phase 1+.**

Rationale:
1. The security-fix is a rule-only change with two independent verification paths: (a) emulator-boot parse (security-fix's offline check) and (b) my line-by-line read with cross-check against actual client write sites (this review). The combination provides reasonable confidence for a rule change of this size (+66 / -10).
2. Standing up `@firebase/rules-unit-testing` is best-practice infrastructure that would block Phase -1 unnecessarily — it's a separate piece of work that deserves its own task and its own scope.
3. Future BLOCK-LATER fixes (BL-5, BL-6, anything Phase 4 surfaces) WILL benefit from the harness existing. **Recommend it land before Phase 4** (when Agent 6 makes the next big rules pass).

`[WATCH]` flag for the standing review checklist:
> **WATCH:** No `@firebase/rules-unit-testing` harness exists. Every rule-change PR after Phase -1 (especially the Phase 4 Agent-6 firestore.rules update) should either (a) land alongside a harness setup, or (b) document the manual verification path used and explicitly accept the gap. Recommend tracking under Phase 1+ infrastructure work.

---

## 5. New BLOCK-LATER findings introduced in this review

Two new entries surfaced by closing BL-3 / BL-4. Recommend the next baseline amendment record them:

- **`[BLOCK-LATER-5]`** — `references` create rule cannot verify submitter↔babysitter relationship. The rule layer cannot express "the submitter has a confirmed appointment history with the babysitter." Spam/libel reference creation remains possible (private status only — won't surface in search, but readable by all auth users including the targeted babysitter). Fix: route reference creates through a callable that validates relationship via `appointments` lookup.
- **`[BLOCK-LATER-6]`** — No path currently exists to promote a manual reference to `'published'`. The publish-from-client flow was the BL-4 fraud vector and was correctly killed; the legitimate use case (admin-approved or peer-approved manual-reference publish) needs a callable. Fix: add a `publishReference` callable with admin role check OR peer-approval gating. Until then, hide the babysitter-UI publish buttons (`apps/web/src/pages/babysitter/EndorsementsPage.tsx:370,387`) to avoid silent click failures.

---

## 6. Overall verdict

**PASS — security-fix may merge.**

| Finding | Verdict | Notes |
|---|---|---|
| BLOCK-LATER-1 (families update) | **PASS** | Whitelist correctly bounds client writes; no legitimate write site broken. |
| BLOCK-LATER-2 (approvedFamilies) | **PASS** | Blocklist addition correctly closes the GDPR-audit bypass; `searchable` correctly excluded per WORKING-AS-INTENDED-1. |
| BLOCK-LATER-3 (references self-puffery) | **PASS** | Rule-layer fraud vector closed; spam/libel residual surfaced as new [BLOCK-LATER-5]. |
| BLOCK-LATER-4 (references promotion) | **PASS** | Identity tuple locked, status promotion blocked; legitimate publish path surfaced as new [BLOCK-LATER-6]. |
| Whole-file regression | **PASS** | No other collection's posture loosened. |
| `firebase-security-rules-auditor` independent run | **PASS for delta** | Score 3 overall reflects pre-existing posture, not security-fix regressions. |
| Test-harness gap | **WATCH** | Acceptable for Phase -1; required for Phase 4. |

No remediation required from security-fix. The two new BLOCK-LATER items (BL-5, BL-6) and the test-harness WATCH are forward-looking recommendations, not blocks for this merge.
