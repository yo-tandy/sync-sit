# Issue #440: parent enrollment redesign — Spec and PR ladder

> Status: **spec with stated defaults**, written 2026-09-16 from an audit of both
> live parent wizards. The owner asked for the scope to be settled in this ticket
> rather than folded into #435; the five decisions below are taken as defaults
> (the recommendation posted on the issue on 2026-09-10) so the work can ship as
> reviewable PRs. Every default is marked **[default — flip here]**; changing one
> changes only the PR(s) named next to it.

## 1. What exists today

Both apps run a four-step wizard at `/enroll/parent` against the same backend
(`verifyParentEmail` → `verifyCode` → `enrollFamily`). They were written a month
apart and have drifted:

| | `apps/web` (sit) `pages/enrollment/ParentEnrollment.tsx` | `apps/study-web` `pages/enrollment/parent/ParentEnrollment.tsx` |
|---|---|---|
| Email step | local `StepParentEmail` (any-domain email) | local `StepParentEmail` (copy of sit's) |
| Verify step | **local `StepParentVerify`** — untranslated English copy ("Check your email", "Resend code"), a duplicated "✓ Code verified" line | shared `StepVerify` |
| Password step | **local `StepParentPassword`** — 8 chars only | shared `StepPassword` — upper/lower/digit + consent |
| Consent | checkbox on the **family step**; no `consentVersion` sent (server default) | on the **password step**; `consentVersion` sent |
| Family step | local `StepFamilyInfo` (`@/components/ui`, which re-exports shared-ui) | local `StepFamilyInfo` (`@ejm/shared-ui`), controlled |
| Kids | `kids: []`; `StepKids.tsx` exists but is **unwired (dead code)** | `kids: []`; managed at `/family/settings` |
| `searchDefaults` | in form state, never collected, sent as `{}` | not sent |
| `role-exclusive` error | not mapped | mapped to `signup.roleExclusiveParent` |
| Step indicator | 4 dots over all steps | 3 dots over the credential steps only |
| Add-profile entry | jumps to family step (consent there) | jumps to consent-only password step |
| i18n | flat `enrollment.*` (`readyLoginTitle`…) | nested `enrollment.parent.*` for the same strings |
| `language` on the new user doc | hardcoded `'en'` (fixed by **#511**) | hardcoded `'en'` (fixed by **#511**) |

Both share, verbatim, the reviewed post-enrollment machinery (best-effort sign-in,
`passesParentGuard` settle wait, account-ready fallback, orphan-profile guards).
That part is not redesigned; it moves as-is.

The unified student flow (#435) is the visual and structural reference:
`StepEmail → StepVerify → StepPassword → StepBasicInfo → StepContactInfo →
StepAdditionalInfo`, all from `@ejm/shared-ui/enrollment`, gray ground,
`StepIndicator` over every step.

### Audit findings (fixed by this ladder regardless of the decisions)

- **F1** sit's verify step is untranslated and duplicated; the shared step exists.
- **F2** password rules differ for the same account type (8 chars vs. the shared policy).
- **F3** consent is collected on different steps; sit never sends `consentVersion`.
- **F4** `users.language` hardcoded `'en'` → **#511** (open PR). Post-enrollment sync gap → **#512**.
- **F5** `role-exclusive` unmapped on sit: a babysitter account visiting `/enroll/parent` gets a raw message.
- **F6** dead `StepKids.tsx` and the unused `searchDefaults`/`consentAccepted`/`consentChildrenAccepted` form fields on sit.
- **F7** i18n namespace split for identical strings.

## 2. Decisions (defaults)

**D1 — Scope: both content and visual.** [default — flip here: "visual only" drops
the F-items above from PR2/PR3; "content only" keeps the local step files.]
Content = the F-items + the field decisions below. Visual = the shared step
components, the gray ground, `StepIndicator` across all four steps (the student
wizard convention, not study's three-dot variant).

**D2 — One flow, hosted per app.** [default — flip here: see §5 "hosting flip".]
"One flow" is achieved at the component level: one set of shared step components
in `@ejm/shared-ui/enrollment` and two thin orchestrators that differ only in
`app` hint, brand mark, notes-label copy and post-login destination. Hosting
stays per app because (a) #435 PR5 deliberately kept `/enroll/parent` reachable
on study as a continuation route, (b) a parent's app choice is implicit in where
they came from — unlike students, parents never need the choose-app screen (the
parent profile is already shared cross-app), and (c) moving hosting to sit would
add a parent-flavoured `ChooseAppPage` + handoff state for no field savings.
If sync-do ever needs a third copy of the orchestrator, revisit (§5).

**D3 — Fields: keep the current set; add nothing user-visible.** [default — flip
here: additions land in PR1's `StepFamilyInfo`.] Identity (first name, optional
last name), family name, address (autocomplete, geocoder postcode/city ride
along), pets, notes. Not added: phone / WhatsApp / contact-visibility consent —
parents are not searchable, contact details are exchanged through contact
requests, and `familyEnrollmentSchema` has no such fields. Dropped: nothing the
user sees; the never-collected `searchDefaults` and sit's two extra consent
booleans go (F6). `language` is sent (F4, #511).

**D4 — Kids: deferred to the dashboard.** [default — flip here: "inline" would
resurrect `StepKids` as a shared step in PR1.] Both apps already send `kids: []`
and manage children at `/family/settings` (`FamilySettingsPage` in both apps).
PR2 deletes sit's dead `StepKids.tsx`.

**D5 — Verification stays post-enrollment.** [default — flip here: would add an
upload step after family info in PR2.] `/family/verification` remains the place;
enrollment must never block on a document upload (#447's signed-upload flow is
not something to put between a parent and their first login).

## 3. Target flow (both apps)

```
0 StepParentEmail   any-domain email; sends verifyParentEmail({email, app})
1 StepVerify        shared; verifyCode; resend re-sends with the same app hint
2 StepPassword      shared; password policy + consent checkbox; consentVersion = CONSENT_VERSION
3 StepFamilyInfo    shared, controlled; submitting step → enrollFamily(...)
```

- `StepIndicator totalSteps={4}` on every step for a fresh signup. Add-profile
  (authed, no family membership) enters at step 2 in consent-only mode
  (`collectPassword={false}`) with no indicator and the enrollment app bar —
  study's current behaviour, adopted by sit (consent moves off the family step).
- Payload (new account): `email, verificationCode, password, consentVersion,
  familyName, firstName, [lastName], address, latLng, [postcode], [city],
  [pets], [note], kids: [], language`. Add-profile: same minus the credential
  keys and `language`.
- Errors: `profile-exists` → `enrollment.alreadyInFamily`; `role-exclusive` →
  `signup.roleExclusiveParent` (sit gains the key); everything else → the
  callable's message, as today.
- Expired-code rescue: the family step keeps a back affordance to the verify
  step; the family draft lives in the orchestrator (already true in both apps).
- Everything after `enrollFamily` resolves is unchanged (the reviewed
  #262/#264 session gate), including the account-ready fallback screen.

## 4. PR ladder

Each PR is independent of the others' merge state except where noted; none is
stacked on an unmerged branch.

| PR | Scope | Depends on |
|---|---|---|
| **PR0** — #511 | `language` on the family payload (F4) | — |
| **PR1** — shared components | `@ejm/shared-ui/enrollment`: `StepParentEmail` (any-domain; `logoSrc`/`logoAlt` like `StepEmail`) and `StepFamilyInfo` (controlled; `data/onChange/onNext/loading/error`; `noteLabel` prop so sit says "notes for babysitters" and study "notes for tutors"; `FamilyFormData` exported). Unit tests for both. No app wiring. Mirrors #435 PR3. | — |
| **PR2** — sit orchestrator | Rewire `apps/web` `ParentEnrollment` onto `StepParentEmail`/`StepVerify`/`StepPassword`/`StepFamilyInfo`; consent → password step with `consentVersion`; add-profile → consent-only step 2; map `role-exclusive`; delete `parent/StepParentEmail|Verify|Password|FamilyInfo.tsx` and `StepKids.tsx`; drop `searchDefaults`/consent booleans from form state; 4-dot indicator. Re-point `ParentEnrollment.test.tsx` mocks to the shared steps; keep every existing case (payload, #262 gate, #250 cooldown, #279 orphan guards). Screenshots of all four steps + add-profile entry. | PR1 merged |
| **PR3** — study orchestrator | Replace study's local `StepParentEmail`/`StepFamilyInfo` with the shared ones; 4-dot indicator (was 3); fold `enrollment.parent.*` strings into the flat keys (F7) if the shared components need them. Re-point tests. Screenshots. | PR1 merged |
| **PR4** — hosting flip | Only if D2 is flipped (§5). | PR2 + PR3 |

PR2 and PR3 can run in parallel once PR1 lands. Behavioural changes visible to
parents: sit's verify step becomes translated; sit's password policy becomes the
platform one; sit's consent checkbox moves one step earlier. Nothing changes in
what is stored except `consentVersion` now being sent by sit (same value the
server defaulted to) and `language` (#511).

## 5. Hosting flip (D2 alternative, not scheduled)

If the owner prefers the #435 shape for parents too — one orchestrator on
sync-sit.com, study's `/enroll/parent` redirecting cross-origin like
`SignUpRedirectPage` does for `/signup`:

1. sit's orchestrator gains an `app` query/state (`?app=study`) that selects the
   `verifyParentEmail` hint, brand mark and notes copy.
2. After `enrollFamily` + sign-in, `app === 'study'` mints `createAppHandoffCode`
   and hands off to `study/handoff#code=…&lang=…` (the `ChooseAppPage` precedent);
   study's `HandoffPage` already routes a parent to `/family`.
3. study's `/enroll/parent` → redirect to `sync-sit.com/enroll/parent?app=study`
   carrying the current language; its `ParentEnrollment` and tests are deleted.
4. The add-profile path must stay **per app**: an authed study user adding a
   family role has a study session, and the handoff is one-way.

Cost: one more cross-origin hop for every study parent, a second `app`-keyed
branch in the orchestrator, and the add-profile split above. Benefit: one
orchestrator instead of two ~300-line files that share every component. Not
worth it until a third host exists.

## 6. Test plan

- **PR1:** RTL unit tests per component — validation gating, `onNext` payloads,
  `noteLabel` copy switch, controlled round-trip (typed values survive
  unmount/remount via `data`).
- **PR2/PR3:** the existing orchestrator suites re-pointed to the shared step
  mocks, plus: consent-only add-profile entry renders no indicator; `role-exclusive`
  copy on sit; `consentVersion` present on sit's new-account payload; the deleted
  files are gone (`scripts/__tests__`-style grep pin is overkill — `git rm` is
  enough, the build fails on a stale import).
- **Integration:** `tests/integration/enrollment/enroll-family.test.ts` already
  covers the callable, including `consentVersion` and (after #511) `language`;
  nothing new server-side.
- **Mutation:** each PR's new assertions are proven live by reverting the change
  they pin (per the repo rule) before the PR is marked ready.

## 7. Non-goals

- No change to `enrollFamily`'s contract beyond #511.
- No kids collection during enrollment (D4), no verification upload in the flow (D5).
- No change to `JoinFamilyPage` (invited co-parents) — a different flow with its
  own callable; it can adopt `StepFamilyInfo`'s siblings later if useful.
- No sync-do parent flow (decision 20; #304).
