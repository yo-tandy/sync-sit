/**
 * Pre-deploy script for Cloud Functions.
 *
 * Replaces every "workspace:*" reference that apps/functions transitively
 * depends on with "file:./<package>-bundle". This is needed because Firebase
 * deploy uses npm (not pnpm) which doesn't understand the workspace: protocol.
 *
 * Bundled packages:
 *   - @ejm/shared-core      → apps/functions/shared-core-bundle/
 *   - @ejm/sit-core         → apps/functions/sit-core-bundle/
 *   - @ejm/study-core       → apps/functions/study-core-bundle/
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
const studyFunctionsDir = path.resolve(repoRoot, 'apps/study-functions');

/**
 * Bundle one workspace package into apps/functions/<bundleName>/.
 *
 * @param {string} pkgFilter      pnpm filter, e.g. '@ejm/sit-core'
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

function updateSourcePackageJson(sourceDir, dependencyToBundlePath) {
  const pkgPath = path.join(sourceDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  for (const [depName, depPath] of Object.entries(dependencyToBundlePath)) {
    if (pkg.dependencies && depName in pkg.dependencies) {
      pkg.dependencies[depName] = depPath;
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// 1. Bundle @ejm/shared-core first (leaf — no workspace deps of its own).
const sharedCoreDir = path.resolve(repoRoot, 'packages/shared-core');
bundlePackage('@ejm/shared-core', sharedCoreDir, 'shared-core-bundle');

// 2. Bundle @ejm/sit-core and rewrite its @ejm/shared-core dep to point at the
//    sibling shared-core-bundle (instead of the unresolvable workspace:*).
const sitCoreDir = path.resolve(repoRoot, 'packages/sit-core');
const sitCoreBundleDir = bundlePackage('@ejm/sit-core', sitCoreDir, 'sit-core-bundle');
rewriteBundlePackageJson(sitCoreBundleDir, {
  '@ejm/shared-core': 'shared-core-bundle',
});

// 3. Bundle @ejm/shared-functions and rewrite its workspace deps.
//    It depends on both @ejm/shared-core and @ejm/sit-core, so both must be
//    rewritten to point at the sibling bundles already created above.
const sharedFunctionsDir = path.resolve(repoRoot, 'packages/shared-functions');
const sharedFunctionsBundleDir = bundlePackage(
  '@ejm/shared-functions',
  sharedFunctionsDir,
  'shared-functions-bundle',
);
rewriteBundlePackageJson(sharedFunctionsBundleDir, {
  '@ejm/shared-core': 'shared-core-bundle',
  '@ejm/sit-core': 'sit-core-bundle',
});

// 4. Bundle @ejm/study-core and rewrite its @ejm/shared-core dep.
const studyCoreDir = path.resolve(repoRoot, 'packages/study-core');
const studyCoreBundleDir = bundlePackage('@ejm/study-core', studyCoreDir, 'study-core-bundle');
rewriteBundlePackageJson(studyCoreBundleDir, {
  '@ejm/shared-core': 'shared-core-bundle',
});

// 5. Update apps/functions/package.json to use the bundled shared packages.
updateSourcePackageJson(functionsDir, {
  '@ejm/sit-core': 'file:./sit-core-bundle',
  '@ejm/shared-functions': 'file:./shared-functions-bundle',
});

// 6. Mirror shared bundles into apps/study-functions and rewrite workspace deps.
for (const bundleName of [
  'shared-core-bundle',
  'sit-core-bundle',
  'study-core-bundle',
  'shared-functions-bundle',
]) {
  const sourceBundleDir = path.join(functionsDir, bundleName);
  const targetBundleDir = path.join(studyFunctionsDir, bundleName);
  if (fs.existsSync(targetBundleDir)) {
    fs.rmSync(targetBundleDir, { recursive: true });
  }
  fs.cpSync(sourceBundleDir, targetBundleDir, { recursive: true });
}
updateSourcePackageJson(studyFunctionsDir, {
  '@ejm/shared-core': 'file:./shared-core-bundle',
  '@ejm/sit-core': 'file:./sit-core-bundle',
  '@ejm/study-core': 'file:./study-core-bundle',
  '@ejm/shared-functions': 'file:./shared-functions-bundle',
});

console.log('✔ Shared packages bundled for deploy');
console.log(
  '  → shared-core-bundle/ + sit-core-bundle/ + study-core-bundle/ + shared-functions-bundle/ created in apps/functions/',
);
console.log('  → sit-core-bundle/package.json rewrites @ejm/shared-core → file:../shared-core-bundle');
console.log('  → study-core-bundle/package.json rewrites @ejm/shared-core → file:../shared-core-bundle');
console.log('  → shared-functions-bundle/package.json rewrites @ejm/shared-core + @ejm/sit-core to file: refs');
console.log('  → apps/functions/package.json updated with file: references for @ejm/sit-core + @ejm/shared-functions');
console.log(
  '  → apps/study-functions/package.json updated with file: references for @ejm/shared-core + @ejm/sit-core + @ejm/study-core + @ejm/shared-functions',
);
