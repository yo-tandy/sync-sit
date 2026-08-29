import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Contract pins for the release pipeline (issue #353).
 *
 * Every property asserted here is one whose regression is SILENT: the
 * workflow still parses, still runs, still reports green, and does the wrong
 * thing to production. Re-adding a `push: branches: [main]` trigger would
 * quietly restore "merge to main == deploy to prod", which is the exact
 * behaviour this issue removed, and nothing else in CI would notice.
 *
 * Asserted against the PARSED yaml rather than the file text, deliberately:
 * a text regex matches the explanatory comments as readily as the config, and
 * a pin that can be satisfied by prose is not a pin (PR #327 round 5 shipped
 * exactly that bug).
 */
const wf = (name: string) =>
  parse(readFileSync(resolve(__dirname, '../../.github/workflows', name), 'utf8'));

/**
 * The workspace's package directories, expanded from pnpm-workspace.yaml —
 * the same file `pnpm -r` reads, so the pin cannot drift away from the tool.
 *
 * Supports the two pattern shapes the repo uses (a literal path, and one
 * trailing `/*`), plus `!` negations. Anything else THROWS rather than being
 * skipped: a pattern this cannot expand must fail the suite loudly, since
 * silently covering less is the exact failure the pin exists to prevent.
 */
function workspacePackageDirs(): string[] {
  const root = resolve(__dirname, '../..');
  const { packages } = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as {
    packages: string[];
  };

  const expand = (pattern: string): string[] => {
    if (!pattern.includes('*')) return [resolve(root, pattern)];
    const [prefix, ...rest] = pattern.split('/');
    if (rest.length !== 1 || rest[0] !== '*' || prefix.includes('*')) {
      throw new Error(`unsupported pnpm-workspace pattern: ${pattern}`);
    }
    return readdirSync(resolve(root, prefix)).map((name) => resolve(root, prefix, name));
  };

  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const pattern of packages) {
    const negated = pattern.startsWith('!');
    const target = negated ? excluded : included;
    for (const dir of expand(negated ? pattern.slice(1) : pattern)) target.add(dir);
  }

  return [...included].filter(
    (dir) => !excluded.has(dir) && existsSync(resolve(dir, 'package.json')),
  );
}

// `on:` parses to the boolean key `true` in YAML 1.1 — the Norway problem's
// cousin. Read both so this doesn't hinge on the parser's version.
const triggers = (doc: Record<string, unknown>) =>
  (doc['on'] ?? doc[true as unknown as string]) as Record<string, unknown>;

/**
 * Does this workflow run on a push that can reach `main`?
 *
 * Three shapes reach it and only one has an explicit filter, which is what the
 * first version of this sweep missed:
 *   on: push: { branches: [main] }   explicit
 *   on: push:                        no filter at all -> every branch
 *   on: [push, pull_request]         array form -> `t.push` is undefined
 *
 * A push filtered to `tags` only does NOT run on branch pushes -- that is
 * release.yml itself, and treating "no branches key" as "every branch" made
 * this sweep flag the very workflow it exists to protect.
 */
function pushReachesMain(t: unknown): boolean {
  if (Array.isArray(t)) return t.includes('push');
  const push = (t as Record<string, unknown>)?.push;
  if (push === undefined) return false;
  if (push === null) return true;
  const { branches, tags } = push as { branches?: string[]; tags?: string[] };
  if (branches) return branches.some((b) => b === 'main' || b === '*' || b === '**');
  return tags === undefined;
}

describe('release workflow (issue #353)', () => {
  const release = wf('release.yml');
  const on = triggers(release);

  it('fires on v* tags', () => {
    expect(on.push).toEqual({ tags: ['v*'] });
  });

  it('does NOT fire on a push to main — that coupling is the thing being removed', () => {
    expect((on.push as Record<string, unknown>).branches).toBeUndefined();
  });

  it('offers a manual entry point taking a tag, for rollback', () => {
    const inputs = (on.workflow_dispatch as { inputs: Record<string, { required: boolean }> })
      .inputs;
    expect(inputs.tag).toBeDefined();
    expect(inputs.tag.required).toBe(true);
  });

  it('serializes prod deploys and never cancels one mid-flight', () => {
    expect(release.concurrency['cancel-in-progress']).toBe(false);
  });

  it('gates the deploy on the tag being verified AND on the tests', () => {
    expect(release.jobs.build_and_deploy.needs).toEqual(['verify_tag', 'verify_tests']);
  });

  it('gives the gate job no credential-minting token', () => {
    // verify_tag handles the least-trusted input in the pipeline (a pushed tag
    // name). Workflow-level id-token: write handed it the WIF sink; only the
    // deploy needs one.
    expect(release.permissions).toEqual({ contents: 'read' });
    expect(release.jobs.verify_tag.permissions['id-token']).toBeUndefined();
    expect(release.jobs.build_and_deploy.permissions['id-token']).toBe('write');
  });

  it('validates the tag against the WHOLE value, not a line of it', () => {
    // grep is line-oriented, so `^...$` anchors a line: `v1.0.0\nanything`
    // passed. A workflow_dispatch input can contain newlines; a git ref cannot,
    // so the weak version held on the push path and failed on the rollback
    // path -- the one path where this check is the only validation.
    const steps = release.jobs.verify_tag.steps as { id?: string; run?: string; shell?: string }[];
    const resolve = steps.find((s) => s.id === 'resolve')!;
    expect(resolve.shell, '[[ =~ ]] is bash, not POSIX sh').toBe('bash');
    expect(String(resolve.run)).toMatch(/\[\[\s+"\$TAG"\s+=~/);
    expect(String(resolve.run)).not.toMatch(/grep -Eq/);
  });

  it('deploys the resolved tag SHA, not whatever ref the run started from', () => {
    const checkout = release.jobs.build_and_deploy.steps[0];
    expect(checkout.uses).toMatch(/^actions\/checkout@/);
    expect(checkout.with.ref).toBe('${{ needs.verify_tag.outputs.sha }}');
  });

  it('tolerates a SKIPPED test gate (rollback) but never a FAILED one', () => {
    // The rollback path skips verify_tests, and `needs` on a skipped job skips
    // the dependent — so this condition is what stops every rollback from
    // being a no-op that reports success.
    const cond = String(release.jobs.build_and_deploy.if).replace(/\s+/g, ' ');
    expect(cond).toContain("needs.verify_tag.result == 'success'");
    expect(cond).toContain("needs.verify_tests.result == 'success'");
    expect(cond).toContain("needs.verify_tests.result == 'skipped'");
    expect(cond).not.toContain("'failure'");
  });

  it('verify_tag actually performs the ancestor check', () => {
    // The suite pinned that build_and_deploy DEPENDS on verify_tag, but not
    // that verify_tag does anything. Deleting the merge-base block -- a
    // plausible "let me ship a hotfix tag off a branch" edit -- left every
    // other test green while any tag from any branch reached production.
    // Asserted on the parsed step's `run` string, so workflow COMMENTS about
    // ancestry cannot satisfy it.
    const steps = release.jobs.verify_tag.steps as { id?: string; run?: string }[];
    const resolve = steps.find((s) => s.id === 'resolve');
    expect(resolve, 'verify_tag must keep a step with id: resolve').toBeDefined();
    const script = String(resolve!.run);
    expect(script).toMatch(/merge-base\s+--is-ancestor/);
    expect(script).toMatch(/origin\/main/);
    // ...and fails the job rather than warning.
    expect(script).toMatch(/exit 1/);
  });

  it('never interpolates the tag name into the shell source', () => {
    // ${{ }} expands into the script BEFORE bash parses it, so a ref name
    // containing ` $ ; " | & ( ) executes as code in the job that holds
    // id-token: write. The value must arrive via env: and be quoted.
    const steps = release.jobs.verify_tag.steps as {
      id?: string;
      run?: string;
      env?: Record<string, string>;
    }[];
    const resolve = steps.find((s) => s.id === 'resolve')!;
    expect(String(resolve.run)).not.toMatch(/\$\{\{/);
    expect(resolve.env?.TAG).toBe('${{ inputs.tag || github.ref_name }}');
    expect(String(resolve.run)).toContain('"$TAG"');
    // And the alphabet is constrained before the value reaches git at all.
    expect(String(resolve.run)).toMatch(/\^v\[0-9\]/);
  });

  it('does not use always(), which survives cancellation', () => {
    expect(String(release.jobs.build_and_deploy.if)).not.toMatch(/\balways\(\)/);
    expect(String(release.jobs.build_and_deploy.if)).toMatch(/!cancelled\(\)/);
  });

  it('runs the test gate for real releases only', () => {
    expect(release.jobs.verify_tests.if).toBe("github.event_name == 'push'");
    expect(release.jobs.verify_tests.uses).toBe('./.github/workflows/test.yml');
  });

  it('deploys rules BEFORE the code that depends on them', () => {
    const names = (release.jobs.build_and_deploy.steps as { name?: string }[])
      .map((s) => s.name)
      .filter(Boolean) as string[];
    const at = (needle: string) => names.findIndex((n) => n.includes(needle));
    expect(at('Firestore rules')).toBeGreaterThanOrEqual(0);
    expect(at('Firestore rules')).toBeLessThan(at('Deploy Hosting'));
    expect(at('Storage rules')).toBeLessThan(at('Deploy Hosting'));
    expect(at('Deploy Hosting')).toBeLessThan(at('Deploy Cloud Functions'));
  });
});

describe('test workflow stays callable by the release gate', () => {
  const test = wf('test.yml');
  const on = triggers(test);

  it('exposes workflow_call', () => {
    // Without this the release's verify_tests job cannot resolve and every
    // release fails at the gate rather than at the deploy.
    expect('workflow_call' in on).toBe(true);
  });

  it('still gates main and every pull request', () => {
    expect((on.push as { branches: string[] }).branches).toEqual(['main']);
    expect('pull_request' in on).toBe(true);
  });
});

/**
 * Contract pins for the typecheck gate (issue #378).
 *
 * Same rationale as the release pins above: the premise of that issue is that
 * an ABSENT gate is invisible, which applies to the gate itself. Both
 * regressions below are silent — every other check stays green while the type
 * gate quietly covers less than it claims to.
 */
describe('typecheck gate (issue #378)', () => {
  it('test.yml runs `pnpm -r typecheck` in a job of its own', () => {
    // Asserted on the parsed step's `run`, so the workflow's own comments
    // about typechecking cannot satisfy it.
    const test = wf('test.yml');
    const job = (test.jobs as Record<string, { steps?: { run?: string }[] }>).typecheck;
    expect(job, 'test.yml must keep a `typecheck` job').toBeDefined();
    const runs = (job.steps ?? []).map((s) => String(s.run ?? ''));
    expect(runs.some((r) => /pnpm\s+-r\s+typecheck/.test(r))).toBe(true);
  });

  it('is parallel to the suites, never ordered ahead of them', () => {
    // A gate with `needs: [typecheck]` on `test` would let a type error
    // short-circuit the suites and erase their signal — the failure mode
    // #341/#215/#216 were about, and the reason this is its own job.
    const test = wf('test.yml');
    const jobs = test.jobs as Record<string, { needs?: unknown }>;
    expect(jobs.typecheck.needs).toBeUndefined();
    expect(jobs.test.needs).toBeUndefined();
    expect(jobs.lint.needs).toBeUndefined();
  });

  it('every workspace package defines a `typecheck` script', () => {
    // The gap this issue actually closed: `tests/` had a tsconfig but no
    // script, so `pnpm -r typecheck` silently skipped it and "12 of 12" was
    // really 11. A NEW package shipping without the script would put the repo
    // straight back into that state with nothing turning red.
    //
    // Membership is read from pnpm-workspace.yaml rather than a hardcoded
    // directory shape, because that file is what `pnpm -r` actually consults.
    // Hardcoding it would reintroduce the same silent drift in the pin itself:
    // a new top-level glob (`services/*`) would be skipped by the walk and the
    // floor would still pass, and dropping the `!apps/mobile` exclusion would
    // leave mobile exempt forever.
    const missing = workspacePackageDirs().filter((dir) => {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
      return !pkg.scripts?.typecheck;
    });
    expect(missing).toEqual([]);
    // Floor: asserted after `missing` so an empty expansion fails HERE rather
    // than passing vacuously above.
    expect(workspacePackageDirs().length).toBeGreaterThanOrEqual(12);
  });
});

describe('no other workflow deploys to production on merge', () => {
  it('the merge-deploy workflow is gone, not merely renamed alongside a survivor', () => {
    // A leftover copy would keep main coupled to prod while release.yml looked
    // correct in isolation.
    const dir = resolve(__dirname, '../../.github/workflows');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    // Both edges matter: Actions accepts .yaml as well as .yml, and the root
    // `pnpm deploy` script IS `firebase deploy` (package.json), so matching
    // only the literal command would miss a workflow calling it by name.
    const DEPLOYS = /firebase deploy|pnpm(?: run)? deploy\b/;
    const offenders = readdirSync(dir).filter((f) => {
      if (!/\.ya?ml$/.test(f)) return false;
      const doc = wf(f);
      if (!pushReachesMain(triggers(doc))) return false;
      // A workflow may run ON main; it may not DEPLOY from it.
      const jobs = (doc.jobs ?? {}) as Record<string, { steps?: { run?: string }[] }>;
      return Object.values(jobs).some((j) =>
        (j.steps ?? []).some((s) => typeof s.run === 'string' && DEPLOYS.test(s.run)),
      );
    });
    expect(offenders).toEqual([]);
  });
});
