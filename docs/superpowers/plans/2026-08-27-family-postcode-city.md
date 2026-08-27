# Persist postcode/city on the family doc (issue #176)

**Goal:** a family's SAVED address must resolve a coverage-area label in tutor
search (family_home / library area filtering) without the parent re-picking it
via autocomplete — i.e. `families/{id}` carries the geocoder's postcode/city
wherever the address is set.

## Finding: the code side already shipped

Issue #176 was filed against a pre-#175 snapshot. Verified point-by-point on
main (independent greps, not the issue thread's claims):

- **Parent enrollment, both apps** — `apps/web` ParentEnrollment and
  `apps/study-web` ParentEnrollment both send postcode/city via conditional
  spread (absent when the geocoder produced none, never `''`/`null` on the
  wire). Shipped in PR #175.
- **`enrollFamily` callable** — persists `postcode: data.postcode || null`,
  `city: data.city || null` on the family doc; input bounded by
  `familyEnrollmentSchema` (`postcode` ≤ 20 chars, `city` ≤ 100 chars,
  optional).
- **Family settings, both apps** — both FamilySettingsPages write
  postcode/city in the same `updateDoc` as address/latLng and null them on a
  manual (non-autocomplete) edit so a stale geocode never outlives its
  address. Shipped in commit `bab008e`.
- **firestore.rules** — the families-update `hasOnly` list includes
  `postcode`/`city` with shape checks mirroring the schema bounds; pinned in
  `tests/rules/firestore-rules.test.ts` (allow + malformed-shape deny).
- **Search read side** — study SearchPage reads `postcode`/`city` off the
  family doc and resolves the label via `resolveAreaLabel`; pinned both ways
  (doc with components → label; doc without → no label).

## The one gap this PR closes

`apps/web` ParentEnrollment had **no test pin on the enrollFamily payload** —
study-web pins both the ride-along and the omission case; sit pinned only the
issue-#148 verify hint. The conditional spread in sit was unguarded: a
regression to `postcode: x ?? null` would ship silently. This PR mirrors the
study-web pins (autocomplete pick → postcode+city present; componentless
address → keys ABSENT), mutation-tested: flattening the spread to
`?? null` fails the omission pin.

## Backfill: none, by design

Existing family docs **self-heal on the next address edit** (both settings
pages write the components on every save) — that is the issue's stated
intent. The owner recorded a deferral on the issue: no parent traffic on
sync/study yet, so nobody can currently hit the area-matching gap, and the
backfill is deliberately NOT on the deploy checklist. The idempotent,
dry-run-by-default script stays ready at `scripts/backfill-family-postcode.cjs`
for whenever study gets real parent traffic; running it against prod is a
prod mutation reserved for the owner.
