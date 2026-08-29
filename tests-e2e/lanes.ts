/**
 * Which dev server a Playwright run targets — the browser-side half of the
 * emulator-lane story (issue #358).
 *
 * The apps read their emulator endpoint from `VITE_EMULATOR_*` env, so a dev
 * server can be pointed at any lane. What it cannot do is share lane 1's dev
 * PORT with the shared dev stack's server — two Vite servers on 5173 means
 * the second silently lands on 5174 and the spec drives the wrong app. So a
 * lane owns a dev port per app, one dial each side:
 *
 *   lane 1  sit 5173  study 5174  do 5175   (the shared dev stack — default)
 *   lane 2  sit 5273  study 5274  do 5275
 *   lane 3  sit 5373  study 5374  do 5375
 *   ...     +100 per lane
 *
 * Start the app under test on its lane, then run the spec against it:
 *
 *   VITE_EMULATOR_LANE=3 pnpm --filter do-web dev --port 5375 --strictPort
 *   E2E_APP=do E2E_LANE=3 pnpm exec playwright test tests-e2e/<spec>.spec.ts
 *
 * `PLAYWRIGHT_BASE_URL` still wins over both vars when set, and with nothing
 * set at all the base URL is `http://localhost:5173` exactly as before.
 *
 * See docs/emulator-lanes.md for the emulator side (`firebase.laneN.json`).
 */

export type E2eApp = 'sit' | 'study' | 'do';

/** Lane-1 Vite dev ports — apps/{web,study-web,do-web}/vite.config.ts. */
export const E2E_LANE1_DEV_PORTS: Record<E2eApp, number> = {
  sit: 5173,
  study: 5174,
  do: 5175,
};

/** Dev-port shift per lane. Distinct from the emulators' +10000. */
export const E2E_LANE_PORT_OFFSET = 100;

/** Accepted `E2E_APP` spellings — the short name or the workspace name. */
const APP_ALIASES: Record<string, E2eApp> = {
  sit: 'sit',
  web: 'sit',
  study: 'study',
  'study-web': 'study',
  do: 'do',
  'do-web': 'do',
};

export function parseE2eApp(value: string | undefined): E2eApp {
  if (!value || value.trim() === '') return 'sit';
  const app = APP_ALIASES[value.trim().toLowerCase()];
  if (!app) {
    throw new Error(
      `E2E_APP must be one of ${Object.keys(APP_ALIASES).join(', ')} — got "${value}"`,
    );
  }
  return app;
}

export function parseE2eLane(value: string | undefined): number {
  if (!value || value.trim() === '') return 1;
  const lane = Number(value.trim());
  if (!Number.isInteger(lane) || lane < 1 || lane > 6) {
    throw new Error(`E2E_LANE must be an integer lane 1..6 — got "${value}"`);
  }
  return lane;
}

export function devServerPort(app: E2eApp, lane: number): number {
  return E2E_LANE1_DEV_PORTS[app] + (lane - 1) * E2E_LANE_PORT_OFFSET;
}

/**
 * Resolve the Playwright base URL. Precedence: PLAYWRIGHT_BASE_URL, then
 * E2E_APP/E2E_LANE, then lane-1 sit — the historical default.
 */
export function resolveE2eBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const explicit = env.PLAYWRIGHT_BASE_URL?.trim();
  if (explicit) return explicit;
  const app = parseE2eApp(env.E2E_APP);
  const lane = parseE2eLane(env.E2E_LANE);
  return `http://localhost:${devServerPort(app, lane)}`;
}
