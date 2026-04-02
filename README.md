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

# Start Firebase emulators
pnpm emulators

# Seed an admin user (emulator only)
pnpm seed:admin

# In a separate terminal, start the web dev server
pnpm dev
```

The app runs at `http://localhost:5173`. The emulator UI is at `http://localhost:4000`.

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

## Scripts

| Command | Description |
|---------|------------|
| `pnpm dev` | Start web dev server |
| `pnpm build` | Build web app for production |
| `pnpm build:functions` | Compile Cloud Functions |
| `pnpm emulators` | Start Firebase emulators |
| `pnpm seed:admin` | Create admin user in emulator |
| `pnpm typecheck` | Type-check all packages |
| `pnpm deploy` | Deploy to Firebase |

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
- **Storage rules** — authenticated access for verification docs and photos
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
