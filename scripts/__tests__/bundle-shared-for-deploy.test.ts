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
});
