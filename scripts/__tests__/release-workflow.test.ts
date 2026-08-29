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
 * Expand pnpm-workspace `packages:` patterns to absolute directories.
 *
 * Supports the two shapes this repo uses (a literal path, and one trailing
 * `/*`) plus `!` negations. Anything else THROWS rather than being skipped:
 * a pattern this cannot expand must fail loudly, since silently covering less
 * is the exact failure the pin using it exists to prevent.
 *
 * `listDir` is injected so the expander can be tested directly — including the
 * negation branch, which the real workspace cannot exercise (apps/mobile is
 * excluded AND absent from disk, so a broken `!` would still look correct).
 */
export function expandWorkspacePatterns(
  patterns: string[],
  root: string,
  listDir: (dir: string) => string[],
): string[] {
  const expand = (pattern: string): string[] => {
    if (!pattern.includes('*')) return [resolve(root, pattern)];
    const [prefix, ...rest] = pattern.split('/');
    if (rest.length !== 1 || rest[0] !== '*' || prefix.includes('*')) {
      throw new Error(
        `unsupported pnpm-workspace pattern: ${pattern} — extend expandWorkspacePatterns() ` +
          `in scripts/__tests__/release-workflow.test.ts to cover it (do NOT remove the pattern ` +
          `or loosen the pin; narrowing what this sees is the bug it guards against)`,
      );
    }
    return listDir(resolve(root, prefix)).map((name) => resolve(root, prefix, name));
  };

  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const target = negated ? excluded : included;
    for (const dir of expand(negated ? pattern.slice(1) : pattern)) target.add(dir);
  }
  return [...included].filter((dir) => !excluded.has(dir));
}

/**
 * The workspace's package directories, read from pnpm-workspace.yaml — the
 * same file `pnpm -r` reads, so the pin cannot drift away from the tool.
 */
function workspacePackageDirs(): string[] {
  const root = resolve(__dirname, '../..');
  const { packages } = parse(readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')) as {
    packages: string[];
  };
  return expandWorkspacePatterns(packages, root, readdirSync).filter((dir) =>
    existsSync(resolve(dir, 'package.json')),
  );
}

type Manifest = {
  dir: string;
  name: string;
  scripts: Record<string, string>;
  exports?: unknown;
};

/** Every workspace package's parsed manifest, keyed off the same membership. */
function workspaceManifests(): Manifest[] {
  return workspacePackageDirs().map((dir) => {
    const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
      name: string;
      scripts?: Record<string, string>;
      exports?: unknown;
    };
    return { dir, name: pkg.name, scripts: pkg.scripts ?? {}, exports: pkg.exports };
  });
}

/** The root manifest — the one that owns `test:unit` and `typecheck`. */
const rootManifest = () =>
  JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

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

  // The expander gets its own tests because the real workspace cannot exercise
  // it: apps/mobile is both excluded AND absent from disk, so deleting the `!`
  // handling entirely would leave every assertion above still green.
  describe('expandWorkspacePatterns', () => {
    const root = '/repo';
    const listDir = (dir: string) =>
      ({
        '/repo/packages': ['shared-core', 'sit-core'],
        '/repo/apps': ['web', 'mobile'],
      })[dir] ?? [];

    it('expands a trailing /* and keeps literal paths', () => {
      expect(expandWorkspacePatterns(['packages/*', 'tests'], root, listDir)).toEqual([
        '/repo/packages/shared-core',
        '/repo/packages/sit-core',
        '/repo/tests',
      ]);
    });

    it('honours ! negations', () => {
      expect(expandWorkspacePatterns(['apps/*', '!apps/mobile'], root, listDir)).toEqual([
        '/repo/apps/web',
      ]);
    });

    it('throws on a pattern it cannot expand rather than silently skipping it', () => {
      for (const pattern of ['tools/**/pkg', 'services/api/*', 'packages/*-core']) {
        expect(() => expandWorkspacePatterns([pattern], root, listDir)).toThrow(
          /unsupported pnpm-workspace pattern/,
        );
      }
    });
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
    const dirs = workspaceManifests();
    const missing = dirs.filter((pkg) => !pkg.scripts.typecheck).map((pkg) => pkg.dir);
    expect(missing).toEqual([]);
    // Floor: asserted after `missing`, and against the SAME list it was derived
    // from, so an empty expansion fails HERE rather than passing vacuously.
    expect(dirs.length).toBeGreaterThanOrEqual(12);
  });
});

/**
 * Parse the pnpm package selection out of the first command of a script.
 *
 * Models `pnpm`'s selection surface, not the whole CLI: the `-r`/`--recursive`
 * flag and `--filter <x>` / `--filter=<x>` / `-F <x>` / `-F=<x>`, with a
 * leading `!` marking an exclusion. That is deliberately narrow — but narrow
 * has to mean LOUD, not lenient: any other spelling of a selection flag throws
 * rather than being skipped, because a skipped `-F web` would leave the pins
 * below asserting that ten suites run while pnpm ran one.
 */
export function pnpmSelection(script: string): {
  recursive: boolean;
  includes: string[];
  excludes: string[];
} {
  const [command = ''] = script.split('&&');
  const tokens = (command.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((t) =>
    /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t,
  );
  const includes: string[] = [];
  const excludes: string[] = [];
  let recursive = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '-r' || token === '--recursive') {
      recursive = true;
      continue;
    }
    let value: string | undefined;
    if (token === '--filter' || token === '-F') value = tokens[++i];
    else value = token.match(/^(?:--filter|-F)=(.*)$/)?.[1];
    if (value === undefined) {
      // Any OTHER spelling of a selection flag — `--filter-prod`, an attached
      // `-Fweb` — throws rather than being skipped, the way
      // expandWorkspacePatterns throws on a pattern it cannot expand. Skipping
      // it silently is the unsafe direction: the pins below would compute a
      // selection of ten packages while pnpm ran one, which is exactly the
      // #401 failure mode they exist to prevent.
      if (/^(?:-F|--filter)/.test(token)) {
        throw new Error(
          `unmodelled pnpm selection flag: ${token} — extend pnpmSelection() in ` +
            `scripts/__tests__/release-workflow.test.ts to cover it (do NOT drop the flag or ` +
            `loosen the pin; mis-reading the selection is the bug this guards against)`,
        );
      }
      continue;
    }
    if (value.startsWith('!')) excludes.push(value.slice(1));
    else includes.push(value);
  }
  return { recursive, includes, excludes };
}

/**
 * Contract pins for the unit-test lane (issue #401).
 *
 * `test:unit` used to name its ten packages by hand, so a NEW workspace
 * package shipped with its suite silently skipped — CI green, rollup green,
 * nothing anywhere saying the suite never ran. Same class as #216 (an absent
 * test job hidden by a green rollup) and #378 (`pnpm -r typecheck` skipping a
 * package with no script, so "12 of 12" was really 11).
 *
 * The script now selects recursively and subtracts an exclusion list, so the
 * list cannot drift. These pins guard the two ways that could silently regress:
 * someone reintroduces a hand-written filter list, or someone adds an
 * exclusion that is not a recorded decision.
 */
describe('unit test lane (issue #401)', () => {
  /**
   * Workspace packages deliberately kept OUT of the unit lane, each with the
   * reason. An exclusion belongs here or it is a bug — that is the whole point
   * of the allow-list: skipping a suite becomes a decision recorded in a test
   * rather than an omission nobody can see.
   */
  const EXCLUDED_FROM_UNIT_LANE: Record<string, string> = {
    '@ejm/tests': 'the integration lane — needs the emulator lifecycle, runs via test:integration',
  };

  const script = () => rootManifest().scripts['test:unit'];

  it('selects packages recursively instead of naming them', () => {
    // The regression this issue is about: any positive `--filter` reintroduces
    // a hand-written list, and the next package added to the workspace is
    // silently unrun again.
    const { recursive, includes } = pnpmSelection(script());
    expect(includes, 'test:unit must not name packages by hand').toEqual([]);
    expect(recursive, 'test:unit must select with -r').toBe(true);
  });

  it('excludes only packages whose exclusion is a recorded decision', () => {
    const { excludes } = pnpmSelection(script());
    expect(excludes.filter((name) => !(name in EXCLUDED_FROM_UNIT_LANE))).toEqual([]);
  });

  it('keeps the integration lane out of the unit lane', () => {
    // Not implied by the assertion above: an empty exclusion list satisfies it
    // while pulling the emulator suite into `pnpm test:unit`, where it has no
    // emulator to talk to.
    expect(pnpmSelection(script()).excludes).toContain('@ejm/tests');
  });

  it('runs every workspace package that defines a `test` script', () => {
    // Derived from workspace membership rather than restated, so a new package
    // is covered the moment it exists. Membership comes from
    // pnpm-workspace.yaml — the file `pnpm -r` itself consults (#403).
    //
    // The selection is computed from the script rather than assumed from the
    // pin above, so this fails on its own under the hand-written form as well
    // as under a bad exclusion.
    const { recursive, includes, excludes } = pnpmSelection(script());
    const all = workspaceManifests();
    const base = includes.length
      ? includes
      : recursive || excludes.length
        ? all.map((pkg) => pkg.name)
        : [];
    const selected = new Set(base.filter((name) => !excludes.includes(name)));
    const unrun = all
      .filter((pkg) => pkg.scripts.test && !selected.has(pkg.name))
      .filter((pkg) => !(pkg.name in EXCLUDED_FROM_UNIT_LANE))
      .map((pkg) => pkg.name);
    expect(unrun).toEqual([]);
    // Floor, against the same list: an empty expansion must fail here rather
    // than pass vacuously.
    expect(workspaceManifests().filter((pkg) => pkg.scripts.test).length).toBeGreaterThanOrEqual(
      11,
    );
  });

  it('still runs the suites that live outside every package', () => {
    // scripts/__tests__ — these pins among them — sit in no workspace package,
    // so `pnpm -r` cannot reach them. Dropping this tail would silently stop
    // running the file you are reading.
    expect(script()).toContain('vitest run --project scripts');
  });

  describe('pnpmSelection', () => {
    it('reads the hand-written form this issue removed', () => {
      expect(
        pnpmSelection('pnpm --filter @ejm/shared-core --filter web test && vitest run'),
      ).toEqual({ recursive: false, includes: ['@ejm/shared-core', 'web'], excludes: [] });
    });

    it('reads the recursive form, quoted negation and all', () => {
      expect(pnpmSelection("pnpm -r --filter '!@ejm/tests' test && vitest run --project scripts"))
        .toEqual({ recursive: true, includes: [], excludes: ['@ejm/tests'] });
    });

    it('reads --filter=x as well as --filter x', () => {
      expect(pnpmSelection('pnpm --recursive --filter=!a --filter=b test')).toEqual({
        recursive: true,
        includes: ['b'],
        excludes: ['a'],
      });
    });

    it('reads pnpm’s -F alias, which is the same mechanism under another name', () => {
      // Not academic: `pnpm -r --filter '!@ejm/tests' -F web test` satisfies
      // every pin above if -F is skipped — includes stays empty, the exclusion
      // stays recorded — while pnpm runs exactly one package.
      expect(pnpmSelection("pnpm -r --filter '!@ejm/tests' -F web test && vitest run")).toEqual({
        recursive: true,
        includes: ['web'],
        excludes: ['@ejm/tests'],
      });
      expect(pnpmSelection('pnpm -r -F=web test')).toEqual({
        recursive: true,
        includes: ['web'],
        excludes: [],
      });
    });

    it('throws on a selection flag it does not model rather than skipping it', () => {
      for (const flag of ['--filter-prod', '--filter-prod=web', '-Fweb']) {
        expect(() => pnpmSelection(`pnpm -r ${flag} test`)).toThrow(
          /unmodelled pnpm selection flag/,
        );
      }
    });

    it('stops at the first &&, so the tail command cannot contribute filters', () => {
      expect(pnpmSelection('pnpm -r test && pnpm --filter web something')).toEqual({
        recursive: true,
        includes: [],
        excludes: [],
      });
    });
  });
});

/**
 * Contract pin for src-first type resolution (issue #406).
 *
 * Every shared package's `exports` maps `require` to `./dist/*.js` and `types`
 * to `./src/*.ts`. TypeScript walks those condition KEYS IN ORDER, so with
 * `types` listed after `require` a CJS consumer (apps/functions,
 * apps/study-functions — both `moduleResolution: node16`) resolves its types
 * out of `dist/*.d.ts` whenever a `dist` happens to exist, and out of `src`
 * when it does not.
 *
 * That made local typechecks disagree with CI in both directions: a stale
 * `dist` invented ten `TS2724 has no exported member 'SIT_APP_URL'` errors on
 * a green main (the false escalation this issue was filed from), and equally
 * hides real errors, since the consumer is checked against yesterday's
 * declarations. CI never sees either, because CI always starts clean.
 *
 * Listing `types` first makes source the single answer regardless of what is
 * on disk. Nothing at runtime changes: `types` is a TypeScript-only condition,
 * so Node and Vite skip it and still match `require`/`import`.
 */
describe('src-first type resolution (issue #406)', () => {
  it('every exports condition map lists `types` first', () => {
    const offenders: string[] = [];
    for (const pkg of workspaceManifests()) {
      if (typeof pkg.exports !== 'object' || pkg.exports === null) continue;
      for (const [subpath, target] of Object.entries(pkg.exports as Record<string, unknown>)) {
        if (typeof target !== 'object' || target === null) continue;
        const conditions = Object.keys(target as Record<string, unknown>);
        if (!conditions.includes('types')) continue;
        if (conditions[0] !== 'types') {
          offenders.push(`${pkg.name} "${subpath}": ${conditions.join(', ')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every map a CJS consumer resolves through declares `types` at all', () => {
    // The assertion above is vacuously true for a map with no `types` key —
    // the same bug wearing a different hat, since `require` would then be the
    // only answer and `dist` the only source of types.
    //
    // DERIVED, not listed: "has a `require` pointing at dist" is precisely the
    // property that makes a map reachable this way, so a new package — or a
    // new subpath on an existing one — is covered the moment it exists.
    // Restating the package names here would reintroduce the hand-written-list
    // failure mode the unit-lane pin above exists to prevent, two lanes over.
    const offenders: string[] = [];
    let checked = 0;
    for (const pkg of workspaceManifests()) {
      if (typeof pkg.exports !== 'object' || pkg.exports === null) continue;
      for (const [subpath, target] of Object.entries(pkg.exports as Record<string, unknown>)) {
        if (typeof target !== 'object' || target === null) continue;
        const conditions = target as Record<string, string>;
        if (!/^\.\/dist\//.test(conditions.require ?? '')) continue;
        checked++;
        if (!/^\.\/src\//.test(conditions.types ?? '')) {
          offenders.push(`${pkg.name} "${subpath}": types=${conditions.types ?? '(absent)'}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // Floor, against the same derivation: shared-core's five subpaths,
    // shared-functions' ten, and one each for sit-core, study-core, do-core.
    // An empty derivation must fail HERE rather than pass vacuously.
    expect(checked).toBeGreaterThanOrEqual(18);
  });
});

describe('no other workflow deploys to production on merge', () => {
  it('the merge-deploy workflow is gone, not merely renamed alongside a survivor', () => {
    // A leftover copy would keep main coupled to prod while release.yml looked
    // correct in isolation.
    const dir = resolve(__dirname, '../../.github/workflows');
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
