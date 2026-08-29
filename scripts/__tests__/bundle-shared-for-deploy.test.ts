import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const bundleScript = path.join(repoRoot, 'scripts/bundle-shared-for-deploy.js');
const unbundleScript = path.join(repoRoot, 'scripts/unbundle-shared-after-deploy.js');
const functionsDir = path.join(repoRoot, 'apps/functions');
const studyFunctionsDir = path.join(repoRoot, 'apps/study-functions');

/** Every workspace:* dep must be rewritten to file: before deploy — npm in
 *  Cloud Build rejects the workspace: protocol (EUNSUPPORTEDPROTOCOL). */
function expectNoWorkspaceDeps(pkgDir: string) {
  const pkg = readJson(path.join(pkgDir, 'package.json'));
  const offenders = Object.entries(pkg.dependencies ?? {}).filter(
    ([, v]) => typeof v === 'string' && v.startsWith('workspace:'),
  );
  expect(offenders).toEqual([]);
}

function runScript(scriptPath: string) {
  execFileSync(process.execPath, [scriptPath], { cwd: repoRoot, stdio: 'inherit' });
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(path.relative(repoRoot, full));
  }
}

/** The test-artifact shapes the bundler's filter must drop, in either tree.
 *  Mirrors scripts/bundle-shared-for-deploy.js — dist adds the declaration and
 *  sourcemap siblings tsc emits alongside a compiled `foo.test.js`. */
const TEST_PATH_RE = /(^|\/)__tests__\//;
const TEST_FILE_RE = /\.(test|spec)\.(d\.)?[cm]?[jt]sx?(\.map)?$/;

function isTestArtifact(p: string): boolean {
  return TEST_PATH_RE.test(p) || TEST_FILE_RE.test(p);
}

/** Every file under apps/{functions,study-functions}/<name>-bundle/, repo-relative. */
function listBundleFiles(): string[] {
  const out: string[] = [];
  for (const appDir of [functionsDir, studyFunctionsDir]) {
    for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('-bundle')) continue;
      walk(path.join(appDir, entry.name), out);
    }
  }
  return out.sort();
}

afterEach(() => {
  runScript(unbundleScript);
}, 60000);

describe('bundle-shared-for-deploy', () => {
  it('bundles and rewrites study-core for the study functions deploy', () => {
    runScript(bundleScript);

    const studyFunctionsPkg = readJson(path.join(studyFunctionsDir, 'package.json'));
    expect(studyFunctionsPkg.dependencies['@ejm/study-core']).toBe('file:./study-core-bundle');

    const studyCoreBundleDir = path.join(studyFunctionsDir, 'study-core-bundle');
    expect(fs.existsSync(studyCoreBundleDir)).toBe(true);

    const studyCoreBundlePkg = readJson(path.join(studyCoreBundleDir, 'package.json'));
    expect(studyCoreBundlePkg.dependencies['@ejm/shared-core']).toBe('file:../shared-core-bundle');
  }, 60000);

  it('rewrites every workspace dep in apps/functions (incl. @ejm/shared-core)', () => {
    runScript(bundleScript);

    const functionsPkg = readJson(path.join(functionsDir, 'package.json'));
    expect(functionsPkg.dependencies['@ejm/shared-core']).toBe('file:./shared-core-bundle');
    expect(functionsPkg.dependencies['@ejm/sit-core']).toBe('file:./sit-core-bundle');
    expect(functionsPkg.dependencies['@ejm/shared-functions']).toBe('file:./shared-functions-bundle');

    // No workspace:* may survive into either deployed manifest.
    expectNoWorkspaceDeps(functionsDir);
    expectNoWorkspaceDeps(studyFunctionsDir);
  }, 60000);

  // Issue #384: the bundler used to cpSync each package's raw `src` verbatim,
  // so 78 test files (113 entries counting the `__tests__` directories) landed
  // in the deploy artifact on every deploy — shared-functions' admin-SDK
  // fixtures among them. No tsconfig `exclude` reaches them, because this path
  // copies sources instead of compiling them, so the guard has to live here.
  it('copies no test sources into any bundle', () => {
    runScript(bundleScript);

    const offenders = listBundleFiles().filter(isTestArtifact);
    expect(offenders).toEqual([]);
  }, 60000);

  // The other half of the same guard: the filter must remove test artifacts and
  // NOTHING else. Asserted against the source packages rather than a golden
  // list, so a new runtime file is covered the day it is added.
  //
  // Covers `dist` as well as `src`, and dist is the half that matters most: it
  // is the code Cloud Functions actually loads, so a filter that over-matched
  // there would strip executable runtime code out of the artifact. This also
  // turns "no dist file was removed" from a one-time manual check into a
  // standing assertion.
  it('still copies every non-test file of every bundled package (src and dist)', () => {
    runScript(bundleScript);

    const bundled = new Set(listBundleFiles());
    const missing: string[] = [];
    const emptyTrees: string[] = [];

    // Which deploy codebases each bundle lands in: step 6 mirrors four of the
    // five into apps/study-functions; do-core is apps/functions-only (its
    // callables live there).
    const bothCodebases = ['apps/functions', 'apps/study-functions'];
    const bundles: Array<[string, string, string[]]> = [
      ['shared-core', 'shared-core-bundle', bothCodebases],
      ['sit-core', 'sit-core-bundle', bothCodebases],
      ['study-core', 'study-core-bundle', bothCodebases],
      ['shared-functions', 'shared-functions-bundle', bothCodebases],
      ['do-core', 'do-core-bundle', ['apps/functions']],
    ];

    for (const [pkgName, bundleName, appDirs] of bundles) {
      for (const tree of ['src', 'dist']) {
        const pkgTree = path.join(repoRoot, 'packages', pkgName, tree);
        // Guarded rather than letting readdirSync throw: the script itself
        // copies dist only `if (fs.existsSync(distDir))`, so an absent tree is
        // a case it tolerates. Recording it as empty turns both "missing" and
        // "built nothing" into the one legible failure below instead of an
        // opaque ENOENT on a path.
        const sources: string[] = [];
        if (fs.existsSync(pkgTree)) walk(pkgTree, sources);

        let checkedHere = 0;
        for (const rel of sources) {
          const inPkg = path.relative(pkgTree, path.join(repoRoot, rel));
          if (isTestArtifact(inPkg)) continue;
          for (const appDir of appDirs) {
            checkedHere++;
            const expected = path.join(appDir, bundleName, tree, inPkg);
            if (!bundled.has(expected)) missing.push(expected);
          }
        }
        if (checkedHere === 0) emptyTrees.push(`${pkgName}/${tree}`);
      }
    }

    expect(missing).toEqual([]);
    // Per-(package, tree), not an aggregate: a global count sums ~1400 pairs,
    // so a single tree coming back empty — study-core/dist, say, which is what
    // Cloud Functions actually loads — stayed well above any global floor and
    // passed vacuously. Named, so the failure says which tree.
    expect(emptyTrees).toEqual([]);
  }, 60000);

  // The filename clause of the filter removes nothing today — every test file
  // in every bundled package sits under a `__tests__` directory — so without
  // this it would ship untested. Plants the exact file it exists to catch: a
  // stray `*.test.ts` OUTSIDE a `__tests__` directory, which each package's
  // tsconfig.cjs.json does NOT exclude and therefore compiles into `dist` as
  // four artifacts (.js, .d.ts, .js.map, .d.ts.map). All four must stay out of
  // the bundle — the .js especially, since dist is what Cloud Functions loads.
  it('drops a stray test file outside __tests__, and all four of its dist artifacts', () => {
    const pkgDir = path.join(repoRoot, 'packages/study-core');
    // Named to diagnose itself: the `finally` below only runs if the process
    // survives, so a SIGINT or a CI job timeout leaves this in a tracked source
    // tree where a later `git add -A` could sweep it up. .gitignore carries the
    // path for the same reason. (It does NOT break study-core's own suite —
    // that vitest include is `src/**/__tests__/**/*.test.ts`, which a file at
    // the root of `src` does not match.)
    const probeName = '__leftover_bundlerStrayProbe.test.ts';
    const probeSrc = path.join(pkgDir, 'src', probeName);
    const probeStem = '__leftover_bundlerStrayProbe';
    const distDir = path.join(pkgDir, 'dist');

    fs.writeFileSync(probeSrc, 'export const strayProbe = 1;\n');
    try {
      runScript(bundleScript);

      // Not vacuous: the probe really did compile to all four dist artifacts,
      // so there was something for the filter to drop.
      const compiled = fs
        .readdirSync(distDir)
        .filter((n) => n.startsWith(probeStem))
        .sort();
      expect(compiled).toEqual([
        `${probeStem}.test.d.ts`,
        `${probeStem}.test.d.ts.map`,
        `${probeStem}.test.js`,
        `${probeStem}.test.js.map`,
      ]);

      // And none of them — nor the .ts source — reached any bundle.
      expect(listBundleFiles().filter((f) => f.includes(probeStem))).toEqual([]);
    } finally {
      fs.rmSync(probeSrc, { force: true });
      // Guarded like the rmSync above: if runScript threw before dist existed
      // (fresh checkout — dist is gitignored — plus a build failure, which the
      // script signals via process.exit(1)), an unguarded readdirSync would
      // throw ENOENT out of the finally and replace the real build error.
      if (fs.existsSync(distDir)) {
        for (const name of fs.readdirSync(distDir)) {
          if (name.startsWith(probeStem)) fs.rmSync(path.join(distDir, name), { force: true });
        }
      }
    }
  }, 60000);
});
