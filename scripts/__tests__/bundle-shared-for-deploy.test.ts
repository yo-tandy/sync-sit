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

    const offenders = listBundleFiles().filter(
      (f) => /(^|\/)__tests__\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f),
    );
    expect(offenders).toEqual([]);
  }, 60000);

  // The other half of the same guard: the filter must remove test files and
  // NOTHING else. Asserted against the source packages rather than a golden
  // list, so a new runtime file is covered the day it is added.
  it('still copies every non-test source file of every bundled package', () => {
    runScript(bundleScript);

    const bundled = new Set(listBundleFiles());
    const missing: string[] = [];

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
      const pkgSrc = path.join(repoRoot, 'packages', pkgName, 'src');
      const sources: string[] = [];
      walk(pkgSrc, sources);

      for (const rel of sources) {
        const inPkg = path.relative(pkgSrc, path.join(repoRoot, rel));
        if (/(^|\/)__tests__\//.test(inPkg) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(inPkg)) continue;
        for (const appDir of appDirs) {
          const expected = path.join(appDir, bundleName, 'src', inPkg);
          if (!bundled.has(expected)) missing.push(expected);
        }
      }
    }

    expect(missing).toEqual([]);
    // Sanity floor: the loop above must actually have found sources to check.
    expect(bundled.size).toBeGreaterThan(1000);
  }, 60000);
});
