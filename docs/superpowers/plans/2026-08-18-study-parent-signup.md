# Issue #150: study parent signup — Implementation Record

> Built in `.claude/worktrees/parent-signup` (branch `feature/study-parent-signup`,
> stacked on feature/tutor-coverage-area / PR #175). Shipped as PR #178.

**Owner requirement (issue #150):** "There must be a parent sign up flow supported" —
study's `/enroll/parent` was a StaticPage stub; the SignUpRolePage parent option dead-ended.

## What shipped

`apps/study-web/src/pages/enrollment/parent/` — a four-step wizard at `/enroll/parent`:

- **Steps:** 0=Email, 1=Verify, 2=Password+consent, 3=Family info (submitting step).
  Sit's `ParentEnrollment` is the flow reference (same backend callables:
  `verifyParentEmail` + `enrollFamily` — no new backend surface beyond the
  consentVersion passthrough below); the tutor wizard is the structure reference.
- **Shared components reused verbatim:** `StepVerify` (carries the always-rendered
  issue-#154 no-code login exit hint), `StepPassword` (password + consent;
  consent-only mode for add-profile), `AddressAutocomplete`. Local
  `StepParentEmail` (the shared `StepEmail` is EJM-domain-specific) and a
  controlled `StepFamilyInfo`.
- **Ledger compliance:** `app: 'study'` on BOTH `verifyParentEmail` call sites,
  resend included (#154); exit hint always rendered under code entry (#154);
  no approval-wait language — success navigates straight to `/family` with no
  success page, mirroring sit (#149); geocoder `postcode`/`city` from the picked
  `AddressResult` ride in the `enrollFamily` payload, omitted (not emptied)
  when absent (#167/#175).
- **Consent passthrough (#178 round 1 blocker):** `familyEnrollmentSchema` and
  `enrollFamily` accept an optional bounded `consentVersion`; the new-account
  path persists it on the user doc, the add-profile path records it in the
  `family_profile_added` audit entry ({familyId, consentVersion}) — mirroring
  `enrollTutor`'s threading. Legacy sit clients send nothing and default to
  `'1.0'`, byte-identical to the pre-#178 record. The wizard sends
  StepPassword's presented version (`'2025-12-01'`).
- **Best-effort post-enroll sign-in:** the tutor wizard's reviewed pattern
  verbatim (swallowed sign-in errors, 5s-timeout-backstopped store wait) — a
  sign-in hiccup after successful enrollment never reads as an enrollment failure.
- **Add-profile path:** an authed user with no parent profile jumps to the
  consent-only password step (consent lives on StepPassword in study's
  structure, unlike sit where it sits on the family step — every path consents
  exactly once), then family info; credential keys are omitted entirely from
  the payload. An authed user WITH a parent profile (including sit parents —
  the profile is shared cross-app) is redirected to `/family`.
- **Expired-code rescue:** fresh signups keep a TopNav back arrow on the family
  step, returning directly to the verify step (codes have a 10-minute TTL); the
  family draft lives in the orchestrator (sit's controlled pattern) and
  survives the round trip. Add-profile users never held a code and keep the
  plain enrollment app bar.
- **Errors:** `profile-exists` → alreadyInFamily; `role-exclusive` →
  signup.roleExclusiveParent (defense-in-depth for a provider's direct URL
  visit; the role page already withholds the option, #116). No account-exists
  branch (#148 silent flow).

## Decisions of record

- **No kids / phone / whatsapp collection** — deliberate. Sit's live flow
  collects none of these either (its `StepKids` is unwired and it sends
  `kids: []`), `enrollFamily`'s schema has no phone/whatsapp fields, and
  children are managed post-enroll at `/family/settings`.
- **No searchDefaults sent** — babysitter-flavored; the backend nulls it.
- **StaticPage deleted** — the `/enroll/parent` stub was its last consumer
  (grep-verified); its orphaned `common.comingSoon` key removed from en+fr.
- **i18n:** 11 new `enrollment.*` keys (en+fr), study wording ("Notes for
  tutors"); everything else reuses existing shared keys.

## Test coverage

- `ParentEnrollment.test.tsx` — mocked-orchestrator suite: step progression,
  both app-hint pins (send + resend), full payload incl. consentVersion,
  conditional postcode/city (present and absent), credential omission +
  audit-consent pin on add-profile, back-to-verify with draft preservation,
  redirect/error branches.
- `ParentEnrollmentVerifyHint.test.tsx` — REAL components: the #154 exit hint
  and the app-hint through the actual StepParentEmail/StepVerify.
- `StepFamilyInfo.test.tsx` — direct component tests (tutor-step convention):
  typed-but-unpicked address keeps submit disabled; a picked suggestion flows
  up as the full AddressResult incl. postcode/city.
- Integration (`tests/integration/enrollment/`): enroll-family pins the
  legacy `'1.0'` default and the `'2025-12-01'` passthrough on the user doc;
  cross-app-enroll-family pins the add-profile audit record and that root
  consent fields stay untouched.
