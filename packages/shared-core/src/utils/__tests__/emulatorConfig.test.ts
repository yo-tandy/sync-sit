import { describe, it, expect } from 'vitest';
import {
  resolveEmulatorConfig,
  DEFAULT_EMULATOR_HOST,
  DEFAULT_EMULATOR_PORTS,
  MAX_EMULATOR_LANE,
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
});
