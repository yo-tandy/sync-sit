/**
 * Post-deploy script for Cloud Functions.
 *
 * Reverses the bundle-shared-for-deploy.js work:
 *   - Restores apps/functions/package.json workspace:* references.
 *   - Removes apps/functions/sit-core-bundle/, shared-core-bundle/,
 *     study-core-bundle/, and shared-functions-bundle/.
 */

const fs = require('fs');
const path = require('path');

const functionsDir = path.resolve(__dirname, '../apps/functions');
const studyFunctionsDir = path.resolve(__dirname, '../apps/study-functions');

function restoreWorkspaceDeps(sourceDir, depNames) {
  const pkgPath = path.join(sourceDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const depName of depNames) {
    if (pkg.dependencies && depName in pkg.dependencies) {
      pkg.dependencies[depName] = 'workspace:*';
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// 1. Restore workspace references.
restoreWorkspaceDeps(functionsDir, ['@ejm/sit-core', '@ejm/shared-functions']);
restoreWorkspaceDeps(studyFunctionsDir, [
  '@ejm/shared-core',
  '@ejm/sit-core',
  '@ejm/study-core',
  '@ejm/shared-functions',
]);

// 2. Clean up bundles.
for (const sourceDir of [functionsDir, studyFunctionsDir]) {
  for (const bundleName of [
    'shared-core-bundle',
    'sit-core-bundle',
    'study-core-bundle',
    'shared-functions-bundle',
  ]) {
    const bundleDir = path.join(sourceDir, bundleName);
    if (fs.existsSync(bundleDir)) {
      fs.rmSync(bundleDir, { recursive: true });
    }
  }
}

console.log(
  '✔ Restored workspace:* references and cleaned up shared-core-bundle + sit-core-bundle + study-core-bundle + shared-functions-bundle',
);
