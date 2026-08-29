import { describe, it, expect } from 'vitest';
import {
  assertEmulatorAdminHostsAgree,
  emulatorAdminHosts,
  resolveEmulatorConfig,
  resolveNodeEmulatorConfig,
  DEFAULT_EMULATOR_HOST,
  DEFAULT_EMULATOR_PORTS,
  MAX_EMULATOR_LANE,
  NODE_EMULATOR_ENV_PREFIX,
  NODE_EMULATOR_LANE_ALIASES,
  VITE_EMULATOR_ENV_PREFIX,
} from '../emulatorConfig.js';

describe('resolveEmulatorConfig', () => {
  describe('defaults (issue #358: dev behavior must not change)', () => {
    // These are the literals the three apps hardcoded before #358. If this
    // test needs updating, `pnpm dev` just changed for everyone.
    it('returns the historical lane-1 endpoint with no env at all', () => {
      expect(resolveEmulatorConfig()).toEqual({
        host: 'localhost',
        lane: 1,
        authPort: 9099,
        authUrl: 'http://localhost:9099',
        firestorePort: 8080,
        functionsPort: 5001,
        storagePort: 9199,
      });
    });

    it('returns the same with an env that has no emulator vars', () => {
      const config = resolveEmulatorConfig({
        DEV: true,
        MODE: 'development',
        VITE_FIREBASE_PROJECT_ID: 'demo-test',
      });
      expect(config).toEqual(resolveEmulatorConfig());
    });

    it('exports defaults matching the historical hardcoded values', () => {
      expect(DEFAULT_EMULATOR_HOST).toBe('localhost');
      expect(DEFAULT_EMULATOR_PORTS).toEqual({
        auth: 9099,
        firestore: 8080,
        functions: 5001,
        storage: 9199,
      });
    });

    it('treats empty and whitespace-only vars as unset', () => {
      const config = resolveEmulatorConfig({
        VITE_EMULATOR_HOST: '',
        VITE_EMULATOR_LANE: '   ',
        VITE_EMULATOR_AUTH_PORT: '',
        VITE_EMULATOR_FIRESTORE_PORT: '  ',
        VITE_EMULATOR_FUNCTIONS_PORT: '',
        VITE_EMULATOR_STORAGE_PORT: '',
      });
      expect(config).toEqual(resolveEmulatorConfig());
    });

    it('ignores non-string values (Vite puts booleans in import.meta.env)', () => {
      const config = resolveEmulatorConfig({
        VITE_EMULATOR_LANE: false,
        VITE_EMULATOR_AUTH_PORT: null,
        VITE_EMULATOR_HOST: undefined,
      });
      expect(config).toEqual(resolveEmulatorConfig());
    });
  });

  describe('per-port overrides', () => {
    it('honors each port var independently', () => {
      const config = resolveEmulatorConfig({
        VITE_EMULATOR_AUTH_PORT: '29099',
        VITE_EMULATOR_FIRESTORE_PORT: '28080',
        VITE_EMULATOR_FUNCTIONS_PORT: '25001',
        VITE_EMULATOR_STORAGE_PORT: '29199',
      });
      expect(config.authPort).toBe(29099);
      expect(config.authUrl).toBe('http://localhost:29099');
      expect(config.firestorePort).toBe(28080);
      expect(config.functionsPort).toBe(25001);
      expect(config.storagePort).toBe(29199);
    });

    it('overriding one port leaves the others at their defaults', () => {
      const config = resolveEmulatorConfig({ VITE_EMULATOR_FIRESTORE_PORT: '28080' });
      expect(config.firestorePort).toBe(28080);
      expect(config.authPort).toBe(9099);
      expect(config.functionsPort).toBe(5001);
      expect(config.storagePort).toBe(9199);
    });

    it('honors the host var, including in the auth origin', () => {
      const config = resolveEmulatorConfig({ VITE_EMULATOR_HOST: '127.0.0.1' });
      expect(config.host).toBe('127.0.0.1');
      expect(config.authUrl).toBe('http://127.0.0.1:9099');
    });

    it('trims surrounding whitespace', () => {
      const config = resolveEmulatorConfig({
        VITE_EMULATOR_HOST: '  127.0.0.1 ',
        VITE_EMULATOR_FIRESTORE_PORT: ' 28080 ',
      });
      expect(config.host).toBe('127.0.0.1');
      expect(config.firestorePort).toBe(28080);
    });
  });

  describe('lane selection', () => {
    // The offsets firebase.lane{2,3,4}.json already encode — see
    // docs/emulator-lanes.md. Written out rather than computed so a drift
    // between this and the lane configs fails here.
    it.each([
      [1, { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 }],
      [2, { auth: 19099, firestore: 18080, functions: 15001, storage: 19199 }],
      [3, { auth: 29099, firestore: 28080, functions: 25001, storage: 29199 }],
      [4, { auth: 39099, firestore: 38080, functions: 35001, storage: 39199 }],
    ])('lane %i matches firebase.laneN.json', (lane, ports) => {
      const config = resolveEmulatorConfig({ VITE_EMULATOR_LANE: String(lane) });
      expect(config.lane).toBe(lane);
      expect(config.authPort).toBe(ports.auth);
      expect(config.firestorePort).toBe(ports.firestore);
      expect(config.functionsPort).toBe(ports.functions);
      expect(config.storagePort).toBe(ports.storage);
    });

    it('an explicit port var beats the lane-derived port', () => {
      const config = resolveEmulatorConfig({
        VITE_EMULATOR_LANE: '3',
        VITE_EMULATOR_FUNCTIONS_PORT: '25555',
      });
      expect(config.functionsPort).toBe(25555);
      // ...and the rest still follow the lane.
      expect(config.firestorePort).toBe(28080);
      expect(config.authUrl).toBe('http://localhost:29099');
    });
  });

  describe('malformed values throw rather than silently hitting lane 1', () => {
    it.each([
      ['VITE_EMULATOR_LANE', 'three'],
      ['VITE_EMULATOR_LANE', '0'],
      ['VITE_EMULATOR_LANE', String(MAX_EMULATOR_LANE + 1)],
      ['VITE_EMULATOR_AUTH_PORT', 'nine-thousand'],
      ['VITE_EMULATOR_FIRESTORE_PORT', '8080abc'],
      ['VITE_EMULATOR_FUNCTIONS_PORT', '0'],
      ['VITE_EMULATOR_STORAGE_PORT', '70000'],
      ['VITE_EMULATOR_STORAGE_PORT', '-1'],
    ])('%s=%s', (key, value) => {
      expect(() => resolveEmulatorConfig({ [key]: value })).toThrow(key);
    });
  });

  describe('prefix option', () => {
    it('defaults to the Vite prefix', () => {
      expect(VITE_EMULATOR_ENV_PREFIX).toBe('VITE_EMULATOR_');
      expect(resolveEmulatorConfig({ VITE_EMULATOR_LANE: '3' })).toEqual(
        resolveEmulatorConfig({ VITE_EMULATOR_LANE: '3' }, { prefix: 'VITE_EMULATOR_' }),
      );
    });

    it('reads a custom prefix and ignores the other one', () => {
      const config = resolveEmulatorConfig(
        { EMULATOR_LANE: '3', VITE_EMULATOR_LANE: '2' },
        { prefix: 'EMULATOR_' },
      );
      expect(config.lane).toBe(3);
      expect(config.firestorePort).toBe(28080);
    });

    it('honors defaultHost when no host var is set', () => {
      const config = resolveEmulatorConfig({}, { defaultHost: '127.0.0.1' });
      expect(config.host).toBe('127.0.0.1');
      expect(config.authUrl).toBe('http://127.0.0.1:9099');
    });

    it('the host var still beats defaultHost', () => {
      const config = resolveEmulatorConfig(
        { VITE_EMULATOR_HOST: 'example.test' },
        { defaultHost: '127.0.0.1' },
      );
      expect(config.host).toBe('example.test');
    });
  });
});

describe('resolveNodeEmulatorConfig (issue #376: lane-aware seed scripts)', () => {
  describe('defaults (seeding must not change for anyone who sets nothing)', () => {
    // These are the literals seed-admin.cjs and seed-test-data.cjs hardcoded
    // before #376. If this test needs updating, `pnpm seed:admin` just changed
    // which stack it writes to — which is the whole hazard.
    it('seed-admin.cjs default target is still localhost:8080 / localhost:9099', () => {
      const emulator = resolveNodeEmulatorConfig({}, { defaultHost: 'localhost' });
      expect(`${emulator.host}:${emulator.firestorePort}`).toBe('localhost:8080');
      expect(`${emulator.host}:${emulator.authPort}`).toBe('localhost:9099');
    });

    it('seed-test-data.cjs default target is still 127.0.0.1:8080 / 127.0.0.1:9099', () => {
      const emulator = resolveNodeEmulatorConfig({}, { defaultHost: '127.0.0.1' });
      expect(`${emulator.host}:${emulator.firestorePort}`).toBe('127.0.0.1:8080');
      expect(`${emulator.host}:${emulator.authPort}`).toBe('127.0.0.1:9099');
    });

    it('with no defaultHost falls back to the shared default host', () => {
      expect(resolveNodeEmulatorConfig().host).toBe(DEFAULT_EMULATOR_HOST);
      expect(resolveNodeEmulatorConfig()).toEqual(resolveEmulatorConfig());
    });

    it('a process.env full of unrelated vars changes nothing', () => {
      const config = resolveNodeEmulatorConfig({
        PATH: '/usr/bin',
        HOME: '/home/someone',
        SEED_PROJECT_ID: 'demo-test',
        FIRESTORE_EMULATOR_HOST: 'localhost:8080',
      });
      expect(config).toEqual(resolveNodeEmulatorConfig());
    });
  });

  describe('lane selection', () => {
    it('uses the plain EMULATOR_ prefix, not VITE_', () => {
      expect(NODE_EMULATOR_ENV_PREFIX).toBe('EMULATOR_');
    });

    // Same table as the browser resolver's, asserted through the node entry
    // point: the seeder and the app must agree on where lane N is, or seeding
    // lane 3 while the browser reads lane 3 quietly fails.
    it.each([
      [1, { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 }],
      [2, { auth: 19099, firestore: 18080, functions: 15001, storage: 19199 }],
      [3, { auth: 29099, firestore: 28080, functions: 25001, storage: 29199 }],
      [4, { auth: 39099, firestore: 38080, functions: 35001, storage: 39199 }],
    ])('EMULATOR_LANE=%i matches firebase.laneN.json', (lane, ports) => {
      const config = resolveNodeEmulatorConfig({ EMULATOR_LANE: String(lane) });
      expect(config.lane).toBe(lane);
      expect(config.authPort).toBe(ports.auth);
      expect(config.firestorePort).toBe(ports.firestore);
      expect(config.functionsPort).toBe(ports.functions);
      expect(config.storagePort).toBe(ports.storage);
      // ...and identical to what the web app resolves for the same lane.
      expect(config).toEqual(resolveEmulatorConfig({ VITE_EMULATOR_LANE: String(lane) }));
    });

    it.each(NODE_EMULATOR_LANE_ALIASES)('accepts %s as the lane var', (alias) => {
      const config = resolveNodeEmulatorConfig({ [alias]: '3' });
      expect(config.lane).toBe(3);
      expect(config.firestorePort).toBe(28080);
    });

    it('agreeing lane vars are fine', () => {
      const config = resolveNodeEmulatorConfig({ EMULATOR_LANE: '4', LANE: '4', E2E_LANE: '4' });
      expect(config.lane).toBe(4);
    });

    it('disagreeing lane vars throw rather than silently picking one', () => {
      expect(() => resolveNodeEmulatorConfig({ EMULATOR_LANE: '3', LANE: '4' })).toThrow(
        /different lanes/,
      );
      expect(() => resolveNodeEmulatorConfig({ LANE: '2', E2E_LANE: '3' })).toThrow(
        /different lanes/,
      );
    });

    it('the same lane spelled two ways is not a disagreement', () => {
      // Lanes are compared as parsed numbers, not raw strings.
      expect(resolveNodeEmulatorConfig({ LANE: '3', E2E_LANE: '03' }).lane).toBe(3);
      expect(resolveNodeEmulatorConfig({ EMULATOR_LANE: ' 4 ', LANE: '4' }).lane).toBe(4);
    });

    it('a malformed lane is reported as malformed, not as a disagreement', () => {
      // Every candidate is parsed before any are compared, so the reader is
      // sent at the typo rather than at a second var to go unset.
      expect(() => resolveNodeEmulatorConfig({ LANE: 'nine', E2E_LANE: '3' })).toThrow(
        'LANE must be a lane number, got "nine"',
      );
      expect(() => resolveNodeEmulatorConfig({ LANE: '3', E2E_LANE: '99' })).toThrow(
        `E2E_LANE must be between 1 and ${MAX_EMULATOR_LANE}`,
      );
    });

    it('an explicit port var beats the lane-derived port', () => {
      const config = resolveNodeEmulatorConfig({
        LANE: '3',
        EMULATOR_FIRESTORE_PORT: '28085',
      });
      expect(config.firestorePort).toBe(28085);
      expect(config.authPort).toBe(29099);
      expect(config.functionsPort).toBe(25001);
      expect(config.storagePort).toBe(29199);
    });

    it('honors EMULATOR_HOST over the caller default', () => {
      const config = resolveNodeEmulatorConfig(
        { EMULATOR_HOST: '127.0.0.1', LANE: '3' },
        { defaultHost: 'localhost' },
      );
      expect(config.host).toBe('127.0.0.1');
      expect(config.authUrl).toBe('http://127.0.0.1:29099');
    });
  });

  describe('the two namespaces do not leak into each other', () => {
    it('a VITE_ var in the environment does not move the seeder', () => {
      const config = resolveNodeEmulatorConfig({
        VITE_EMULATOR_LANE: '3',
        VITE_EMULATOR_HOST: 'example.test',
        VITE_EMULATOR_FIRESTORE_PORT: '28080',
      });
      expect(config).toEqual(resolveNodeEmulatorConfig());
    });

    it('a shell LANE does not move a browser build', () => {
      expect(resolveEmulatorConfig({ LANE: '3', EMULATOR_LANE: '3' })).toEqual(
        resolveEmulatorConfig(),
      );
    });
  });

  describe('malformed values throw rather than silently seeding lane 1', () => {
    it.each([
      ['EMULATOR_LANE', 'three'],
      ['EMULATOR_LANE', '0'],
      ['EMULATOR_LANE', String(MAX_EMULATOR_LANE + 1)],
      ['LANE', 'lane3'],
      ['E2E_LANE', '9'],
      ['EMULATOR_AUTH_PORT', 'nine-thousand'],
      ['EMULATOR_FIRESTORE_PORT', '8080abc'],
      ['EMULATOR_FUNCTIONS_PORT', '0'],
      ['EMULATOR_STORAGE_PORT', '70000'],
    ])('%s=%s', (key, value) => {
      expect(() => resolveNodeEmulatorConfig({ [key]: value })).toThrow(key);
    });
  });
});

describe('emulatorAdminHosts / assertEmulatorAdminHostsAgree', () => {
  it('composes the firebase-admin env pair the seed scripts set', () => {
    expect(emulatorAdminHosts(resolveNodeEmulatorConfig({}, { defaultHost: 'localhost' }))).toEqual({
      FIRESTORE_EMULATOR_HOST: 'localhost:8080',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
    });
    expect(emulatorAdminHosts(resolveNodeEmulatorConfig({ LANE: '3' }))).toEqual({
      FIRESTORE_EMULATOR_HOST: 'localhost:28080',
      FIREBASE_AUTH_EMULATOR_HOST: 'localhost:29099',
    });
  });

  it('passes when nothing is pre-set', () => {
    const config = resolveNodeEmulatorConfig({ LANE: '3' });
    expect(() => assertEmulatorAdminHostsAgree({ PATH: '/usr/bin' }, config)).not.toThrow();
  });

  it('passes when a pre-set value agrees with the resolved lane', () => {
    const env = {
      LANE: '3',
      FIRESTORE_EMULATOR_HOST: 'localhost:28080',
      FIREBASE_AUTH_EMULATOR_HOST: ' localhost:29099 ',
    };
    expect(() =>
      assertEmulatorAdminHostsAgree(env, resolveNodeEmulatorConfig(env)),
    ).not.toThrow();
  });

  it.each([
    ['FIRESTORE_EMULATOR_HOST', 'localhost:28080'],
    ['FIREBASE_AUTH_EMULATOR_HOST', 'localhost:29099'],
  ])('throws when %s is exported for another lane and no lane var is set', (key, staleValue) => {
    // The silent version of this seeds lane 1 — the shared dev stack — while
    // the operator believes they are on lane 3.
    const env = { [key]: staleValue };
    const config = resolveNodeEmulatorConfig(env, { defaultHost: 'localhost' });
    expect(() => assertEmulatorAdminHostsAgree(env, config)).toThrow(key);
    expect(() => assertEmulatorAdminHostsAgree(env, config)).toThrow(staleValue);
    expect(() => assertEmulatorAdminHostsAgree(env, config)).toThrow('lane 1');
  });

  it('throws when a pre-set host disagrees with an explicit lane var', () => {
    const env = { LANE: '4', FIRESTORE_EMULATOR_HOST: 'localhost:8080' };
    expect(() => assertEmulatorAdminHostsAgree(env, resolveNodeEmulatorConfig(env))).toThrow(
      /FIRESTORE_EMULATOR_HOST.*lane 4/s,
    );
  });
});
