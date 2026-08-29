# Sync/Sit

A babysitting coordination platform for the EJM (École Jeannine Manuel) school community in Paris. Families search for and book babysitters who are current EJM students, with verification, scheduling, and community trust features.

**Live:** [sync-sit.com](https://sync-sit.com) · **Operated by:** Tandy SARL, Paris

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web Frontend | React 19 + TypeScript + Vite + Tailwind CSS |
| State Management | Zustand |
| Routing | React Router v7 |
| i18n | react-i18next (English + French) |
| Backend | Firebase Cloud Functions (2nd gen, Node.js 20) |
| Database | Cloud Firestore (europe-west1) |
| Auth | Firebase Authentication (email/password) |
| Storage | Firebase Cloud Storage |
| Email | Resend |
| Geocoding | api-adresse.data.gouv.fr + Haversine |
| Validation | Zod (shared schemas) |
| Package Manager | pnpm (monorepo) |

## Project Structure

```
sync-sit/
├── apps/
│   ├── web/                    # React web application
│   │   └── src/
│   │       ├── components/     # UI components, schedule, appointments
│   │       ├── hooks/          # Firestore real-time hooks
│   │       ├── pages/          # Page components by role
│   │       ├── stores/         # Zustand stores (auth, admin, verification)
│   │       ├── lib/            # Utilities (dateTag, errorCapture, formatName)
│   │       ├── config/         # Firebase config
│   │       ├── i18n/           # EN/FR translations
│   │       └── layouts/        # Auth guards, role layouts
│   └── functions/              # Firebase Cloud Functions
│       └── src/
│           ├── auth/           # Email verification
│           ├── enrollment/     # Babysitter + family signup
│           ├── search/         # Matching engine + contact requests
│           ├── appointments/   # Accept/decline responses
│           ├── admin/          # Admin panel functions
│           ├── verification/   # Identity, enrollment, community verification
│           ├── scheduled/      # Reminders, data retention cleanup
│           └── config/         # Firebase admin, CORS, email
├── packages/
│   └── shared/                 # Shared TypeScript package
│       └── src/
│           ├── types/          # Firestore document types
│           ├── constants/      # Roles, statuses, config
│           ├── validation/     # Zod schemas
│           └── utils/          # Haversine, schedule helpers, EJM email validation
├── scripts/                    # Deploy helpers, seed scripts
├── firestore.rules             # Security rules
├── firestore.indexes.json      # Composite indexes
├── storage.rules               # Storage security rules
└── firebase.json               # Hosting, functions, emulators config
```

## Features

### Babysitter Portal
- **Enrollment** — EJM email verification (@ejm.org with graduation year check), pre-approved invite emails
- **Dashboard** — appointment requests, active/inactive toggle for search visibility
- **Schedule Management** — visual weekly grid, holiday schedules per vacation period, date overrides
- **References** — manual references, family-submitted references
- **Request Detail** — family details, kids ages, rate, family photo with lightbox, accept/decline

### Family Portal
- **Enrollment** — email verification, family info, address autocomplete (France)
- **Dashboard** — pending/confirmed/past appointments, kids management, verification banner
- **Search** — one-time or recurring babysitting with filters, date tagging (holiday name / school night), expandable result cards
- **Verification** — identity document upload, EJM enrollment document upload, community verification (peer vouching)
- **Family Settings** — family photo, name, address, pets, kids management
- **Invite Members** — invite link for second parent to join family

### Admin Panel
- **Dashboard** — stats (babysitters, families, appointments)
- **User Management** — search, block/unblock, activate/deactivate, delete, reset password, GDPR export, pre-approved emails
- **Appointment Management** — search, filter, delete
- **Verification Review** — approve/reject identity and enrollment documents, view registered family data
- **School Holiday Calendar** — manage Zone C holiday periods
- **Configuration** — admin-tunable operational parameters (caps, windows, cooldowns; issue #250). Values live in `adminConfig/values` (no client access — the panel reads via the `getAdminConfig` callable; client-exposed keys are mirrored to the world-readable `adminConfig/client`); servers cache reads for 60s — operators can tune or disable the cache with the `ADMIN_CONFIG_TTL_MS` env var on the functions runtime (integer ms; `0` disables caching; blank/unset keeps the default). The panel is the ONLY supported edit path: a direct console write to `adminConfig/values` is bounds-checked server-side but does NOT update the client mirror, so client-facing values (e.g. the resend cooldown) would silently diverge until the next panel save.
- **Audit Log** — searchable admin action log with user resolution
- **GDPR Data Export** — export all user data as JSON

### Safety & Verification
- Babysitters verified through @ejm.org school email (domain + graduation year)
- Families verified through identity documents + school enrollment certificates
- Community verification — verified parents vouch for each other with one-time codes
- Search blocked until family is fully verified
- All verification documents reviewed by admin

### GDPR Compliance
- Consent tracking (consentAt, consentVersion) during enrollment
- True data deletion (hard delete, not soft delete)
- Scheduled data retention cleanup (30 days for logs/notifications/cancelled appointments)
- Data export functionality
- Privacy policy and terms of service (bilingual EN/FR, French law)

### Other
- Bilingual (English + French) with language selector
- Date tagging — evenings tagged as holiday name or "School night"
- Email notifications via Resend (verification codes, admin alerts)
- Global error capture for bug reports
- Family photo with lightbox in babysitter views

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Firebase CLI (`npm install -g firebase-tools`)
- Java Runtime (for Firebase emulators)

### Setup

```bash
# Clone and install
git clone https://github.com/yo-tandy/sync-sit.git
cd sync-sit
pnpm install

# Start Firebase emulators (runs under the demo-test project — auth,
# functions, firestore, storage; hosting is excluded because its named
# targets only resolve for the real sync-sit project)
pnpm emulators

# Integration tests can run WITHOUT killing this dev stack via the second
# emulator lane (`pnpm test:integration:lane2`) — see docs/emulator-lanes.md.
# The web apps and the seed scripts can be pointed at another lane too —
# "Running against an emulator lane" below.

# Seed an admin user (emulator only). Both seed scripts and both apps'
# .env.development target the demo-test namespace; if you previously ran the
# emulators under another project id, reseed — old data lives in that other
# namespace. Override with SEED_PROJECT_ID=<id> if needed.
pnpm seed:admin

# Optional: the fuller fixture set (2 families, 4 babysitters, appointments)
pnpm seed:test-data

# In a separate terminal, start the web dev server
pnpm dev
```

The app runs at `http://localhost:5173`. The emulator UI is at `http://localhost:4000`.

### Running against an emulator lane

The setup above is *lane 1* — the shared dev stack. A lane is a full second copy of the emulators on ports shifted by `(lane - 1) * 10000` (`firebase.lane{2,3,4}.json`), so a test run or a browser-driven e2e can have its own data without disturbing anyone else's. Three things have to name the same lane, and each has its own dial:

```bash
# 1. start lane 3's emulators (own terminal)
pnpm exec firebase emulators:start --config firebase.lane3.json \
  --only auth,functions,firestore,storage --project demo-test

# 2. seed lane 3 — a freshly started lane is EMPTY
pnpm seed:admin:lane3            # or: LANE=3 pnpm seed:admin
pnpm seed:test-data:lane3        # or: LANE=3 pnpm seed:test-data

# 3a. run an app against lane 3, on that lane's dev port (own terminal)
cd apps/do-web && VITE_EMULATOR_LANE=3 pnpm exec vite --port 5375 --strictPort

# 3b. ...or run the integration suite in it (starts and stops the lane itself)
pnpm test:integration:lane3

# 3c. ...or a Playwright spec against the app from 3a
E2E_APP=do E2E_LANE=3 pnpm exec playwright test tests-e2e/<spec>.spec.ts
```

The apps read `VITE_EMULATOR_LANE` (only `VITE_`-prefixed vars reach a browser bundle) and the seed scripts read `EMULATOR_LANE`, `LANE` or `E2E_LANE` — different names, but one shared resolver (`packages/shared-core/src/utils/emulatorConfig.ts`), so the browser and the seeder cannot disagree about where lane 3 is. Either throws on a malformed value rather than quietly falling back to lane 1 and writing to the shared stack. (The integration suite predates that helper and takes the four `TEST_*_PORT` vars instead; its `lane{2,3,4}` scripts set them for you.) Full details, per-lane dev ports and the individual port overrides: **docs/emulator-lanes.md**.

### Environment Variables

Create `apps/web/.env`:

```
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

In DEV builds only, all three apps resolve their Firebase emulator endpoint from `VITE_EMULATOR_LANE` / `VITE_EMULATOR_HOST` / `VITE_EMULATOR_{AUTH,FIRESTORE,FUNCTIONS,STORAGE}_PORT`, defaulting to the lane-1 ports `pnpm emulators` starts (`localhost` 9099/8080/5001/9199). The seed scripts take the same dial on the command line under plain names (`LANE` / `EMULATOR_LANE` / `EMULATOR_HOST` / `EMULATOR_{AUTH,FIRESTORE,FUNCTIONS,STORAGE}_PORT`). Unset, nothing changes; set, a dev server and its seed data can move to a lane of their own instead of the shared stack. Defaults and precedence: `.env.example`; full recipe: docs/emulator-lanes.md.

The cross-app switch target is configurable (defaults to the production URLs baked into the code): `VITE_STUDY_APP_URL` in `apps/web`, `VITE_SIT_APP_URL` in `apps/study-web`, and BOTH (`VITE_SIT_APP_URL` + `VITE_STUDY_APP_URL`) in `apps/do-web`, whose switcher links out to both siblings (the reverse links are owner-gated — plan decision 20, issue #304). All three apps ship a committed `.env.development` pointing these at the sibling dev ports; note that `.env.*` is gitignored, so a git checkout will silently overwrite any untracked local copy of these files.

## Scripts

| Command | Description |
|---------|------------|
| `pnpm dev` | Start sit web dev server |
| `pnpm dev:study` / `pnpm dev:do` | Start the study / do web dev servers |
| `pnpm build` | Build sit web app for production |
| `pnpm build:study` / `pnpm build:do` | Build the study / do web apps |
| `pnpm build:functions` | Compile Cloud Functions |
| `pnpm emulators` | Start Firebase emulators (lane 1) |
| `pnpm seed:admin` | Create admin user in emulator |
| `pnpm seed:test-data` | Seed families, babysitters and sample appointments |
| `pnpm seed:admin:lane3` / `pnpm seed:test-data:lane3` | The same, into emulator lane 3 (`lane2` / `lane4` too; or `LANE=N pnpm seed:admin`) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test:unit` | Every workspace package's unit suite, plus the out-of-package `scripts/` suite |
| `pnpm deploy` | Deploy to Firebase |

`test:unit` selects packages recursively (`pnpm -r`) and subtracts one
exclusion, `@ejm/tests` — the integration lane, which needs the emulator
lifecycle and runs through `pnpm test:integration`. It does **not** name the
packages it runs, so a new package's suite is picked up the moment it has a
`test` script rather than being silently skipped (issue #401). The exclusion
list is pinned in `scripts/__tests__/release-workflow.test.ts`, so removing a
suite from the lane is a decision recorded in a test.

### How the shared packages resolve

Each shared package's `exports` answers three ways, and the order of the keys
is load-bearing:

```jsonc
"types":   "./src/index.ts",   // TypeScript — always the source
"import":  "./src/index.ts",   // Vite / Vitest — the source
"require": "./dist/index.js"   // Node (emulators, deployed functions) — the build
```

`types` is listed **first** because TypeScript matches condition keys in the
order they appear. With it listed last, a CJS consumer (`apps/functions`,
`apps/study-functions` — both `moduleResolution: node16`) matched `require`
and type-checked against `dist/*.d.ts` whenever a `dist` happened to exist,
and against `src` when it did not. A stale `dist` then invented errors that
were not real and hid ones that were, while CI — which always starts clean —
saw neither (issue #406). Source is now the single answer for types, so
`pnpm typecheck` no longer depends on whether anything has been built.

`require` still points at `dist`, so **runtime** still needs a build: the
emulators, the seed scripts and the deploy bundle all load compiled output.
Run `pnpm --filter @ejm/shared-core build` (or the package you changed) before
running against the emulators.

## Cloud Functions

| Function | Auth | Description |
|----------|------|------------|
| `verifyEjmEmail` | Public | Send verification code to EJM student email (with pre-approved bypass) |
| `verifyParentEmail` | Public | Send verification code to parent email |
| `verifyCode` | Public | Validate a 6-digit verification code |
| `enrollBabysitter` | Public | Create babysitter account |
| `enrollFamily` | Public | Create family + parent account |
| `joinFamily` | Public | Join existing family via invite link |
| `generateInviteLink` | Auth | Generate 7-day invite link |
| `searchBabysitters` | Auth | Find matching babysitters (verification gated) |
| `sendContactRequest` | Auth | Send babysitting request (verification gated) |
| `respondToRequest` | Auth | Accept or decline a request |
| `submitVerification` | Auth | Upload identity/enrollment document |
| `reviewVerification` | Admin | Approve/reject verification |
| `getVerificationStatus` | Auth | Get family verification status |
| `listPendingVerifications` | Admin | List verifications for review |
| `generateCommunityCode` | Auth | Generate peer verification code |
| `lookupCommunityCode` | Auth | Look up code for approval |
| `approveCommunityCode` | Auth | Approve a family via community code |
| `getAdminDashboard` | Admin | Dashboard statistics |
| `listUsers` | Admin | List/search users |
| `blockUser` | Admin | Block/unblock user |
| `correctUserIdentity` | Admin | Correct set-once root identity (audited) |
| `deactivateUser` | Admin | Toggle babysitter searchable flag |
| `deleteUser` | Admin | GDPR-compliant hard delete |
| `resetUserPassword` | Admin | Send password reset email |
| `listAppointments` | Admin | List/filter appointments |
| `deleteAppointment` | Admin | Cancel appointment |
| `updateHolidays` | Admin | Update school holiday calendar |
| `listAuditLogs` | Admin | View audit trail |
| `exportUserData` | Admin | GDPR data export |
| `addPreapprovedEmail` | Admin | Whitelist test babysitter email |
| `removePreapprovedEmail` | Admin | Remove from whitelist |
| `listPreapprovedEmails` | Admin | List whitelisted emails |
| `sendReminders` | Scheduled | Send appointment reminders (hourly) |
| `cleanupOldData` | Scheduled | Data retention cleanup (daily 3am) |

## Deployment

Production ships on a **tag**, not on a merge (issue #353). Merging to `main`
runs the test suite and deploys nothing; pushing a `v*` tag runs
`release.yml`, which deploys Firestore rules + indexes, Storage rules, hosting
(all three sites — sit, study, do), and functions (both codebases). All three
apps release together from one tag.

```bash
git tag -a v1.4.0 -m "co-parent move, parent landing pages"
git push origin v1.4.0
```

Rollback is redeploying an earlier tag: **Actions → Release to production →
Run workflow →** enter the tag. See [docs/releasing.md](docs/releasing.md) for
the full process, including the expand/contract rule for database migrations.

Manual full deploy, if ever needed:

```bash
# Build and deploy everything
pnpm build
firebase deploy --only hosting,functions,firestore,storage

# Post-deploy: fix Cloud Run permissions + Resend API key
bash scripts/fix-cloud-run-permissions.sh
```

The post-deploy script runs automatically via `firebase.json` postdeploy hooks.

## Security

- **Firestore rules** — document-level access control with role-based permissions
- **Storage rules** — family-scoped writes (10MB cap, renderable-type denylist: html/xhtml/svg/xml) on verification docs, callable-only reads (v4-signed URLs, forced download); owner-scoped profile photos; authenticated family photos
- **Verification codes** — `crypto.randomInt()` with 5-attempt rate limiting, 10-minute expiry
- **Input validation** — Zod schemas on all enrollment functions
- **Immutable fields** — role, status, uid, email protected via Firestore rules
- **CORS** — open (functions protected by Firebase Auth)
- **Security headers** — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy

## License

MIT License

Copyright (c) 2026 Tandy SARL

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
