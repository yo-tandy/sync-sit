# Releasing to production

Production ships on a **tag**. Merging to `main` runs the test suite and
deploys nothing.

Before issue #353, a push to `main` *was* a push to production: every merge
deployed hosting, functions and rules immediately. That left no way to
accumulate a coherent, tested set of changes before shipping, and no record of
what production was actually running.

## Cutting a release

```bash
git checkout main && git pull
git tag -a v1.4.0 -m "co-parent move, parent landing pages, cross-app endorsements"
git push origin v1.4.0
```

That's it. Pushing the tag triggers **Release to production**, which:

1. **Verifies the tag is on `main`.** A tag pointing at a commit that never
   landed on `main` is rejected. `git tag` is a local operation with no review
   attached, so this is the only thing standing between a mistaken checkout and
   production.
2. **Re-runs the full test suite** against the tagged tree — the same
   `test.yml` that gates `main`, called rather than copied, so the release gate
   can't drift from the branch gate.
3. **Deploys**, in this order: Firestore rules + indexes → Storage rules →
   hosting (all three sites) → functions (both codebases).

The rules-first ordering is deliberate and predates this workflow: new
collections' rules must be live before hosting ships UI that reads them.

### Why all three apps release together

sit, study and do share one Firebase project, one functions codebase, and the
`shared-core` / `shared-functions` / `shared-ui` packages. A per-app release
would ship half of a shared change — a new `shared-ui` component deployed to
one app while the other two still run the old bundle against the new backend.
One tag, three apps.

### Version numbers

`vMAJOR.MINOR.PATCH`. Nothing enforces semver here and nothing derives from it;
the tag's job is to be a stable, greppable name for "what production is
running" and a target to roll back to.

## Rolling back

**Actions → Release to production → Run workflow →** enter the tag to redeploy,
e.g. `v1.3.0`.

Rollback deliberately **skips the test gate**. The target is a tag that already
passed it when first released, and blocking an emergency rollback on a fresh
test run is the wrong trade. (There is also a mechanical reason: a reusable
workflow resolves at the caller's ref, and a `workflow_dispatch` run resolves at
the default branch — so on the rollback path that gate would test `main`, not
the tag being deployed, and report green for a tree it never looked at.)

**What rollback does not undo: data.** Code returns to the previous tag;
Firestore documents written by the newer code stay as they are. This is the
whole reason for the migration rule below.

## Database migrations: expand, then contract

Never ship a schema change and its cleanup in the same release. Rolling back
code is easy; rolling back data is not.

**Phase 1 — expand (before the release).** Write the migration so *old code
still works*. Add the new field, backfill it, leave the old one in place and
keep writing both. Run the script against production **before** cutting the
tag, so the release lands on data both versions understand.

```bash
pnpm backfill:279-orphan-pointers   # example: scripts/ are registered as pnpm scripts
```

**Phase 2 — release.** Cut the tag. The new code reads the new field. If it has
to be rolled back, the old code still finds the old field and production keeps
working.

**Phase 3 — contract (a later release).** Once the new release has been stable
for long enough that you would not roll back past it, remove the old field and
the dual writes. This is its own release.

The rule that makes this work: **a release must be safe to roll back to the
previous tag without touching data.** If a change can't satisfy that, it needs
splitting into more phases, not shipping.

## Pre-release checklist

- [ ] Everything intended for this release is merged to `main`, and `main` is green.
- [ ] Any migration for this release is **phase 1** (backwards compatible) and has
      already run against production.
- [ ] Any **phase 3** cleanup in this release refers to a field whose phase 1 shipped
      in an *earlier* release, not this one.
- [ ] Rules or index changes are in the tagged commit (they deploy first, automatically).
- [ ] You know which tag you'd roll back to.

## After the release

**Check the run actually deployed.** Two ways it can end without shipping:

- **Failure.** Production may be **partially deployed** — the steps are
  sequential, so rules can be live while functions are not. Fix forward with a
  new tag if the failure is in the code; redeploy the previous tag if the
  release itself is bad.
- **Cancellation.** Releases are serialized, and GitHub keeps only one *pending*
  run per concurrency group — a newer queued run cancels the older pending one.
  So if a release is in flight and two more queue behind it, the middle one is
  dropped and reports **cancelled**, not "queued". It never deployed. This
  matters most for a rollback queued behind a release: re-run it.

Serializing is still the right trade — running deploys in parallel is what
exhausted the Cloud Functions mutation quota on 2026-08-28 and left production a
merge behind — so this edge is handled by looking, not by configuration.

The functions step retries once after a two-minute backoff: the Cloud Functions
mutation-request quota is a short-window rate limit, and a spaced retry recovers
pressure that serialization alone can't (e.g. a concurrent console deploy).
