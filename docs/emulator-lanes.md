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
- The integration suite seeds itself per test, so a lane driven only by `pnpm test:integration:laneN` never needs hand-seeding. Hand-seeding is for the browser-driven case; the seed scripts take the same lane dial — see "Seeding a lane" below.

## Seeding a lane

A lane you start by hand comes up EMPTY. Until issue #376 the seed scripts pinned lane 1, so pointing an app at lane 3 gave you an app talking to an empty stack, and the standing workaround was a hand-patched copy of the seed script per lane (`seed-admin.lane3.cjs`) — one more thing to keep in sync with the real one, and one more way to write to the dev stack by accident.

Both seed scripts now read the lane from env, through the **same resolver** the web apps use (`packages/shared-core/src/utils/emulatorConfig.ts`), so the browser and the seeder cannot disagree about where lane 3 is. The names are plain rather than `VITE_`-prefixed — these are Node scripts, and Vite only exposes `VITE_` vars to a browser bundle:

| Var | Default | Effect |
|---|---|---|
| `EMULATOR_LANE` (also `LANE`, `E2E_LANE`) | `1` | Shifts all four ports by `(lane - 1) * 10000`, the same offsets as above. Valid 1–6. |
| `EMULATOR_HOST` | per script — `localhost` for `seed-admin.cjs`, `127.0.0.1` for `seed-test-data.cjs` | Host for the emulators. |
| `EMULATOR_{AUTH,FIRESTORE,FUNCTIONS,STORAGE}_PORT` | 9099/8080/5001/9199 | Overrides the lane-derived port. |

Precedence is the browser side's: explicit port var → lane-derived → default. With none of them set each script targets exactly what it hardcoded before, so a plain `pnpm seed:admin` still seeds the shared dev stack.

Three things throw rather than resolve quietly, all for the same reason — silently landing on lane 1 means WRITING to the shared dev stack:

- a malformed value (`LANE=nine`, `EMULATOR_AUTH_PORT=70000`);
- two lane vars naming *different* lanes (`LANE=3 E2E_LANE=4`) — the same lane spelled two ways is fine;
- a `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR_HOST` already exported that points somewhere other than the resolved lane. The backfill scripts ask you to export those by hand, so having one left over in a shell is normal; without this check `pnpm seed:admin` would overwrite it and seed lane 1 without a word.

  What is compared is the target, not the spelling: the port must match, and the host must match once `localhost`, `127.0.0.1` and `::1` are folded together. So one `export FIRESTORE_EMULATOR_HOST=localhost:28080` satisfies both scripts in the same shell, even though they resolve different default hosts. The error names which half disagreed — a wrong port is a lane problem, a wrong host is an `EMULATOR_HOST` problem, and no lane var can fix the latter.

```bash
LANE=3 pnpm seed:admin                  # or: pnpm seed:admin:lane3
LANE=3 pnpm seed:test-data              # or: pnpm seed:test-data:lane3
LANE=4 pnpm seed:admin me@ejm.org pw    # script args still pass through
```

`seed:admin:lane{2,3,4}` and `seed:test-data:lane{2,3,4}` exist for the three lanes that have configs, matching `test:integration:lane{2,3,4}`. Both scripts print the lane and the resolved host:port they are about to write to as their first line of output — read it before assuming.

`pnpm seed:*` builds `@ejm/shared-core` first, because the resolver reaches a `.cjs` through that package's `dist/`. Running `node apps/functions/seed-test-data.cjs` directly skips that build; if `dist/` is missing *or stale* the script says so and tells you the one command to run.

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
# 1. the emulators for the lane (own terminal)
pnpm exec firebase emulators:start --config firebase.lane3.json \
  --only auth,functions,firestore,storage --project demo-test

# 2. seed THAT lane — it came up empty (see "Seeding a lane")
pnpm seed:admin:lane3
pnpm seed:test-data:lane3      # whatever the spec needs

# 3. the app, pointed at that lane, on that lane's dev port (own terminal)
cd apps/do-web && VITE_EMULATOR_LANE=3 pnpm exec vite --port 5375 --strictPort

# 4. the spec
E2E_APP=do E2E_LANE=3 pnpm exec playwright test tests-e2e/d1-do-endorsement-flow.spec.ts
```

The lane number appears four times and must be the same one every time. `E2E_LANE` is also accepted by the seed scripts, so `export E2E_LANE=3` once covers steps 2 and 4; step 3 still needs its own `VITE_EMULATOR_LANE` (Vite will not pass a non-`VITE_` var into the bundle).

`E2E_APP` (`sit`/`web`, `study`/`study-web`, `do`/`do-web`) and `E2E_LANE` only pick Playwright's `baseURL`; they do not configure the app — step 3's `VITE_EMULATOR_LANE` does that, and the two must name the same lane. `PLAYWRIGHT_BASE_URL` still overrides both, and with nothing set the base URL is `http://localhost:5173` as before.

`--strictPort` is not optional: without it step 3 silently lands on 5376 when 5375 is taken and step 4 then drives whatever is on 5375.
