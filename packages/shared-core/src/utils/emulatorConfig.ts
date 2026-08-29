/**
 * Where a local process should point its Firebase emulator connections —
 * resolved from env, with the historical hardcoded lane-1 values as the
 * defaults.
 *
 * Why this exists: all three web apps used to hardcode `localhost` +
 * 9099/8080/5001/9199 under `import.meta.env.DEV`, so a browser-driven e2e
 * could only ever talk to lane 1 — the shared dev stack a human and other
 * agents are using, which at any moment may be serving a build that predates
 * the feature under test (issue #358). Reading the endpoint from env lets a
 * run select its own lane without disturbing anyone.
 *
 * The SEED scripts had the same problem for the same reason (issue #376):
 * they pinned lane 1 too, so pointing an app at lane 3 gave you an app
 * talking to an empty stack, and the workaround was a hand-patched copy of
 * the seed script per lane. They now call this same function — one
 * implementation, two kinds of caller, so the lane arithmetic cannot drift
 * between the browser and the seeder.
 *
 * Purely additive: with none of the vars set this returns exactly the values
 * the apps and the seed scripts hardcoded, so `pnpm dev` and `pnpm seed:admin`
 * are unchanged.
 *
 * ── The vars ─────────────────────────────────────────────────────────────
 * Browser callers pass `import.meta.env` and get the `VITE_EMULATOR_` prefix
 * (Vite only exposes `VITE_`-prefixed vars to a bundle). Node callers use
 * {@link resolveNodeEmulatorConfig}, which reads the same names off
 * `process.env` under the plain `EMULATOR_` prefix — a `VITE_` name in a
 * shell would be misleading, since nothing about a seed script is Vite.
 *
 *   <PREFIX>HOST             host for every emulator   (default `localhost`)
 *   <PREFIX>LANE             1..6 — shifts all four ports by
 *                            (lane - 1) * 10000, the offset
 *                            firebase.lane{2,3,4}.json already encode
 *                            (see docs/emulator-lanes.md)
 *   <PREFIX>AUTH_PORT        default 9099
 *   <PREFIX>FIRESTORE_PORT   default 8080
 *   <PREFIX>FUNCTIONS_PORT   default 5001
 *   <PREFIX>STORAGE_PORT     default 9199
 *
 * Precedence per port: the explicit `<PREFIX><SERVICE>_PORT` wins, then the
 * lane-derived port, then the default. So `<PREFIX>LANE=3` is the one-var way
 * to move a whole process onto lane 3, and a single port var can still be
 * pinned on top of it.
 *
 * ── Failure mode ─────────────────────────────────────────────────────────
 * A malformed value THROWS rather than falling back. Silently falling back
 * would mean a typo in a lane selector points the caller at lane 1 and it
 * WRITES to the shared dev stack — the exact accident these vars exist to
 * prevent. An unset or empty var is not malformed: it means "not set" and
 * takes the default, so an empty line in a `.env` file never breaks dev.
 *
 * Kept in @ejm/shared-core so apps/web, apps/study-web, apps/do-web and the
 * seed scripts share one shape and cannot drift. It is a pure function over
 * an env-shaped record — it never touches `import.meta` or `process` itself —
 * so it also builds under the package's CJS (Cloud Functions) target, which
 * is how the `.cjs` seed scripts consume it.
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

/**
 * Var-name prefix for a browser (Vite) caller. Vite only exposes
 * `VITE_`-prefixed vars to a bundle, so this prefix is not a choice.
 */
export const VITE_EMULATOR_ENV_PREFIX = 'VITE_EMULATOR_';

/**
 * Var-name prefix for a Node caller (the seed scripts). Plain, because a
 * `VITE_` name on a `node foo.cjs` command line reads as a mistake.
 */
export const NODE_EMULATOR_ENV_PREFIX = 'EMULATOR_';

/**
 * Extra names a Node caller accepts for the lane, after `EMULATOR_LANE`.
 *
 * `LANE=3 pnpm seed:admin` is what a human reaches for, and `E2E_LANE` is
 * already the var a Playwright run carries (`tests-e2e/lanes.ts`), so a full
 * e2e loop can export it once and have the seeder land in the same lane the
 * spec drives. Setting two of these to DIFFERENT lanes throws rather than
 * picking one — that disagreement is precisely how a run ends up writing to a
 * lane it did not mean to.
 */
export const NODE_EMULATOR_LANE_ALIASES = ['LANE', 'E2E_LANE'] as const;

/** `import.meta.env` / `process.env` shape: string values, plus Vite's own booleans. */
export type EmulatorEnvLike = Readonly<Record<string, unknown>>;

export interface ResolveEmulatorConfigOptions {
  /** Var-name prefix. Default {@link VITE_EMULATOR_ENV_PREFIX}. */
  prefix?: string;
  /**
   * Host used when `<PREFIX>HOST` is unset. Defaults to
   * {@link DEFAULT_EMULATOR_HOST}; the seed scripts differ (one has always
   * said `localhost`, the other `127.0.0.1`) and each keeps its own so that
   * running with no vars set stays byte-identical to what it did before.
   */
  defaultHost?: string;
  /**
   * Additional lane var names, consulted in order after `<PREFIX>LANE`.
   * See {@link NODE_EMULATOR_LANE_ALIASES}.
   */
  laneAliases?: readonly string[];
}

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

function parseLane(env: EmulatorEnvLike, laneKeys: readonly string[]): number {
  const set = laneKeys
    .map((key) => ({ key, value: readVar(env, key) }))
    .filter((entry): entry is { key: string; value: string } => entry.value !== undefined);

  if (set.length === 0) return 1;

  const [{ key, value }] = set;
  const disagreeing = set.find((entry) => entry.value !== value);
  if (disagreeing) {
    throw new Error(
      `${key}="${value}" and ${disagreeing.key}="${disagreeing.value}" name different lanes; set one`,
    );
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a lane number, got "${value}"`);
  }
  const lane = Number(value);
  if (lane < 1 || lane > MAX_EMULATOR_LANE) {
    throw new Error(`${key} must be between 1 and ${MAX_EMULATOR_LANE}, got "${value}"`);
  }
  return lane;
}

export function resolveEmulatorConfig(
  env: EmulatorEnvLike = {},
  options: ResolveEmulatorConfigOptions = {},
): EmulatorConfig {
  const {
    prefix = VITE_EMULATOR_ENV_PREFIX,
    defaultHost = DEFAULT_EMULATOR_HOST,
    laneAliases = [],
  } = options;

  const host = readVar(env, `${prefix}HOST`) ?? defaultHost;
  const lane = parseLane(env, [`${prefix}LANE`, ...laneAliases]);
  const laneOffset = (lane - 1) * EMULATOR_LANE_PORT_OFFSET;

  const port = (service: string, base: number): number =>
    parsePort(env, `${prefix}${service}_PORT`) ?? base + laneOffset;

  const authPort = port('AUTH', DEFAULT_EMULATOR_PORTS.auth);

  return {
    host,
    lane,
    authPort,
    authUrl: `http://${host}:${authPort}`,
    firestorePort: port('FIRESTORE', DEFAULT_EMULATOR_PORTS.firestore),
    functionsPort: port('FUNCTIONS', DEFAULT_EMULATOR_PORTS.functions),
    storagePort: port('STORAGE', DEFAULT_EMULATOR_PORTS.storage),
  };
}

/**
 * The Node-side preset: same resolver, `EMULATOR_` names off `process.env`,
 * and `LANE` / `E2E_LANE` also accepted for the lane.
 *
 * `defaultHost` exists so each seed script keeps the host literal it has
 * always used when nothing is set (issue #376's hard constraint: no env, no
 * change).
 */
export function resolveNodeEmulatorConfig(
  env: EmulatorEnvLike = {},
  options: { defaultHost?: string } = {},
): EmulatorConfig {
  return resolveEmulatorConfig(env, {
    prefix: NODE_EMULATOR_ENV_PREFIX,
    defaultHost: options.defaultHost ?? DEFAULT_EMULATOR_HOST,
    laneAliases: NODE_EMULATOR_LANE_ALIASES,
  });
}
