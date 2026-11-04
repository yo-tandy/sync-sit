import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contract pins for issue #413.
 *
 * #406 fixed the TYPECHECK half of "a stale packages/*\/dist misleads" by
 * making `types` resolve to source first. The RUNTIME half was left open:
 * `require` still points at `./dist/*.js` by design, so `pnpm emulators`
 * loading `apps/functions/dist` (which in turn `require`s `packages/*\/dist`)
 * runs whatever was last built — possibly nothing, possibly stale — with no
 * build step anywhere in the chain. `pnpm seed:admin` / `seed:test-data`
 * already build `@ejm/shared-core` first; `firebase deploy` builds through
 * `predeploy`. The emulator path (and the `firebase emulators:exec`-based
 * integration lanes, which hit the same `functions`/`study` codebases) were
 * the uncovered ones.
 *
 * Asserted on the parsed script STRING, so a comment or README note claiming
 * "builds automatically" cannot satisfy the pin — the command actually run
 * by `pnpm <script>` has to contain the build.
 */
const rootManifest = () =>
  JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

/** True if `script` runs `dep` (as a `pnpm <dep>` step) strictly before `marker` appears. */
function runsBefore(script: string, dep: string, marker: string): boolean {
  const depIdx = script.indexOf(`pnpm ${dep}`);
  const markerIdx = script.indexOf(marker);
  return depIdx !== -1 && markerIdx !== -1 && depIdx < markerIdx;
}

describe('emulator runtime build step (issue #413)', () => {
  it('defines a build chain covering shared packages and both functions codebases', () => {
    // Both codebases live under firebase.json's single "functions" section
    // (default = apps/functions, study = apps/study-functions), so `--only
    // functions` in an emulator command starts both — the chain has to build
    // both, not just apps/functions.
    const chain = rootManifest().scripts['build:emulator-deps'];
    expect(chain, 'package.json must keep a `build:emulator-deps` script').toBeDefined();
    expect(chain).toMatch(/pnpm\s+-r\s+--filter\s+'\.\/packages\/\*\*'\s+build/);
    expect(runsBefore(chain, '-r', 'build:functions')).toBe(true);
    expect(chain).toContain('pnpm build:functions');
    expect(chain).toContain('pnpm build:study-functions');
    expect(runsBefore(chain, 'build:functions', 'build:study-functions')).toBe(true);
  });

  it('`pnpm emulators` runs the build chain before starting the emulators', () => {
    const script = rootManifest().scripts.emulators;
    expect(runsBefore(script, 'build:emulator-deps', 'firebase emulators:start')).toBe(true);
  });

  it('every `firebase emulators:exec` lane also runs the build chain first', () => {
    // The lane2/3/4 integration scripts start the same `functions` codebases
    // as `pnpm emulators` (via emulators:exec rather than emulators:start),
    // and are invoked directly by developers rather than through CI — CI's
    // test.yml runs its own explicit build steps ahead of a hand-rolled
    // emulators:exec call, so it never goes through these scripts at all.
    const scripts = rootManifest().scripts;
    const execLanes = Object.entries(scripts).filter(([, body]) =>
      body.includes('firebase emulators:exec'),
    );
    // Floor: fails loudly if the lanes are ever renamed away from this scan
    // rather than passing vacuously on zero matches.
    expect(execLanes.length).toBeGreaterThanOrEqual(3);
    const unbuilt = execLanes
      .filter(([, body]) => !runsBefore(body, 'build:emulator-deps', 'firebase emulators:exec'))
      .map(([name]) => name);
    expect(unbuilt).toEqual([]);
  });
});
