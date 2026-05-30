/**
 * Pre-deploy script for Cloud Functions.
 *
 * Replaces every "workspace:*" reference that apps/functions transitively
 * depends on with "file:./<package>-bundle". This is needed because Firebase
 * deploy uses npm (not pnpm) which doesn't understand the workspace: protocol.
 *
 * Bundled packages:
 *   - @ejm/shared-core      → apps/functions/shared-core-bundle/
 *   - @ejm/shared           → apps/functions/shared-bundle/
 *   - @ejm/shared-functions → apps/functions/shared-functions-bundle/
 *
 * Within each bundle's package.json, any workspace:* deps on sibling packages
 * are rewritten to file:../<sibling>-bundle so npm can resolve the full chain
 * without ever seeing a workspace: protocol.
 *
 * Run before `firebase deploy --only functions`. Cleanup with
 * `unbundle-shared-after-deploy.js`.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const functionsDir = path.resolve(repoRoot, 'apps/functions');

/**
 * Bundle one workspace package into apps/functions/<bundleName>/.
 *
 * @param {string} pkgFilter      pnpm filter, e.g. '@ejm/shared'
 * @param {string} pkgDirAbs      absolute path to packages/<name>
 * @param {string} bundleName     dir name under apps/functions/, e.g. 'shared-bundle'
 */
function bundlePackage(pkgFilter, pkgDirAbs, bundleName) {
  const bundleDir = path.join(functionsDir, bundleName);

  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true });
  }
  fs.mkdirSync(bundleDir, { recursive: true });

  // Build the package first (CJS output needed for Cloud Functions).
  try {
    execSync(`pnpm --filter ${pkgFilter} build`, { cwd: repoRoot, stdio: 'inherit' });
  } catch (e) {
    console.error(`Failed to build ${pkgFilter}`);
    process.exit(1);
  }

  // Copy src.
  const srcDir = path.join(pkgDirAbs, 'src');
  fs.cpSync(srcDir, path.join(bundleDir, 'src'), { recursive: true });

  // Copy dist.
  const distDir = path.join(pkgDirAbs, 'dist');
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, path.join(bundleDir, 'dist'), { recursive: true });
  }

  // Copy package.json and tsconfigs.
  fs.copyFileSync(path.join(pkgDirAbs, 'package.json'), path.join(bundleDir, 'package.json'));
  for (const tsconfig of ['tsconfig.json', 'tsconfig.cjs.json']) {
    const src = path.join(pkgDirAbs, tsconfig);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(bundleDir, tsconfig));
    }
  }

  return bundleDir;
}

/**
 * Rewrite any workspace:* deps in a bundled package's package.json to point
 * at sibling bundle directories. Keeps non-workspace deps untouched.
 */
function rewriteBundlePackageJson(bundleDir, workspaceDepToBundleName) {
  const pkgPath = path.join(bundleDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let changed = false;
  for (const [depName, bundleName] of Object.entries(workspaceDepToBundleName)) {
    if (pkg.dependencies && pkg.dependencies[depName] === 'workspace:*') {
      pkg.dependencies[depName] = `file:../${bundleName}`;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// 1. Bundle @ejm/shared-core first (leaf — no workspace deps of its own).
const sharedCoreDir = path.resolve(repoRoot, 'packages/shared-core');
bundlePackage('@ejm/shared-core', sharedCoreDir, 'shared-core-bundle');

// 2. Bundle @ejm/shared and rewrite its @ejm/shared-core dep to point at the
//    sibling shared-core-bundle (instead of the unresolvable workspace:*).
const sharedDir = path.resolve(repoRoot, 'packages/shared');
const sharedBundleDir = bundlePackage('@ejm/shared', sharedDir, 'shared-bundle');
rewriteBundlePackageJson(sharedBundleDir, {
  '@ejm/shared-core': 'shared-core-bundle',
});

// 3. Bundle @ejm/shared-functions and rewrite its workspace deps.
//    It depends on both @ejm/shared-core and @ejm/shared, so both must be
//    rewritten to point at the sibling bundles already created above.
const sharedFunctionsDir = path.resolve(repoRoot, 'packages/shared-functions');
const sharedFunctionsBundleDir = bundlePackage(
  '@ejm/shared-functions',
  sharedFunctionsDir,
  'shared-functions-bundle',
);
rewriteBundlePackageJson(sharedFunctionsBundleDir, {
  '@ejm/shared-core': 'shared-core-bundle',
  '@ejm/shared': 'shared-bundle',
});

// 4. Update apps/functions/package.json to use the bundled shared packages.
const pkgPath = path.join(functionsDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies['@ejm/shared'] = 'file:./shared-bundle';
pkg.dependencies['@ejm/shared-functions'] = 'file:./shared-functions-bundle';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

console.log('✔ Shared packages bundled for deploy');
console.log('  → shared-bundle/ + shared-core-bundle/ + shared-functions-bundle/ created in apps/functions/');
console.log('  → shared-bundle/package.json rewrites @ejm/shared-core → file:../shared-core-bundle');
console.log('  → shared-functions-bundle/package.json rewrites @ejm/shared-core + @ejm/shared to file: refs');
console.log('  → apps/functions/package.json updated with file: references for @ejm/shared + @ejm/shared-functions');
