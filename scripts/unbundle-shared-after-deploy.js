/**
 * Post-deploy script for Cloud Functions.
 *
 * Reverses the bundle-shared-for-deploy.js work:
 *   - Restores apps/functions/package.json @ejm/shared → "workspace:*".
 *   - Removes apps/functions/shared-bundle/ and shared-core-bundle/.
 */

const fs = require('fs');
const path = require('path');

const functionsDir = path.resolve(__dirname, '../apps/functions');

// 1. Restore workspace reference.
const pkgPath = path.join(functionsDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@ejm/shared'] = 'workspace:*';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Clean up bundles.
for (const bundleName of ['shared-bundle', 'shared-core-bundle']) {
  const bundleDir = path.join(functionsDir, bundleName);
  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true });
  }
}

console.log('✔ Restored workspace:* reference and cleaned up shared-bundle + shared-core-bundle');
