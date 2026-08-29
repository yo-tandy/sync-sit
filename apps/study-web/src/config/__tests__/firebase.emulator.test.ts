import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * apps/study-web's emulator wiring (issue #358).
 *
 * Two things this pins, and they pull in opposite directions:
 *
 *  1. With NO VITE_EMULATOR_* vars set, the dev build still connects to
 *     exactly the lane-1 endpoint the file used to hardcode —
 *     localhost 9099/8080/5001/9199. `pnpm dev` must not have changed.
 *  2. With the vars set, they are honored, so an e2e run can point this app
 *     at its own lane instead of commandeering the shared dev stack.
 *
 * This is deliberately a test of THIS APP's config module, not of the shared
 * resolver (that one has its own tests in @ejm/shared-core): the failure it
 * is here to catch is one of the three apps drifting away from the shared
 * shape, which a resolver test cannot see.
 *
 * The identical file exists in apps/web, apps/study-web and apps/do-web.
 */

const emu = vi.hoisted(() => ({
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
  connectStorageEmulator: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ __kind: 'auth' })),
  connectAuthEmulator: emu.connectAuthEmulator,
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ __kind: 'firestore' })),
  connectFirestoreEmulator: emu.connectFirestoreEmulator,
}));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ __kind: 'functions' })),
  connectFunctionsEmulator: emu.connectFunctionsEmulator,
}));
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({ __kind: 'storage' })),
  connectStorageEmulator: emu.connectStorageEmulator,
}));
vi.mock('firebase/messaging', () => ({
  getMessaging: vi.fn(() => ({ __kind: 'messaging' })),
  isSupported: vi.fn(async () => false),
}));

type Endpoint = {
  authUrl: unknown;
  firestore: [unknown, unknown];
  functions: [unknown, unknown];
  storage: [unknown, unknown];
};

/** Re-import the config module under the currently stubbed env. */
async function connectedEndpoint(): Promise<Endpoint> {
  vi.resetModules();
  for (const fn of Object.values(emu)) fn.mockClear();
  await import('../firebase');
  return {
    authUrl: emu.connectAuthEmulator.mock.calls[0]?.[1],
    firestore: [
      emu.connectFirestoreEmulator.mock.calls[0]?.[1],
      emu.connectFirestoreEmulator.mock.calls[0]?.[2],
    ],
    functions: [
      emu.connectFunctionsEmulator.mock.calls[0]?.[1],
      emu.connectFunctionsEmulator.mock.calls[0]?.[2],
    ],
    storage: [
      emu.connectStorageEmulator.mock.calls[0]?.[1],
      emu.connectStorageEmulator.mock.calls[0]?.[2],
    ],
  };
}

describe('apps/study-web firebase emulator wiring', () => {
  beforeEach(() => {
    // The whole block is behind `import.meta.env.DEV`; make the premise
    // explicit rather than letting a false DEV silently pass every
    // "was not called" style assertion.
    expect(import.meta.env.DEV).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('connects to the lane-1 defaults when no VITE_EMULATOR_* var is set', async () => {
    // These four literals are what this file hardcoded before #358.
    expect(await connectedEndpoint()).toEqual({
      authUrl: 'http://localhost:9099',
      firestore: ['localhost', 8080],
      functions: ['localhost', 5001],
      storage: ['localhost', 9199],
    });
  });

  it('honors VITE_EMULATOR_LANE for all four services', async () => {
    vi.stubEnv('VITE_EMULATOR_LANE', '3');
    // The ports firebase.lane3.json defines.
    expect(await connectedEndpoint()).toEqual({
      authUrl: 'http://localhost:29099',
      firestore: ['localhost', 28080],
      functions: ['localhost', 25001],
      storage: ['localhost', 29199],
    });
  });

  it('honors the individual port vars', async () => {
    vi.stubEnv('VITE_EMULATOR_AUTH_PORT', '19099');
    vi.stubEnv('VITE_EMULATOR_FIRESTORE_PORT', '18080');
    vi.stubEnv('VITE_EMULATOR_FUNCTIONS_PORT', '15001');
    vi.stubEnv('VITE_EMULATOR_STORAGE_PORT', '19199');
    expect(await connectedEndpoint()).toEqual({
      authUrl: 'http://localhost:19099',
      firestore: ['localhost', 18080],
      functions: ['localhost', 15001],
      storage: ['localhost', 19199],
    });
  });

  it('honors VITE_EMULATOR_HOST', async () => {
    vi.stubEnv('VITE_EMULATOR_HOST', '127.0.0.1');
    expect(await connectedEndpoint()).toEqual({
      authUrl: 'http://127.0.0.1:9099',
      firestore: ['127.0.0.1', 8080],
      functions: ['127.0.0.1', 5001],
      storage: ['127.0.0.1', 9199],
    });
  });

  it('a malformed lane throws instead of silently connecting to lane 1', async () => {
    vi.stubEnv('VITE_EMULATOR_LANE', 'three');
    vi.resetModules();
    for (const fn of Object.values(emu)) fn.mockClear();
    await expect(import('../firebase')).rejects.toThrow('VITE_EMULATOR_LANE');
    expect(emu.connectFirestoreEmulator).not.toHaveBeenCalled();
  });
});
