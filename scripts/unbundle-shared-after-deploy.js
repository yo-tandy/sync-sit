/**
 * Post-deploy script for Cloud Functions.
 *
 * Reverses the bundle-shared-for-deploy.js work:
 *   - Restores apps/functions/package.json workspace:* references.
 *   - Removes apps/functions/shared-bundle/, shared-core-bundle/, and
 *     shared-functions-bundle/.
 */

const fs = require('fs');
const path = require('path');

const functionsDir = path.resolve(__dirname, '../apps/functions');

// 1. Restore workspace references.
const pkgPath = path.join(functionsDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@ejm/shared'] = 'workspace:*';
pkg.dependencies['@ejm/shared-functions'] = 'workspace:*';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Clean up bundles.
for (const bundleName of ['shared-bundle', 'shared-core-bundle', 'shared-functions-bundle']) {
  const bundleDir = path.join(functionsDir, bundleName);
  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true });
  }
}

console.log('✔ Restored workspace:* references and cleaned up shared-bundle + shared-core-bundle + shared-functions-bundle');
