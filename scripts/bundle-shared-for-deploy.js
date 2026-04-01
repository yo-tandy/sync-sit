/**
 * Pre-deploy script for Cloud Functions.
 * Replaces "workspace:*" in package.json with "file:./shared-bundle"
 * and copies the shared package into functions/shared-bundle.
 * This is needed because Firebase deploy uses npm (not pnpm) which
 * doesn't understand the workspace: protocol.
 */

const fs = require('fs');
const path = require('path');

const functionsDir = path.resolve(__dirname, '../apps/functions');
const sharedDir = path.resolve(__dirname, '../packages/shared');
const bundleDir = path.join(functionsDir, 'shared-bundle');

// 1. Copy shared package into functions/shared-bundle
if (fs.existsSync(bundleDir)) {
  fs.rmSync(bundleDir, { recursive: true });
}
fs.mkdirSync(bundleDir, { recursive: true });

// Copy src
const srcDir = path.join(sharedDir, 'src');
fs.cpSync(srcDir, path.join(bundleDir, 'src'), { recursive: true });

// Copy package.json and tsconfig
fs.copyFileSync(path.join(sharedDir, 'package.json'), path.join(bundleDir, 'package.json'));
if (fs.existsSync(path.join(sharedDir, 'tsconfig.json'))) {
  fs.copyFileSync(path.join(sharedDir, 'tsconfig.json'), path.join(bundleDir, 'tsconfig.json'));
}
if (fs.existsSync(path.join(sharedDir, 'tsconfig.cjs.json'))) {
  fs.copyFileSync(path.join(sharedDir, 'tsconfig.cjs.json'), path.join(bundleDir, 'tsconfig.cjs.json'));
}

// 2. Update package.json to use file: reference
const pkgPath = path.join(functionsDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@ejm/shared'] = 'file:./shared-bundle';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('✔ Shared package bundled for deploy');
console.log('  → shared-bundle created in apps/functions/');
console.log('  → package.json updated with file: reference');
