# EJM Babysitter Coordinator

A babysitting coordination platform for the EJM school community in Paris. Families search for and book babysitters who are current EJM students, with schedule management, references, and family invite workflows.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Web Frontend | React 19 + TypeScript + Vite + Tailwind CSS |
| State Management | Zustand |
| Routing | React Router v7 |
| Backend | Firebase Cloud Functions (2nd gen, Node.js 20) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication (email/password) |
| Storage | Firebase Cloud Storage (profile photos) |
| Geocoding | api-adresse.data.gouv.fr + Haversine |
| Validation | Zod (shared schemas) |
| Package Manager | pnpm (monorepo) |

## Project Structure

```
EJM-Babysitter-app/
├── apps/
│   ├── web/                    # React web application
│   │   └── src/
│   │       ├── components/     # UI components, schedule, appointments
│   │       ├── hooks/          # Firestore real-time hooks
│   │       ├── pages/          # Page components by role
│   │       ├── stores/         # Zustand auth store
│   │       ├── config/         # Firebase config
│   │       └── layouts/        # Auth guards, role layouts
│   └── functions/              # Firebase Cloud Functions
│       └── src/
│           ├── auth/           # Email verification
│           ├── enrollment/     # Babysitter + family signup
│           ├── search/         # Matching engine + contact requests
│           ├── appointments/   # Accept/decline responses
│           └── config/         # Firebase admin + CORS
├── packages/
│   └── shared/                 # Shared TypeScript package
│       └── src/
│           ├── types/          # Firestore document types
│           ├── constants/      # Roles, statuses, config
│           ├── validation/     # Zod schemas
│           └── utils/          # Haversine, schedule helpers, EJM email validation
├── firestore.rules             # Security rules
├── firestore.indexes.json      # Composite indexes
└── firebase.json               # Hosting, functions, emulators config
```

## Features

### Babysitter Portal
- **Enrollment** — EJM email verification, profile setup (photo, class, languages, preferences, area)
- **Dashboard** — appointment requests, active/inactive toggle for search visibility
- **Schedule Management** — visual weekly grid (drag to set availability), holiday schedules per vacation period, date overrides
- **References** — add manual references, approve/remove family-submitted references
- **Request Detail** — view family details, kids ages, rate, accept/decline with schedule blocking

### Family Portal
- **Enrollment** — email verification, family info, kids, address
- **Dashboard** — pending/confirmed/past appointments with expandable babysitter details
- **Search** — one-time or recurring babysitting search with filters (age, rate, gender, references, area), results with contact flow
- **Family Settings** — edit family name, address, pets, kids
- **Invite Members** — generate invite link for second parent to join family
- **Submitted References** — view references submitted for babysitters

### Shared
- Login with role-based redirect
- Password recovery
- About, Privacy Policy, Terms & Conditions, Report a Problem pages

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Firebase CLI (`npm install -g firebase-tools`)
- Java Runtime (for Firebase emulators)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd EJM-Babysitter-app
pnpm install

# Copy environment template
cp .env.example apps/web/.env.local
# Fill in your Firebase project config values

# Start Firebase emulators
pnpm emulators

# In a separate terminal, start the web dev server
pnpm dev
```

The app runs at `http://localhost:5173`. The emulator UI is at `http://localhost:4000`.

### Environment Variables

See `.env.example` for all required variables:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

## Scripts

| Command | Description |
|---------|------------|
| `pnpm dev` | Start web dev server (port 5173) |
| `pnpm build` | Build web app for production |
| `pnpm build:functions` | Compile Cloud Functions |
| `pnpm emulators` | Start Firebase emulators (Auth, Firestore, Functions, Storage) |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run tests across all packages |
| `pnpm deploy` | Deploy to Firebase (hosting + functions + rules) |

## Cloud Functions

| Function | Auth | Description |
|----------|------|------------|
| `verifyEjmEmail` | Public | Send verification code to EJM student email |
| `verifyParentEmail` | Public | Send verification code to parent email |
| `verifyCode` | Public | Validate a 6-digit verification code (rate limited) |
| `enrollBabysitter` | Public | Create babysitter account (Zod-validated) |
| `enrollFamily` | Public | Create family + parent account (Zod-validated) |
| `joinFamily` | Public | Join existing family via invite link |
| `generateInviteLink` | Authenticated | Generate 7-day invite link for family |
| `searchBabysitters` | Authenticated | Find matching babysitters by criteria |
| `sendContactRequest` | Authenticated | Send babysitting request to a babysitter |
| `respondToRequest` | Authenticated | Accept or decline a request (babysitter) |

## Firestore Collections

| Collection | Description |
|-----------|------------|
| `users/{uid}` | User profiles (babysitter, parent, admin) |
| `families/{familyId}` | Family documents with address, pets, notes |
| `families/{familyId}/kids/{kidId}` | Children in a family |
| `schedules/{userId}` | Weekly availability (96 slots/day, 15-min granularity) |
| `schedules/{userId}/overrides/{date}` | Date-specific schedule overrides |
| `searches/{searchId}` | Babysitter search parameters |
| `appointments/{appointmentId}` | Request/appointment lifecycle |
| `references/{referenceId}` | Manual + family-submitted references |
| `notifications/{notifId}` | User notifications |
| `inviteLinks/{token}` | Family invite tokens (7-day expiry) |
| `verificationCodes/{email}` | Temporary email verification codes |
| `holidays/{schoolYear}` | School holiday periods (Zone C) |

## Security

- **Firestore rules** enforce document-level access control with role-based permissions
- **Verification codes** use `crypto.randomInt()` (cryptographically secure) with 5-attempt rate limiting
- **CORS** restricted to configured origin in production, open in emulator
- **Security headers** configured: X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy
- **Input validation** via Zod schemas on all enrollment Cloud Functions
- **Sensitive fields** (role, status, uid, email, createdAt) are immutable via Firestore rules

## Deployment

```bash
# Build everything
pnpm build
pnpm build:functions

# Deploy to Firebase
firebase deploy

# Or deploy individually
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### Production Configuration

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Authentication (Email/Password provider)
3. Create a Firestore database (europe-west1 recommended)
4. Create a Storage bucket
5. Set environment variables in `apps/web/.env.local`
6. Set Cloud Functions CORS origin:
   ```bash
   # In apps/functions/.env
   ALLOWED_ORIGIN=https://your-app.web.app
   ```
7. Deploy Firestore indexes first (they take time to build):
   ```bash
   firebase deploy --only firestore:indexes
   ```

## Not Yet Implemented

- Email sending (Resend installed but not wired up)
- Push notifications (FCM)
- Appointment cancellation flow
- Admin portal
- Annual revalidation
- Mobile app (Flutter — planned)
- Internationalization (EN/FR)
- Automated tests

## License

Private — EJM School use only.
