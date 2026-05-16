# Agent 9 — Phase -1 Lint-Cleanup Light Security Review

**Overall verdict: PASS.** The 42-file typing + small-bug-fix pass introduces no security regressions. All five spot-check areas verified clean.

**Reviewer:** agent-9-security
**Date:** 2026-05-15
**Branch under review:** `feature/sync-study-lint-cleanup`
**HEAD reviewed:** `2f4ceb6` (`fix PhoneInput set-state-in-effect, TopNav statement-ternary, sw.js stale directive`)
**Base:** `feature/sync-study-orchestration` @ `7eb83e7`
**Net diff:** +410 / -222 lines across 42 files (web client only — no rules, no callables, no shared types).
**Scope:** light security pass per team-lead Gate-3 work order.

---

## 1. Spot-check by area

### Area 1 — Defensive Firestore-read checks dropped → **CLEAN**

Examined every place an `(x as any)?.field?.length > 0` or `(x as any).field` pattern was retyped. In every case the new code preserves or strengthens the runtime check:

- **`apps/web/src/pages/babysitter/AccountPage.tsx:143-156`** (`dobDisplay`): old code was `typeof (dob as any).toDate === 'function'` — would throw `TypeError: cannot read 'toDate' of null` if `dob` were null and survived the truthy outer check. New code: `typeof dob === 'object' && dob !== null && 'toDate' in dob && typeof (dob as { toDate: unknown }).toDate === 'function'`. **Strictly stronger** runtime guard.
- **`apps/web/src/pages/admin/VerificationsPage.tsx:166-175`**: `(v as any).familyParentNames?.length > 0` → `(v.familyParentNames?.length ?? 0) > 0`. Functionally identical (`undefined > 0` → `false` either way; the new form is just nullish-explicit).
- **`apps/web/src/pages/babysitter/RequestDetailPage.tsx:208-212, 234-235`**: `apt.modifiedFields?.length > 0` → `(apt.modifiedFields?.length ?? 0) > 0`; same for `recurringSlots`. Same logic.
- **`apps/web/src/pages/admin/AuditLogPage.tsx:84-100`** (`formatTs`): added an explicit fallback branch that returns `'—'` for unknown timestamp shapes instead of falling through to `new Date(ts)` (which would have produced `Invalid Date` on weird inputs). **Slightly safer** than before.
- **`apps/web/src/pages/family/DashboardPage.tsx:198, 344-352`** (kid-add flow + `familyId` derive): `(userDoc as any).familyId` → `userDoc?.role === 'parent' ? userDoc.familyId : null` and `if (userDoc?.role !== 'parent' || !userDoc.familyId) return`. **Strictly stronger** — adds an explicit role-discriminator check that the `as any` cast bypassed.

No defensive check was weakened. ✓

### Area 2 — Callable params/return retyping that loosens authz contracts → **CLEAN**

Examined every `httpsCallable<Req, Res>` annotation introduced and cross-checked the `Res` shape against the actual server return statement.

| Callable | Type added | Server return verified | Verdict |
|---|---|---|---|
| `getAdminDashboard` | `Record<string, never>, AdminStatsWithVerifications` | `apps/functions/src/admin/getAdminDashboard.ts:33-38` | ✓ shape matches (4 counts) |
| `listUsers` | `{searchQuery?, roleFilter?, statusFilter?}, {users: AdminUserListItem[]}` | `apps/functions/src/admin/listUsers.ts:76` | ✓ matches |
| `listAppointments` | `{statusFilter?}, {appointments: AdminAppointmentListItem[]}` | `apps/functions/src/admin/listAppointments.ts:135-138` | ✓ matches; the e3ad304 follow-up correctly fixed an initial mismatch (`parentName` → `parentNames`) and made `babysitterUserId/parentUserId/familyId` optional to match the wire reality |
| `listAuditLogs` | `{actionFilter?}, {logs: AdminAuditLogEntry[]}` | `apps/functions/src/admin/listAuditLogs.ts:86` | ✓ e3ad304 introduced `AdminAuditLogEntry` distinct from shared `AuditLogDoc` to model the wire-only enrichment (`adminInfo`, `targetInfo`, `id`, serialized `timestamp`) — accurate |
| `exportUserData` | `{targetUserId}, GdprExportData` | `apps/functions/src/admin/exportUserData.ts:98-105` | ✓ matches (`user, family, appointments, notifications, auditLogs`) |
| `listPreapprovedEmails` | `Record<string, never>, {emails: PreapprovedEmail[]}` | `apps/functions/src/admin/managePreapprovedEmails.ts:75-83` | ✓ matches |
| `getVerificationStatus` | `Record<string, never>, {verification, documents}` | `apps/functions/src/verification/getVerificationStatus.ts:48` | ✓ matches |
| `listPendingVerifications` | `{statusFilter?, typeFilter?}, {verifications: VerificationDoc[]}` | `apps/functions/src/verification/listPendingVerifications.ts:117` | ✓ matches; extended local `VerificationDoc` to include enriched `familyParentNames/familyKids` (server enriches per `listPendingVerifications.ts:74-100`) |
| `generateCommunityCode` | `Record<string, never>, {code, expiresAt}` | `apps/functions/src/verification/generateCommunityCode.ts:62` | ✓ matches |
| `lookupCommunityCode` | `{code}, {familyName, firstName, lastName, familyId}` | `apps/functions/src/verification/lookupCommunityCode.ts:64-69` | ✓ matches |
| `getVerificationDocument` | `{filePath}, {url}` | `apps/functions/src/verification/getVerificationDocument.ts:65` | ✓ matches |
| `lookupBabysitter` | `{query}, {results?: BabysitterSummary[]}` | `apps/functions/src/family/lookupBabysitter.ts:86` | ✓ matches |
| `getParentContacts` | `{appointmentId}, {contacts?: [...]}` | `apps/functions/src/appointments/getParentContacts.ts:47-54` | ✓ matches |

**No callable type CLAIMS more than the server actually returns.** This means no client-side code path now reads a field it shouldn't trust — every typed field the client now believes exists really does come back from the server. The opposite case (server returns a field the client type doesn't model) only causes that field to appear as undefined in the UI — not a security concern.

The catch-block narrowing pattern (`catch (err: any) → catch (err: unknown)` with `err instanceof Error ? err.message : 'fallback'`) appears in 25+ sites. Behavior is identical for the common case (real Error throws); for the obscure case where a non-Error was thrown, the new code renders a sensible fallback string instead of `undefined`. **Slightly more robust, not less.** ✓

### Area 3 — Store/auth path widening for unauthenticated callers → **CLEAN**

Examined `apps/web/src/stores/authStore.ts` and `apps/web/src/hooks/{useAppointments,useEndorsements,useFamilyAppointments,useSchedule,useSubmittedEndorsements}.ts`.

**`authStore.ts`:** Two `catch (err: any)` blocks narrowed (login, password-reset). No change to the auth-state shape, no change to the `loading: false` set on success, no change to who can read what. The fallback messages now display as `'Login failed'` / `'Failed to send reset email'` instead of `undefined` when a non-Error is thrown — purely UX. ✓

**Five snapshot hooks (`77eb960`):** The pattern change `useState(true) + useEffect{ if(!uid) setLoading(false) }` → `useState(Boolean(uid)) + useEffect{ if(!uid) return }` was checked carefully:
- **Present-uid path:** identical — initial render `loading=true`, snapshot callback flips to `false` once data arrives.
- **Absent-uid path:** initial render now `loading=false` directly, instead of `loading=true` for one render then `loading=false`. This eliminates a brief one-frame flash. **Does not widen authorization** — pages consuming these hooks still gate their authenticated-user content on the presence of `uid` itself (or `userDoc.role === ...`), not on `hookLoading === true`. The hook's `loading` flag is for "data still streaming," not for "user not yet known."
- The two `(apt as any).resubmitted` casts (in `useAppointments.ts:38` and `useFamilyAppointments.ts:39`) replaced by widening the local snapshot type to `AppointmentDoc & { resubmitted?: boolean }`. The `resubmitted` field is set server-side at `apps/functions/src/appointments/resubmitAppointment.ts:117` (`batch.update(originalRef, { resubmitted: true })`). Cast grounded in real server behavior. ✓

No path widens what an unauthenticated caller can do. ✓

### Area 4 — `as Foo` casts that bypass type safety → **CLEAN**

Inventoried every new local view-type and verified each cast is grounded in a real server-side write or a real Firestore-storage shape.

| New local type | File | Grounded in |
|---|---|---|
| `EnrichedAppointment = AppointmentDoc & { familyName?, familyPhotoUrl?, kids?, pets?, familyNote? }` | `apps/web/src/pages/babysitter/RequestDetailPage.tsx` | `apps/functions/src/search/sendContactRequest.ts:101-122` denormalizes all five fields onto the appointment doc at create. ✓ |
| `AdminAppointmentListItem` (with `parentNames?, offeredRate?, babysitterName?, familyName?`) | `apps/web/src/stores/adminStore.ts` | `apps/functions/src/admin/listAppointments.ts:119-135` enriches all listed fields. ✓ |
| `AdminAuditLogEntry` (`id, adminInfo, targetInfo, timestamp: WireTimestamp`) | `apps/web/src/stores/adminStore.ts` | `apps/functions/src/admin/listAuditLogs.ts:70-86` enriches and serializes all listed fields. ✓ |
| `WireTimestamp` (string \| `{_seconds, _nanoseconds?}` \| `{seconds, nanoseconds?}`) | `apps/web/src/stores/adminStore.ts` | Honest union of the three shapes the Firebase callable serializer produces. Discriminated check `('_seconds' in ts && ts._seconds != null)` is correct. ✓ |
| `PreapprovedEmail` (`email, used, createdAt: FirestoreTimestamp \| null`) | `apps/web/src/stores/adminStore.ts` | `apps/functions/src/admin/managePreapprovedEmails.ts:75-83` returns this shape. ✓ |
| Extended `VerificationDoc` (`+ familyParentNames?, familyKids?`) | `apps/web/src/stores/verificationStore.ts` | `apps/functions/src/verification/listPendingVerifications.ts:74-100` enriches both fields per family. ✓ |
| `ParentUserView = ParentUser & { phone?, whatsapp?, photoUrl? }` | `apps/web/src/pages/family/AccountPage.tsx` | All three fields are written to parent user docs by the parent's own profile-edit flow (this same file's contact form). Production data confirms. ✓ |
| `ParentUserWithContact = ParentUser & { phone?, whatsapp? }` | `apps/web/src/components/endorsements/EndorsementDialog.tsx` | Same justification as above. ✓ |
| `AppointmentWithFamily = AppointmentDoc & { familyName?, familyPhotoUrl? }` | `apps/web/src/components/appointments/AppointmentCard.tsx` | Same denormalization as `EnrichedAppointment` source. ✓ |
| `AppointmentDoc & { resubmitted?: boolean }` | `apps/web/src/hooks/{useAppointments, useFamilyAppointments}.ts` | `apps/functions/src/appointments/resubmitAppointment.ts:117`. ✓ |
| `EnrichedAppointment` snapshot cast `snap.data() as EnrichedAppointment` | `RequestDetailPage.tsx:56` | Cast at the Firestore-read boundary, fields known to exist on docs created by `sendContactRequest`. Safe. ✓ |

**Every new local view-type honestly models a wire/storage reality.** None of the casts coerce a field into existence that the server doesn't actually return. None of the casts widen authority — they merely narrow the local `unknown`/`any` placeholder into a structured shape.

**Note (typing-debt observation, not a security issue):** Several of these local types (`ParentUserView`, `ParentUserWithContact`, the extended `VerificationDoc`, `AppointmentDoc & { resubmitted? }`) document fields that exist in production but are not yet on the canonical `@ejm/shared` types. Promoting these to `@ejm/shared` would let multiple call sites share one definition. Out of scope for this lint-cleanup pass; flagging for a future shared-types pass (probably Phase 2 — Agent 1's territory).

### Area 5 — PhoneInput rewrite → **CLEAN**

`apps/web/src/components/forms/PhoneInput.tsx` (commit `2f4ceb6`):

**Old structure:** `useState(parsePhone(value).countryCode)` + `useState(parsePhone(value).number)` + `useEffect(() => { setCountryCode(p.countryCode); setNumber(p.number); }, [value])` — derived state mirrored from props via effect (the classic React anti-pattern; trips the `set-state-in-effect` lint rule).

**New structure:** `const { countryCode, number } = parsePhone(value);` — derived directly each render. Fully controlled component.

**Behavior verification — change-by-change:**

1. **`handleCountryChange`:** Old: `setCountryCode(code); onChange(formatFullNumber(code, number));`. New: `onChange(formatFullNumber(code, number));`. The removed `setCountryCode(code)` was redundant local mirroring; the next render re-derives `countryCode` from the just-pushed `value`. ✓
2. **`handleNumberChange`:** Old: `if (cleaned.startsWith('0') && countryCode === '+33') cleaned = cleaned.slice(1); setNumber(cleaned); onChange(formatFullNumber(countryCode, cleaned));`. New: removes only `setNumber(cleaned)`; **the leading-zero stripping conditional is byte-for-byte identical**, the country-code parsing in the unchanged `parsePhone()` is also byte-for-byte identical. ✓
3. **`parsePhone()` and `formatFullNumber()` — unchanged.** I confirmed by reading the diff: only the bottom-of-file barrel export of those two functions plus `COUNTRY_CODES` was removed. The functions themselves were untouched.
4. **Barrel-export removal verified safe via grep:**
   ```
   grep -rn "parsePhone\|formatFullNumber\|COUNTRY_CODES" apps/web/src | grep -v PhoneInput.tsx
   → (no matches)
   ```
   No external consumer ever imported these three exports. The four importers of `PhoneInput` (`AccountPage.tsx` ×2, `EndorsementDialog.tsx`, `StepPreferences.tsx`) only import the `PhoneInput` named export. ✓

**Input sanitization preserved:** the leading-zero stripping for FR numbers (`+33`) is the only sanitization the old component did, and it remains in the new `handleNumberChange`. There was never any country-code parsing in `handleNumberChange` itself (parsing happens in `parsePhone(value)` on next render — also unchanged). The agent's claim "behavior is identical" is verified true. ✓

---

## 2. Out-of-list small bug fixes — also clean

- **`apps/web/src/components/ui/TopNav.tsx`** — rewritten ternary-as-statement into if/else. Identical condition (`window.history.state?.idx > 0`), identical branches (`navigate(-1)` vs `navigate('/')`). ✓
- **`apps/web/public/firebase-messaging-sw.js`** — removed stale `/* eslint-disable no-undef */` directive (the directive was producing an "Unused-disable" warning under current eslint config). Pure comment removal. No code change. ✓

---

## 3. Whole-diff sweep for things to flag

- **No production behavior change at the auth/PII/Firestore-read seams.** ✓
- **No casts that bypass real type safety.** Every cast is a type assertion on top of a known wire/storage shape. ✓
- **No widening of authorization.** Where the casts went `(userDoc as any)` → role-discriminated narrows, the new code is strictly stricter. ✓
- **No new client-side write site to a sensitive Firestore collection.** Confirmed by reviewing every `updateDoc`/`addDoc` change site listed in the diff stat — all are typing changes only.
- **No change to any rules-related path** (`firestore.rules`, `storage.rules`, `firebase.json` are not in the diff). The security-fix branch's rule changes remain the only rules movement in flight; they will stack cleanly on top of this lint-cleanup at merge time.

---

## 4. Overall verdict

**PASS — lint-cleanup may merge.**

| Area | Verdict | Evidence |
|---|---|---|
| 1. Defensive checks dropped | **PASS** | Every retyped check preserves or strengthens the runtime guard. |
| 2. Callable param/return retyping | **PASS** | All 13 newly-typed callables verified against server return shapes. |
| 3. Store/auth path widening | **PASS** | authStore catch-narrow is strictly safer; hooks loading-state change does not affect any authorization gate. |
| 4. `as Foo` casts | **PASS** | All 11 new local view-types verified grounded in real server writes or storage shapes. |
| 5. PhoneInput rewrite | **PASS** | Behavior identical (verified change-by-change); leading-zero sanitization preserved; barrel-export removal safe (no external consumers). |
| Whole-diff sweep | **PASS** | No rule changes, no callable changes, no new sensitive write sites. |

**One follow-up recommendation (not blocking):** several local view-types (`ParentUserView`, `ParentUserWithContact`, the extended `VerificationDoc`, `AppointmentDoc & { resubmitted? }`, `AppointmentWithFamily`) document the production-but-not-shared reality. Phase 2 (Agent 1 — `packages/shared/`) is the natural moment to promote these to canonical `@ejm/shared` types so multiple call sites share one definition.

No remediation required. Lint-cleanup may merge as-is.
