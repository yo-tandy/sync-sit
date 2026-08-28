# Parallel emulator lanes

The integration suite normally runs against the default emulator ports (8080/9099/5001/9199), which are also what the local dev stack (`pnpm emulators`) and the dev servers use — so a test run and the dev stack could never coexist, and every integration gate meant killing and reseeding the dev environment.

`firebase.lane2.json` defines a second lane with every port shifted +10000 (Firestore 18080, Auth 19099, Functions 15001, Storage 19199, hub 14400, logging 14500, UI disabled). `firebase.lane3.json` defines a third lane at +20000 (Firestore 28080, Auth 29099, Functions 25001, Storage 29199, hub 24400, logging 24500) for a second concurrent test session. `firebase.lane4.json` defines a fourth lane at +30000 (Firestore 38080, Auth 39099, Functions 35001, Storage 39199, hub 34400, logging 34500) for a third; it additionally pins eventarc (39299) and tasks (39499), which only matters when running `emulators:exec` WITHOUT `--only` — those emulators then auto-start on defaults that collide across lanes (the lane scripts' `--only auth,functions,firestore,storage` never starts them). The test harness (`tests/setup/emulator.ts`, `tests/rules/storage-rules.test.ts`, `tests/rules/firestore-rules.test.ts`, plus the direct `TEST_AUTH_PORT` readers `tests/integration/handoff/app-handoff.test.ts` and `tests/integration/guardian/redeem-kid-invite.test.ts`) reads the ports from `TEST_FIRESTORE_PORT` / `TEST_AUTH_PORT` / `TEST_FUNCTIONS_PORT` / `TEST_STORAGE_PORT`, so a full suite runs in lane 2 without touching the dev stack:

```bash
pnpm test:integration:lane2   # or: pnpm test:integration:lane3 / pnpm test:integration:lane4
```

(each script in the root package.json carries its four env vars and `--config firebase.laneN.json`, so the ports cannot be half-set by hand)

Notes:
- Always use the workspace CLI (`pnpm exec firebase`); the global standalone binary silently breaks pnpm child processes.
- Build first: `pnpm -r --filter './packages/**' build && pnpm build:functions && pnpm build:study-functions` — a missing functions dist false-fails every callable test.
- `TEST_STORAGE_PORT` matters: without it the storage-rules suite connects to the DEFAULT port and `clearStorage()` wipes the dev stack's storage bucket.
- Each lane spawns its own Java Firestore emulator (~hundreds of MB); two concurrent lanes plus the dev stack is a sensible ceiling on a laptop. Lane 3 exists for exactly that second concurrent session, lane 4 for a third; for a fifth lane, copy the config with a different offset and add a matching script.
- Lanes are fully isolated: same `demo-test` project id is fine, data never crosses lanes.
- To run a subset of the suite against LANE 2 (lane 3: same shape, ports +10000), keep the env vars on the command: `cd tests && TEST_FIRESTORE_PORT=18080 TEST_AUTH_PORT=19099 TEST_FUNCTIONS_PORT=15001 TEST_STORAGE_PORT=19199 pnpm exec vitest run <path>` — without them the subset silently targets lane 1, where `clearStorage()` wipes the dev bucket (the exact footgun this lane exists to remove). Do NOT use `pnpm test -- <path>`: pnpm forwards the literal `--` and vitest silently discards everything after it, running the full suite while appearing to accept your filter.
- The seed scripts (`pnpm seed:admin`, `seed-test-data.cjs`) are deliberately NOT lane-aware — they pin the default ports and seed the DEV stack. Lane 2 seeds itself per-test; there is nothing to seed there by hand.
