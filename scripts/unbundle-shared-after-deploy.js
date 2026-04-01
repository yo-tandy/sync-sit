/**
 * Post-deploy script for Cloud Functions.
 * Restores "workspace:*" in package.json and removes shared-bundle.
 */

const fs = require('fs');
const path = require('path');

const functionsDir = path.resolve(__dirname, '../apps/functions');
const bundleDir = path.join(functionsDir, 'shared-bundle');

// 1. Restore workspace reference
const pkgPath = path.join(functionsDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@ejm/shared'] = 'workspace:*';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Clean up bundle
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true });
}

console.log('✔ Restored workspace:* reference and cleaned up shared-bundle');
