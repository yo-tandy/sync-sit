/**
 * Where a web app's dev build should point its Firebase emulator
 * connections — resolved from `VITE_*` env, with the historical hardcoded
 * lane-1 values as the defaults.
 *
 * Why this exists: all three web apps used to hardcode `localhost` +
 * 9099/8080/5001/9199 under `import.meta.env.DEV`, so a browser-driven e2e
 * could only ever talk to lane 1 — the shared dev stack a human and other
 * agents are using, which at any moment may be serving a build that predates
 * the feature under test (issue #358). Reading the endpoint from env lets a
 * run select its own lane without disturbing anyone.
 *
 * Purely additive: with none of the vars set this returns exactly the values
 * the three apps hardcoded, so `pnpm dev` is unchanged.
 *
 * ── The vars ─────────────────────────────────────────────────────────────
 *   VITE_EMULATOR_HOST             host for every emulator   (default `localhost`)
 *   VITE_EMULATOR_LANE             1..6 — shifts all four ports by
 *                                  (lane - 1) * 10000, the offset
 *                                  firebase.lane{2,3,4}.json already encode
 *                                  (see docs/emulator-lanes.md)
 *   VITE_EMULATOR_AUTH_PORT        default 9099
 *   VITE_EMULATOR_FIRESTORE_PORT   default 8080
 *   VITE_EMULATOR_FUNCTIONS_PORT   default 5001
 *   VITE_EMULATOR_STORAGE_PORT     default 9199
 *
 * Precedence per port: the explicit `VITE_EMULATOR_<SERVICE>_PORT` wins, then
 * the lane-derived port, then the default. So `VITE_EMULATOR_LANE=3` is the
 * one-var way to move a whole app onto lane 3, and a single port var can
 * still be pinned on top of it.
 *
 * ── Failure mode ─────────────────────────────────────────────────────────
 * A malformed value THROWS rather than falling back. Silently falling back
 * would mean a typo in a lane selector points the app at lane 1 and it
 * WRITES to the shared dev stack — the exact accident these vars exist to
 * prevent. An unset or empty var is not malformed: it means "not set" and
 * takes the default, so an empty line in a `.env` file never breaks dev.
 *
 * Kept in @ejm/shared-core so apps/web, apps/study-web and apps/do-web share
 * one shape and cannot drift. It is a pure function over an env-shaped
 * record — it never touches `import.meta` itself — so it also builds under
 * the package's CJS (Cloud Functions) target and is trivially testable.
 */

/** The lane-1 host all three apps hardcoded. */
export const DEFAULT_EMULATOR_HOST = 'localhost';

/** The lane-1 ports all three apps hardcoded. */
export const DEFAULT_EMULATOR_PORTS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
  storage: 9199,
} as const;

/** Port shift per lane — what firebase.lane{2,3,4}.json already use. */
export const EMULATOR_LANE_PORT_OFFSET = 10_000;

/**
 * Highest selectable lane. Lane 7 would push storage to 69199, past the
 * 65535 ceiling, so 6 is the real limit rather than an arbitrary one.
 */
export const MAX_EMULATOR_LANE = 6;

/** `import.meta.env` shape: string values, plus Vite's own booleans. */
export type EmulatorEnvLike = Readonly<Record<string, unknown>>;

export interface EmulatorConfig {
  /** Host shared by all four emulators. */
  host: string;
  /** Resolved lane (1 when unset). Informational — ports are authoritative. */
  lane: number;
  /** `connectAuthEmulator` takes a full origin, not host + port. */
  authUrl: string;
  authPort: number;
  firestorePort: number;
  functionsPort: number;
  storagePort: number;
}

/** Read a var, treating unset / empty / whitespace-only as absent. */
function readVar(env: EmulatorEnvLike, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parsePort(env: EmulatorEnvLike, key: string): number | undefined {
  const value = readVar(env, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a port number, got "${value}"`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error(`${key} must be between 1 and 65535, got "${value}"`);
  }
  return port;
}

function parseLane(env: EmulatorEnvLike): number {
  const value = readVar(env, 'VITE_EMULATOR_LANE');
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) {
    throw new Error(`VITE_EMULATOR_LANE must be a lane number, got "${value}"`);
  }
  const lane = Number(value);
  if (lane < 1 || lane > MAX_EMULATOR_LANE) {
    throw new Error(
      `VITE_EMULATOR_LANE must be between 1 and ${MAX_EMULATOR_LANE}, got "${value}"`,
    );
  }
  return lane;
}

export function resolveEmulatorConfig(env: EmulatorEnvLike = {}): EmulatorConfig {
  const host = readVar(env, 'VITE_EMULATOR_HOST') ?? DEFAULT_EMULATOR_HOST;
  const lane = parseLane(env);
  const laneOffset = (lane - 1) * EMULATOR_LANE_PORT_OFFSET;

  const port = (key: string, base: number): number =>
    parsePort(env, key) ?? base + laneOffset;

  const authPort = port('VITE_EMULATOR_AUTH_PORT', DEFAULT_EMULATOR_PORTS.auth);

  return {
    host,
    lane,
    authPort,
    authUrl: `http://${host}:${authPort}`,
    firestorePort: port('VITE_EMULATOR_FIRESTORE_PORT', DEFAULT_EMULATOR_PORTS.firestore),
    functionsPort: port('VITE_EMULATOR_FUNCTIONS_PORT', DEFAULT_EMULATOR_PORTS.functions),
    storagePort: port('VITE_EMULATOR_STORAGE_PORT', DEFAULT_EMULATOR_PORTS.storage),
  };
}
