import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const bundleScript = path.join(repoRoot, 'scripts/bundle-shared-for-deploy.js');
const unbundleScript = path.join(repoRoot, 'scripts/unbundle-shared-after-deploy.js');
const studyFunctionsDir = path.join(repoRoot, 'apps/study-functions');

function runScript(scriptPath: string) {
  execFileSync(process.execPath, [scriptPath], { cwd: repoRoot, stdio: 'inherit' });
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

afterEach(() => {
  runScript(unbundleScript);
});

describe('bundle-shared-for-deploy', () => {
  it('bundles and rewrites study-core for the study functions deploy', () => {
    runScript(bundleScript);

    const studyFunctionsPkg = readJson(path.join(studyFunctionsDir, 'package.json'));
    expect(studyFunctionsPkg.dependencies['@ejm/study-core']).toBe('file:./study-core-bundle');

    const studyCoreBundleDir = path.join(studyFunctionsDir, 'study-core-bundle');
    expect(fs.existsSync(studyCoreBundleDir)).toBe(true);

    const studyCoreBundlePkg = readJson(path.join(studyCoreBundleDir, 'package.json'));
    expect(studyCoreBundlePkg.dependencies['@ejm/shared-core']).toBe('file:../shared-core-bundle');
  });
});
