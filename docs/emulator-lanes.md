# Parallel emulator lanes

The integration suite normally runs against the default emulator ports (8080/9099/5001/9199), which are also what the local dev stack (`pnpm emulators`) and the dev servers use — so a test run and the dev stack could never coexist, and every integration gate meant killing and reseeding the dev environment.

`firebase.lane2.json` defines a second lane with every port shifted +10000 (Firestore 18080, Auth 19099, Functions 15001, Storage 19199, hub 14400, logging 14500, UI disabled). `firebase.lane3.json` defines a third lane at +20000 (Firestore 28080, Auth 29099, Functions 25001, Storage 29199, hub 24400, logging 24500) for a second concurrent test session. `firebase.lane4.json` defines a fourth lane at +30000 (Firestore 38080, Auth 39099, Functions 35001, Storage 39199, hub 34400, logging 34500) for a third; it additionally pins eventarc (39299) and tasks (39499), which only matters when running `emulators:exec` WITHOUT `--only` — those emulators then auto-start on defaults that collide across lanes (the lane scripts' `--only auth,functions,firestore,storage` never starts them). The test harness (`tests/setup/emulator.ts`, `tests/rules/storage-rules.test.ts`, `tests/rules/firestore-rules.test.ts`, plus the direct `TEST_AUTH_PORT` readers `tests/integration/handoff/app-handoff.test.ts` and `tests/integration/guardian/redeem-kid-invite.test.ts`) reads the ports from `TEST_FIRESTORE_PORT` / `TEST_AUTH_PORT` / `TEST_FUNCTIONS_PORT` / `TEST_STORAGE_PORT`, so a full suite runs in lane 2 without touching the dev stack:

```bash
pnpm test:integration:lane2   # or: pnpm test:integration:lane3 / pnpm test:integration:lane4
```

(each script in the root package.json carries its four env vars and `--config firebase.laneN.json`, so the ports cannot be half-set by hand)

Notes:
- Always use the workspace CLI (`pnpm exec firebase`); the global standalone binary silently breaks pnpm child processes.
- Build first: `pnpm -r --filter './packages/**' build && pnpm build:functions && pnpm build:study-functions` — a missing functions dist false-fails every callable test. In a FRESH worktree this must include `@ejm/do-core` (it is newer than this recipe): without its build the sit functions codebase fails to LOAD entirely, so `searchBabysitters` is silently absent and the search UI returns a bare `internal` — a failure that looks like a bug in the feature under test rather than a missing build.
- `TEST_STORAGE_PORT` matters: without it the storage-rules suite connects to the DEFAULT port and `clearStorage()` wipes the dev stack's storage bucket.
- Each lane spawns its own Java Firestore emulator (~hundreds of MB); two concurrent lanes plus the dev stack is a sensible ceiling on a laptop. Lane 3 exists for exactly that second concurrent session, lane 4 for a third; for a fifth lane, copy the config with a different offset and add a matching script.
- Lanes are fully isolated: same `demo-test` project id is fine, data never crosses lanes.
- To run a subset of the suite against LANE 2 (lane 3: same shape, ports +10000), keep the env vars on the command: `cd tests && TEST_FIRESTORE_PORT=18080 TEST_AUTH_PORT=19099 TEST_FUNCTIONS_PORT=15001 TEST_STORAGE_PORT=19199 pnpm exec vitest run <path>` — without them the subset silently targets lane 1, where `clearStorage()` wipes the dev bucket (the exact footgun this lane exists to remove). Do NOT use `pnpm test -- <path>`: pnpm forwards the literal `--` and vitest silently discards everything after it, running the full suite while appearing to accept your filter.
- The seed scripts (`pnpm seed:admin`, `seed-test-data.cjs`) are deliberately NOT lane-aware — they pin the default ports and seed the DEV stack. Lane 2 seeds itself per-test; there is nothing to seed there by hand.

## Running a WEB APP in a lane (browser-driven e2e)

Everything above is the Node-side test harness. The web apps needed the same dial, and until issue #358 they did not have it: `apps/{web,study-web,do-web}/src/config/firebase.ts` hardcoded lane 1, so a Playwright spec could only ever drive the shared dev stack — which at any moment may be serving a build that predates the feature under test. (That is exactly what stopped PR #352's e2e leg: lane 1 was on a pre-sync-do build and `doPostTask` came back "does not exist".)

All three apps now resolve their emulator endpoint from env, through one shared helper (`packages/shared-core/src/utils/emulatorConfig.ts`), so the three cannot drift:

| Var | Default | Effect |
|---|---|---|
| `VITE_EMULATOR_LANE` | `1` | Shifts all four ports by `(lane - 1) * 10000` — the same offset `firebase.lane{2,3,4}.json` use. Valid 1–6 (lane 7 would push storage past 65535). |
| `VITE_EMULATOR_HOST` | `localhost` | Host for all four emulators. |
| `VITE_EMULATOR_AUTH_PORT` | `9099` | Overrides the lane-derived auth port. |
| `VITE_EMULATOR_FIRESTORE_PORT` | `8080` | " |
| `VITE_EMULATOR_FUNCTIONS_PORT` | `5001` | " |
| `VITE_EMULATOR_STORAGE_PORT` | `9199` | " |

With none of them set the apps connect exactly where they always did, so `pnpm dev` is unchanged. A malformed value **throws** at startup instead of falling back — a silent fallback would point the run at lane 1 and let it WRITE to the shared dev stack, the precise accident these vars exist to prevent.

The dev SERVER port has to move too: two Vite servers cannot share :5173, and Vite quietly takes the next free port instead of failing, so the spec would drive the wrong app. A lane owns a dev port per app, +100 per lane (`tests-e2e/lanes.ts`):

| Lane | sit (`web`) | study | do |
|---|---|---|---|
| 1 (shared dev stack) | 5173 | 5174 | 5175 |
| 2 | 5273 | 5274 | 5275 |
| 3 | 5373 | 5374 | 5375 |

Full recipe — do-web against a seeded lane 3:

```bash
# 1. the emulators for the lane (own terminal; seed it however the spec needs)
pnpm exec firebase emulators:start --config firebase.lane3.json \
  --only auth,functions,firestore,storage --project demo-test

# 2. the app, pointed at that lane, on that lane's dev port (own terminal)
cd apps/do-web && VITE_EMULATOR_LANE=3 pnpm exec vite --port 5375 --strictPort

# 3. the spec
E2E_APP=do E2E_LANE=3 pnpm exec playwright test tests-e2e/d1-do-endorsement-flow.spec.ts
```

`E2E_APP` (`sit`/`web`, `study`/`study-web`, `do`/`do-web`) and `E2E_LANE` only pick Playwright's `baseURL`; they do not configure the app — step 2's `VITE_EMULATOR_LANE` does that, and the two must name the same lane. `PLAYWRIGHT_BASE_URL` still overrides both, and with nothing set the base URL is `http://localhost:5173` as before.

`--strictPort` is not optional: without it step 2 silently lands on 5376 when 5375 is taken and step 3 then drives whatever is on 5375.
