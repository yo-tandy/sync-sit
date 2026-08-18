# Parallel emulator lanes

The integration suite normally runs against the default emulator ports (8080/9099/5001/9199), which are also what the local dev stack (`pnpm emulators`) and the dev servers use — so a test run and the dev stack could never coexist, and every integration gate meant killing and reseeding the dev environment.

`firebase.lane2.json` defines a second lane with every port shifted +10000 (Firestore 18080, Auth 19099, Functions 15001, Storage 19199, hub 14400, logging 14500, UI disabled). The test harness (`tests/setup/emulator.ts`, `tests/rules/storage-rules.test.ts`, and `tests/rules/firestore-rules.test.ts`) reads the ports from `TEST_FIRESTORE_PORT` / `TEST_AUTH_PORT` / `TEST_FUNCTIONS_PORT` / `TEST_STORAGE_PORT`, so a full suite runs in lane 2 without touching the dev stack:

```bash
pnpm test:integration:lane2
```

(the script in the root package.json carries the four env vars and `--config firebase.lane2.json`, so the ports cannot be half-set by hand)

Notes:
- Always use the workspace CLI (`pnpm exec firebase`); the global standalone binary silently breaks pnpm child processes.
- Build first: `pnpm -r --filter './packages/**' build && pnpm build:functions && pnpm build:study-functions` — a missing functions dist false-fails every callable test.
- `TEST_STORAGE_PORT` matters: without it the storage-rules suite connects to the DEFAULT port and `clearStorage()` wipes the dev stack's storage bucket.
- Each lane spawns its own Java Firestore emulator (~hundreds of MB); two concurrent lanes plus the dev stack is a sensible ceiling on a laptop. For a third lane, copy the config with a different offset and pass matching env vars.
- Lanes are fully isolated: same `demo-test` project id is fine, data never crosses lanes.
- To run a subset of the suite, use `cd tests && pnpm exec vitest run <path>`. Do NOT use `pnpm test -- <path>`: pnpm forwards the literal `--` and vitest silently discards everything after it, running the full suite while appearing to accept your filter.
