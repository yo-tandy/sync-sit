# Sync-Study Project Plan

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Decisions](#2-architecture-decisions)
3. [Current System (sync-sit)](#3-current-system-sync-sit)
4. [Target Architecture](#4-target-architecture)
5. [Shared Package Extraction](#5-shared-package-extraction)
6. [Sync-Study Domain Model](#6-sync-study-domain-model)
7. [Extraction Process & Safety Rules](#7-extraction-process--safety-rules)
8. [Agent Breakdown](#8-agent-breakdown)
9. [V1 Scope Decisions](#9-v1-scope-decisions)
10. [Future Roadmap](#10-future-roadmap)

---

## 1. Project Overview

### What We're Building

**sync-study** is a tutoring marketplace for the EJM (Ecole Jeannine Manuel) school community in Paris. EJM student tutors offer academic help to EJM families' children. It is the second app in a platform that starts with **sync-sit** (babysitting marketplace).

### Goals

1. **Build sync-study** — a tutoring app with subject-based search, calendar-driven booking, per-subject pricing, variable session lengths, location preferences, and recurring session management.
2. **Extract shared infrastructure** from sync-sit into reusable packages — so that both apps share user management, family data, scheduling, verification, notifications, UI components, and admin tools.
3. **Enable cross-app accounts** — a user enrolled in one app can log into the other with the same credentials and shared data (availability, profile basics) stays in sync.
4. **Do not break sync-sit** — every step of the extraction must leave sync-sit buildable and deployable.

### How the Apps Relate

| Aspect | sync-sit (babysitting) | sync-study (tutoring) |
|--------|----------------------|----------------------|
| **Provider** | Babysitter (EJM student) | Tutor (EJM student) |
| **Consumer** | Parent/Family (EJM community) | Parent/Family (EJM community) |
| **Booking direction** | Family defines time -> finds available babysitters | Family searches by subject -> browses tutor's calendar -> picks a slot |
| **Pricing** | Single hourly rate per babysitter | Per-subject rate per tutor |
| **Session length** | Family sets start/end time (any duration) | Tutor defines allowed lengths (30-75 min, 15-min steps) |
| **Location** | Always at family's home | Tutor home, family home, online, or library |
| **Recurring model** | Lightweight (flag + recurringSlots array, no instance tracking) | Full instance management (cancel/reschedule individual occurrences) |
| **Padding** | Not applicable | Tutor sets buffer time around in-person sessions |

---

## 2. Architecture Decisions

### Single Firebase Project (Both Apps)

Both apps share one Firebase project with:
- **Single Auth instance** — users authenticate once, both apps see the same `auth.currentUser`. This gives us SSO for free.
- **Single Firestore** — shared collections (`users`, `families`, `schedules`) mean availability sync is automatic. A babysitting booking blocks slots that the tutoring app sees, and vice versa.
- **Two hosting sites** — `sync-sit` and `sync-study` are separate web apps deployed to separate Firebase Hosting targets.
- **Shared Cloud Functions** — one functions codebase with namespaced exports, or two codebases deployed to the same project.

### Monorepo (Evolve, Don't Fork)

Work stays in the existing monorepo. No new repositories. The repo evolves from:

```
sync-sit/                        # current
  apps/web/
  apps/functions/
  packages/shared/
```

To:

```
sync-platform/                   # target
  packages/shared-core/          # app-agnostic types, constants, utils
  packages/shared-ui/            # React component library + themes
  packages/shared-functions/     # cloud function helpers
  apps/web/                      # sync-sit frontend
  apps/functions/                # sync-sit cloud functions
  apps/study-web/                # sync-study frontend
  apps/study-functions/          # sync-study cloud functions
  packages/shared/               # temporary shim (re-exports from shared-core)
```

The key safety property: `packages/shared/` continues to re-export everything it currently exports. All existing sync-sit code keeps working with zero import changes until the very end (optional cleanup).

### Cross-App Account Model

The user document gains a `profiles` map indicating which apps the user has completed enrollment for:

```typescript
profiles?: {
  sit?: { enrollmentComplete: boolean; searchable: boolean; /* sit-specific fields */ };
  study?: { enrollmentComplete: boolean; searchable: boolean; /* study-specific fields */ };
}
```

When an existing sync-sit user navigates to sync-study, the auth guard sees they are authenticated but `profiles.study` is missing and routes them to an abbreviated enrollment flow (skip email verification, skip identity — just collect tutoring preferences).

### Schedule Override Source Tracking

When a booking from either app blocks schedule slots, the override document includes:

```typescript
appSource: 'sit' | 'study'   // which app created this block
```

This lets each app display "blocked by other app" in its UI if desired.

---

## 3. Current System (sync-sit)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4, React Router v7 |
| State | Zustand (authStore, adminStore, verificationStore) |
| Forms | React Hook Form v7 + Zod validation |
| i18n | react-i18next (English + French) |
| Backend | Firebase Cloud Functions (2nd gen, Node.js 20, europe-west1) |
| Database | Cloud Firestore |
| Auth | Firebase Authentication (email/password) |
| Storage | Firebase Cloud Storage (photos, verification docs) |
| Email | Resend |
| Push | Firebase Cloud Messaging (FCM) |
| Monorepo | pnpm workspaces |

### Monorepo Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@ejm/shared` | `packages/shared/` | Types, constants, utils, Zod validation schemas |
| `web` | `apps/web/` | React SPA frontend |
| `functions` | `apps/functions/` | Cloud Functions backend |

### Shared Package Contents (`packages/shared/src/`)

**Types** (`types/`):
- `common.ts` — FirestoreTimestamp, LatLng, NotifPrefs, NotifChannels, DEFAULT_NOTIF_PREFS
- `user.ts` — UserBase, BabysitterUser, ParentUser, AdminUser, UserDoc
- `family.ts` — FamilyDoc, SearchDefaults, KidDoc
- `appointment.ts` — RecurringSlot, SearchDoc, AppointmentDoc
- `schedule.ts` — ScheduleDoc, ScheduleOverrideDoc
- `reference.ts` — ReferenceDoc
- `notification.ts` — NotificationDoc
- `admin.ts` — AuditLogDoc, HolidayDoc, InviteLinkDoc
- `verification.ts` — VerificationDoc, FamilyVerificationStatus, VerificationStatus, VerificationType

**Constants** (`constants/`):
- `roles.ts` — UserRole (babysitter, parent, admin)
- `statuses.ts` — AccountStatus, AppointmentStatus, AppointmentStatusReason, SearchType, SearchStatus, ReferenceType, ReferenceStatus, HolidayMode, AreaMode
- `config.ts` — EJM_DOMAIN, MIN_BABYSITTER_AGE, schedule slot constants (SCHEDULE_SLOT_MINUTES=15, SLOTS_PER_DAY=96, DAYS_OF_WEEK), ARRONDISSEMENTS, NEARBY_TOWNS, ALL_AREAS, LANGUAGES, getValidGraduationYears()

**Utils** (`utils/`):
- `schedule.ts` — timeToSlotIndex, slotIndexToTime, areSlotsAvailable, setSlotRange, createEmptySlots, createFullSlots
- `haversine.ts` — haversineDistance(LatLng, LatLng)
- `ejm-email.ts` — validateEjmEmail

**Validation** (`validation/`):
- `auth.ts` — emailSchema, ejemEmailSchema, passwordSchema, verificationCodeSchema, loginSchema
- `enrollment.ts` — strongPasswordSchema, checkPasswordRequirements, babysitterImmutableProfileSchema, babysitterProfileSchema, isBabysitterProfileComplete, babysitterPreferencesSchema, kidSchema, familyEnrollmentSchema, searchDefaultsSchema, joinFamilySchema

### Frontend Components (`apps/web/src/components/`)

**UI Components** (`ui/`) — 16 exported from barrel:
- Button, Input, Textarea, Select, Card, Badge, Chip, Dialog, Spinner, StepIndicator, Avatar, InfoBanner, TopNav, LanguageSelector, Checkbox, Icons (SVG sprite)

**Additional UI** (not in barrel):
- AppBar, EnrollmentAppBar, DateTag, PhotoLightbox, PushPrompt

**Form Components** (`forms/`):
- AddressAutocomplete, CodeInput, LanguagePicker, PhoneInput

**Schedule Components** (`schedule/`):
- WeeklyTimeline, DayEditor, OverrideList

**Domain Components**:
- `appointments/AppointmentCard.tsx`, `appointments/ExpandableBabysitterCard.tsx`
- `endorsements/EndorsementDialog.tsx`
- `ScrollToTop.tsx`

### Frontend Pages (`apps/web/src/pages/`)

**Public** (13 pages): WelcomePage, LoginPage, SignUpRolePage, ForgotPasswordPage, AboutPage, PrivacyPage, TermsPage, ReportProblemPage, SharePage, ParentGuidePage, BabysitterGuidePage, AddToHomescreenPage

**Enrollment** (8 pages):
- Babysitter: BabysitterEnrollment (orchestrator), StepEmail, StepVerify, StepPassword, StepProfile, StepPreferences
- Parent: ParentEnrollment (orchestrator), StepParentEmail, StepParentVerify, StepParentPassword, StepFamilyInfo, StepKids
- JoinFamilyPage

**Babysitter Portal** (7 pages): DashboardPage, AccountPage, BabysittingOptionsPage, SchedulePage, EndorsementsPage, RequestDetailPage, FamiliesPage

**Family Portal** (8 pages): DashboardPage, FamilySettingsPage, InvitePage, SubmittedEndorsementsPage, SearchPage, PreferredBabysittersPage, AccountPage, VerificationPage

**Admin Portal** (7 pages): DashboardPage, UsersPage, AppointmentsPage, HolidaysPage, AuditLogPage, GdprExportPage, VerificationsPage

### Cloud Functions (`apps/functions/src/`)

**Auth** (3): verifyEjmEmail, verifyParentEmail, verifyCode
**Enrollment** (6): enrollBabysitter, enrollFamily, generateInviteLink, joinFamily, validateInviteLink, removeCoParent
**Search** (2): searchBabysitters, sendContactRequest
**Family** (4): addPreferredBabysitter, removePreferredBabysitter, lookupBabysitter, respondToContactSharing
**Appointments** (6): respondToRequest, cancelAppointment, modifyAppointment, acknowledgeModification, getParentContacts, resubmitAppointment
**Verification** (8): submitVerification, reviewVerification, listPendingVerifications, getVerificationStatus, generateCommunityCode, lookupCommunityCode, approveCommunityCode, getVerificationDocument
**References** (1): notifyOnNewReference (Firestore trigger)
**Scheduled** (2): sendReminders, cleanupOldData
**Admin** (14): getAdminDashboard, listUsers, blockUser, deleteUser, resetUserPassword, listAppointments, deleteAppointment, updateHolidays, listAuditLogs, exportUserData, deactivateUser, addPreapprovedEmail, removePreapprovedEmail, listPreapprovedEmails
**Config/Helpers** (5): firebase.ts, cors.ts, email.ts, push.ts, notifyParents.ts, writeAuditLog.ts

### Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `users/{uid}` | All user documents (BabysitterUser, ParentUser, AdminUser) |
| `families/{familyId}` | Family documents |
| `families/{familyId}/kids/{kidId}` | Kid profiles (subcollection) |
| `schedules/{userId}` | Babysitter availability (96-slot weekly grid) |
| `schedules/{userId}/overrides/{date}` | Per-date schedule exceptions |
| `searches/{searchId}` | Family search requests |
| `appointments/{appointmentId}` | Booking documents |
| `references/{referenceId}` | Endorsements and references |
| `notifications/{notificationId}` | User notifications |
| `verifications/{verificationId}` | Identity/enrollment verification documents |
| `verificationCodes/{email}` | Temporary email verification codes |
| `holidays/{schoolYear}` | School holiday periods (Zone C) |
| `inviteLinks/{token}` | Family invite tokens |
| `preapprovedEmails/{email}` | Admin-managed email whitelist |
| `auditLog/{logId}` | Admin action audit trail |

### Styling

- Tailwind CSS v4 with custom design tokens in `apps/web/src/index.css`
- Primary color: Red (#DF1A30)
- Font: Inter
- Base font size: 17px mobile, 16px desktop
- Custom CSS variables: `--color-red-*`, `--radius-*`, `--shadow-card`, `--font-sans`

---

## 4. Target Architecture

### Monorepo Structure

```
sync-platform/
├── packages/
│   ├── shared-core/                    # App-agnostic types, constants, utils
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── common.ts           # FirestoreTimestamp, LatLng, NotifPrefs
│   │   │   │   ├── user.ts             # UserBase, ServiceProviderBase, ParentUser, AdminUser
│   │   │   │   ├── family.ts           # FamilyDoc, KidDoc, SearchDefaults
│   │   │   │   ├── schedule.ts         # ScheduleDoc, ScheduleOverrideDoc
│   │   │   │   ├── session-base.ts     # Shared appointment state machine types
│   │   │   │   ├── notification.ts     # NotificationDoc
│   │   │   │   ├── admin.ts            # AuditLogDoc, HolidayDoc, InviteLinkDoc
│   │   │   │   ├── verification.ts     # VerificationDoc, FamilyVerificationStatus
│   │   │   │   └── reference.ts        # ReferenceDoc
│   │   │   ├── constants/
│   │   │   │   ├── roles.ts            # UserRole (extended: + 'tutor')
│   │   │   │   ├── statuses.ts         # All status enums
│   │   │   │   └── config.ts           # Shared config (slots, days, areas, languages)
│   │   │   ├── utils/
│   │   │   │   ├── schedule.ts         # Slot math utilities
│   │   │   │   ├── haversine.ts        # Distance calculation
│   │   │   │   └── ejm-email.ts        # EJM email validation
│   │   │   └── validation/
│   │   │       ├── auth.ts             # Email, password, code schemas
│   │   │       └── enrollment.ts       # Shared enrollment schemas (family, kid, join, password)
│   │   └── package.json                # @ejm/shared-core
│   │
│   ├── shared-ui/                      # React component library
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Textarea.tsx
│   │   │   │   ├── Select.tsx
│   │   │   │   ├── Checkbox.tsx
│   │   │   │   ├── Dialog.tsx
│   │   │   │   ├── Badge.tsx
│   │   │   │   ├── Chip.tsx
│   │   │   │   ├── Avatar.tsx
│   │   │   │   ├── Spinner.tsx
│   │   │   │   ├── StepIndicator.tsx
│   │   │   │   ├── TopNav.tsx
│   │   │   │   ├── AppBar.tsx
│   │   │   │   ├── EnrollmentAppBar.tsx
│   │   │   │   ├── Icons.tsx
│   │   │   │   ├── InfoBanner.tsx
│   │   │   │   ├── DateTag.tsx
│   │   │   │   ├── LanguageSelector.tsx
│   │   │   │   ├── PhotoLightbox.tsx
│   │   │   │   ├── PushPrompt.tsx
│   │   │   │   └── index.ts
│   │   │   ├── forms/
│   │   │   │   ├── AddressAutocomplete.tsx
│   │   │   │   ├── CodeInput.tsx
│   │   │   │   ├── LanguagePicker.tsx
│   │   │   │   └── PhoneInput.tsx
│   │   │   ├── schedule/
│   │   │   │   ├── WeeklyTimeline.tsx
│   │   │   │   ├── DayEditor.tsx
│   │   │   │   └── OverrideList.tsx
│   │   │   └── theme/
│   │   │       ├── base.css            # Shared tokens (font, radii, shadows, spacing)
│   │   │       ├── sit.css             # Red accent override
│   │   │       └── study.css           # Blue/teal accent override
│   │   └── package.json                # @ejm/shared-ui
│   │
│   ├── shared-functions/               # Cloud function helpers
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── firebase.ts         # Firebase Admin SDK init
│   │   │   │   ├── cors.ts             # CORS configuration
│   │   │   │   ├── email.ts            # Resend email client
│   │   │   │   └── push.ts             # FCM push delivery
│   │   │   ├── auth/
│   │   │   │   ├── verifyEjmEmail.ts   # EJM email verification
│   │   │   │   ├── verifyParentEmail.ts# Parent email verification
│   │   │   │   └── verifyCode.ts       # Code verification
│   │   │   ├── enrollment/
│   │   │   │   ├── enrollFamily.ts     # Family creation
│   │   │   │   ├── generateInviteLink.ts
│   │   │   │   ├── joinFamily.ts
│   │   │   │   ├── validateInviteLink.ts
│   │   │   │   └── removeCoParent.ts
│   │   │   ├── verification/
│   │   │   │   ├── submitVerification.ts
│   │   │   │   ├── reviewVerification.ts
│   │   │   │   ├── listPendingVerifications.ts
│   │   │   │   ├── getVerificationStatus.ts
│   │   │   │   ├── generateCommunityCode.ts
│   │   │   │   ├── lookupCommunityCode.ts
│   │   │   │   ├── approveCommunityCode.ts
│   │   │   │   └── getVerificationDocument.ts
│   │   │   ├── notifications/
│   │   │   │   └── notifyParents.ts    # Multi-channel notification delivery
│   │   │   └── admin/
│   │   │       ├── writeAuditLog.ts
│   │   │       ├── verifyAdmin.ts
│   │   │       ├── blockUser.ts
│   │   │       ├── deleteUser.ts
│   │   │       ├── deactivateUser.ts
│   │   │       ├── resetUserPassword.ts
│   │   │       ├── listUsers.ts
│   │   │       ├── listAuditLogs.ts
│   │   │       ├── updateHolidays.ts
│   │   │       ├── exportUserData.ts
│   │   │       └── managePreapprovedEmails.ts
│   │   └── package.json                # @ejm/shared-functions
│   │
│   └── shared/                         # TEMPORARY SHIM (backward compat)
│       └── src/                        # Re-exports everything from shared-core
│           └── ...                     # sync-sit imports still work unchanged
│
├── apps/
│   ├── web/                            # sync-sit frontend (existing)
│   │   └── src/
│   │       ├── components/
│   │       │   ├── ui/                 # Re-exports from @ejm/shared-ui
│   │       │   ├── appointments/       # sync-sit-specific (AppointmentCard, etc.)
│   │       │   └── endorsements/       # sync-sit-specific
│   │       ├── pages/                  # All existing pages (unchanged)
│   │       └── ...
│   │
│   ├── functions/                      # sync-sit cloud functions (existing)
│   │   └── src/
│   │       ├── search/                 # sync-sit-specific (searchBabysitters, etc.)
│   │       ├── appointments/           # sync-sit-specific
│   │       ├── enrollment/
│   │       │   └── enrollBabysitter.ts # sync-sit-specific
│   │       └── ...                     # Shared functions imported from @ejm/shared-functions
│   │
│   ├── study-web/                      # sync-study frontend (NEW)
│   │   └── src/
│   │       ├── components/
│   │       │   ├── calendar/           # Slot picker, availability viewer (NEW)
│   │       │   └── sessions/           # Session cards, instance views (NEW)
│   │       ├── pages/
│   │       │   ├── public/             # Welcome, login, etc. (mirrors sync-sit)
│   │       │   ├── enrollment/
│   │       │   │   ├── TutorEnrollment.tsx
│   │       │   │   ├── tutor/StepSubjects.tsx      # NEW: subjects + levels + rates
│   │       │   │   ├── tutor/StepSessionPrefs.tsx  # NEW: lengths, location, padding
│   │       │   │   └── ...                         # Shared steps (email, verify, password, profile)
│   │       │   └── parent/                         # Same as sync-sit (uses shared enrollment)
│   │       │   ├── tutor/              # Dashboard, Account, Schedule, Endorsements
│   │       │   ├── family/             # Dashboard, Search (by subject), Settings
│   │       │   └── admin/              # Shared admin pages
│   │       ├── config/
│   │       │   └── firebase.ts         # Same project, different hosting site
│   │       └── index.css               # Imports base.css + study.css
│   │
│   └── study-functions/                # sync-study cloud functions (NEW)
│       └── src/
│           ├── enrollment/
│           │   └── enrollTutor.ts      # Tutor-specific enrollment
│           ├── search/
│           │   ├── searchTutors.ts     # Subject-based search
│           │   └── getTutorAvailability.ts  # Calendar view for families
│           ├── sessions/
│           │   ├── bookSession.ts      # With padding + per-subject pricing
│           │   ├── confirmSession.ts
│           │   ├── cancelSession.ts
│           │   ├── rescheduleInstance.ts
│           │   └── generateInstances.ts # Recurring instance creation
│           └── scheduled/
│               └── extendRecurring.ts  # Weekly: extend rolling instance window
│
├── firebase.json                       # Multi-site hosting + shared functions config
├── firestore.rules
├── firestore.indexes.json
├── pnpm-workspace.yaml
└── package.json
```

### Shared vs. App-Specific Split

**In shared-core (identical between apps):**
- UserBase, ServiceProviderBase, ParentUser, AdminUser
- FamilyDoc, KidDoc
- ScheduleDoc, ScheduleOverrideDoc, slot utilities
- Verification & trust system
- Notification infrastructure
- Admin (audit, holidays, user management)
- Auth (email verification, password)
- Appointment state machine (status transitions, modification tracking)
- All constants, config values, utility functions

**In shared-ui (identical between apps):**
- All UI components (Button, Card, Input, Dialog, etc.)
- All form components (AddressAutocomplete, CodeInput, etc.)
- Schedule components (WeeklyTimeline, DayEditor, OverrideList)
- Theme base tokens
- i18n configuration setup

**In shared-functions (identical between apps):**
- Auth functions (email verification, code verification)
- Family enrollment functions (enrollFamily, invite, join)
- Verification workflow functions
- Notification delivery (push, email)
- Admin functions (user management, audit, holidays)
- Config helpers (Firebase init, CORS, email client)

**App-specific (sync-sit only):**
- BabysitterUser type (extends ServiceProviderBase with kidAgeRange, maxKids, hourlyRate)
- searchBabysitters function
- sendContactRequest function
- Babysitter enrollment function (enrollBabysitter)
- Appointment functions (respondToRequest, cancel, modify, acknowledge, resubmit)
- Babysitter-specific pages and components
- Babysitter-specific validation schemas

**App-specific (sync-study only):**
- TutorUser type (extends ServiceProviderBase with subjects, sessionLengths, locationPrefs, paddingMinutes)
- SubjectOffering type, subject/level taxonomy constants
- searchTutors function (subject-based)
- getTutorAvailability function (calendar view)
- Session booking functions (with padding, per-subject pricing)
- SessionInstance model and lifecycle functions
- Recurring instance generation and extension
- Calendar slot picker component
- Tutor-specific enrollment steps (subjects, session prefs)
- Tutor-specific pages and components

---

## 5. Shared Package Extraction

### The ServiceProviderBase Split

The key type refactoring. Current `BabysitterUser` becomes two layers:

**shared-core — ServiceProviderBase (fields common to babysitters AND tutors):**
```typescript
interface ServiceProviderBase extends UserBase {
  role: string;
  ejemEmail: string;
  dateOfBirth: FirestoreTimestamp;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  classLevel: string;
  photoUrl?: string;
  languages: string[];
  aboutMe?: string;

  // Contact (at least one required)
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;

  // Area
  areaMode: AreaMode;
  arrondissements?: string[];
  areaAddress?: string;
  areaLatLng?: LatLng;
  areaRadiusKm?: number;

  // Enrollment state
  enrollmentComplete?: boolean;
  searchable?: boolean;

  // Revalidation
  lastRevalidatedAt?: FirestoreTimestamp;
  revalidationYear?: number;
}
```

**sync-sit — BabysitterUser:**
```typescript
interface BabysitterUser extends ServiceProviderBase {
  role: 'babysitter';
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;
}
```

**sync-study — TutorUser:**
```typescript
interface TutorUser extends ServiceProviderBase {
  role: 'tutor';
  subjects: SubjectOffering[];
  sessionLengths: number[];         // [30, 45, 60] minutes
  locationPrefs: LocationPref[];    // 'family_home' | 'tutor_home' | 'online' | 'library'
  paddingMinutes: number;           // 0, 15, or 30
  hourlyRate: number;               // default/display rate (actual rate is per-subject)
}
```

### Validation Schema Split

**Stays in shared-core** (used by both apps):
- emailSchema, ejemEmailSchema, passwordSchema, verificationCodeSchema, loginSchema
- strongPasswordSchema, checkPasswordRequirements
- kidSchema, familyEnrollmentSchema, searchDefaultsSchema, joinFamilySchema

**Stays in sync-sit only** (babysitter-specific):
- babysitterImmutableProfileSchema
- babysitterProfileSchema
- babysitterPreferencesSchema
- isBabysitterProfileComplete

**New in sync-study** (tutor-specific):
- tutorImmutableProfileSchema
- tutorSubjectsSchema
- tutorSessionPrefsSchema
- isTutorProfileComplete

### File-by-File Migration Order

Each file is copied to shared-core, then the original is replaced with a re-export. `pnpm typecheck && pnpm build` runs after every single file.

| Step | File | Destination | Risk |
|------|------|-------------|------|
| 1 | `types/common.ts` | shared-core/types/ | None — no domain logic |
| 2 | `constants/config.ts` | shared-core/constants/ | None — pure constants |
| 3 | `constants/roles.ts` | shared-core/constants/ | None — enums |
| 4 | `constants/statuses.ts` | shared-core/constants/ | None — enums |
| 5 | `utils/schedule.ts` | shared-core/utils/ | None — pure functions |
| 6 | `utils/haversine.ts` | shared-core/utils/ | None — pure function |
| 7 | `utils/ejm-email.ts` | shared-core/utils/ | None — pure function |
| 8 | `types/schedule.ts` | shared-core/types/ | None — already app-agnostic |
| 9 | `types/notification.ts` | shared-core/types/ | None — app-agnostic structure |
| 10 | `types/admin.ts` | shared-core/types/ | None — app-agnostic structure |
| 11 | `types/family.ts` | shared-core/types/ | None — shared between apps |
| 12 | `types/verification.ts` | shared-core/types/ | None — shared between apps |
| 13 | `types/reference.ts` | shared-core/types/ | None — shared between apps |
| 14 | `types/user.ts` — **SPLIT** | shared-core (ServiceProviderBase) + keep BabysitterUser in shared | Medium — requires creating ServiceProviderBase |
| 15 | `types/appointment.ts` — **SPLIT** | shared-core (base state machine) + keep SearchDoc/AppointmentDoc in shared | Medium — extract AppointmentStatus fields as base |
| 16 | `validation/auth.ts` | shared-core/validation/ | Low |
| 17 | `validation/enrollment.ts` — **SPLIT** | shared-core (password, family, kid) + keep babysitter schemas in shared | Low |

---

## 6. Sync-Study Domain Model

### New Types

**SubjectOffering:**
```typescript
interface SubjectOffering {
  subject: string;          // e.g. 'math', 'french', 'physics'
  levels: string[];         // e.g. ['6e', '5e', '4e']
  rate: number;             // EUR per hour for this subject
}
```

**LocationPref:**
```typescript
type LocationPref = 'family_home' | 'tutor_home' | 'online' | 'library';
```

**SessionDoc (sync-study appointment equivalent):**
```typescript
interface SessionDoc {
  sessionId: string;
  familyId: string;
  tutorUserId: string;
  createdByUserId: string;

  // What
  subject: string;
  level: string;
  rate: number;               // locked-in per-subject rate

  // When
  type: 'one_time' | 'recurring';
  date?: string;              // one-time: "YYYY-MM-DD"
  startTime: string;          // "HH:MM"
  endTime: string;            // "HH:MM" (calculated from startTime + sessionLength)
  sessionLengthMinutes: number;
  recurringSlots?: RecurringSlot[];
  schoolWeeksOnly?: boolean;

  // Where
  location: LocationPref;
  address?: string;
  latLng?: LatLng;

  // Padding (stored for override calculation)
  paddingMinutes: number;

  // Status
  status: SessionStatus;      // pending | confirmed | rejected | cancelled
  statusReason?: string;

  // Timestamps
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  cancelledAt?: FirestoreTimestamp;

  // Modification tracking (same as sync-sit)
  modified?: boolean;
  modifiedAt?: FirestoreTimestamp;
  modifiedFields?: string[];
}
```

**SessionInstanceDoc (for recurring sessions):**
```typescript
interface SessionInstanceDoc {
  instanceId: string;
  sessionId: string;          // parent recurring session
  familyId: string;
  tutorUserId: string;

  // Concrete occurrence
  date: string;               // "YYYY-MM-DD"
  startTime: string;
  endTime: string;
  sessionLengthMinutes: number;
  paddingMinutes: number;

  // Status (independent of parent session)
  status: InstanceStatus;     // scheduled | cancelled | rescheduled | completed
  cancelledAt?: FirestoreTimestamp;
  rescheduledTo?: string;     // new date if rescheduled

  // Denormalized for display
  subject: string;
  level: string;
  rate: number;
  location: LocationPref;

  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}
```

### Subject Taxonomy

Static constant for v1 (like ARRONDISSEMENTS):

```typescript
const SUBJECTS = [
  'math', 'french', 'english', 'spanish', 'german',
  'physics', 'chemistry', 'svt', 'history_geo',
  'philosophy', 'ses', 'nsi', 'art', 'music',
] as const;

const CLASS_LEVELS = [
  'CP', 'CE1', 'CE2', 'CM1', 'CM2',           // elementary
  '6e', '5e', '4e', '3e',                       // college
  '2nde', '1ere', 'Terminale',                  // lycee
  'IB_MYP4', 'IB_MYP5', 'IB_DP1', 'IB_DP2',  // IB programme
] as const;
```

### Search Flow

1. Family selects subject + level (+ optional filters: location preference, max rate, distance)
2. `searchTutors` function queries `users` where `role='tutor'`, `searchable=true`, `status='active'`, and `subjects` array contains matching subject+level
3. Results show: name, photo, languages, per-subject rate, available session lengths, location options, distance, endorsement count
4. Family clicks a tutor -> `getTutorAvailability(tutorUid, startDate, endDate)` returns sanitized boolean grid (available/unavailable, no reasons)
5. Family picks a date, start time, and session length from the tutor's allowed lengths
6. System validates: contiguous slots available for `paddingBefore + sessionLength + paddingAfter` (padding only if location is in-person)
7. Creates `SessionDoc` with status `pending`
8. Tutor confirms or rejects

### Padding Logic

- Padding applies when `location` is `family_home` or `tutor_home`
- Padding does NOT apply when `location` is `online` or `library`
- When booking: required free slots = `paddingMinutes + sessionLengthMinutes + paddingMinutes`
- When confirmed: schedule override blocks the full padded range
- Session doc records only the session start/end (padding is implicit from tutor profile)

### Recurring Instance Management

- On recurring session confirmation: generate `SessionInstanceDoc` for next 8 weeks
- A weekly Cloud Task (`extendRecurring`) generates the next week's instances, maintaining the 8-week rolling window
- Each instance has independent status (scheduled, cancelled, rescheduled, completed)
- Cancelling one instance: updates only that instance, removes its schedule override
- Rescheduling one instance: cancels original, creates new one-off session
- Cancelling the parent session: cancels all future instances
- Holiday handling: instances are not generated for holiday weeks when `schoolWeeksOnly=true`

### New Firestore Collections

| Collection | Purpose |
|-----------|---------|
| `study-sessions/{sessionId}` | Tutoring session documents (equivalent to appointments) |
| `study-sessions/{sessionId}/instances/{instanceId}` | Recurring session instances (subcollection) |
| `study-searches/{searchId}` | Tutoring search requests |

Shared collections remain unchanged: `users`, `families`, `schedules`, `references`, `notifications`, `verifications`, `holidays`, `auditLog`.

---

## 7. Extraction Process & Safety Rules

### Core Principle

**Additive first, then migrate.** Never delete or move a file that sync-sit depends on until the new location is proven to work. Every step leaves sync-sit buildable and deployable.

### Safety Commands

After every file change:
```bash
pnpm typecheck && pnpm build
```

After every phase:
- Manual smoke test of sync-sit (babysitter enrollment, parent enrollment, search, booking, schedule edit)

### Technique: Copy-Then-Re-Export

For each file being extracted:

1. **Copy** the file from `packages/shared/src/X` to `packages/shared-core/src/X`
2. **Replace** the original file contents with a re-export:
   ```typescript
   export * from '@ejm/shared-core/X';
   ```
3. **Verify** — `pnpm typecheck && pnpm build`. All sync-sit imports still point to `@ejm/shared`, which now re-exports from `@ejm/shared-core`.
4. If anything fails, revert the one file. sync-sit was never broken.

### Things NOT to Do

| Anti-pattern | Why it's dangerous |
|-------------|-------------------|
| Fork to a new repo | Lose git history; maintain two copies during transition |
| Move files (instead of copy + re-export) | One missed import breaks sync-sit |
| Extract everything in one big PR | Impossible to bisect if something breaks |
| Rename the repo early | Breaks deploy pipelines, CI, Firebase config |
| Build sync-study features before finishing extraction | Building on a moving foundation |
| Skip typecheck between file moves | Errors compound; 10 files moved then check = debugging nightmare |
| Edit `packages/shared/` and `packages/shared-core/` simultaneously in different agents | Merge conflicts on re-export files |

---

## 8. Agent Breakdown

### Overview

Six agents, each with a bounded scope and clear file ownership. No two agents touch the same files.

```
Timeline:

Phase 0-1        Phase 2-3           Phase 4            Phase 5-6
(setup)          (extraction)        (extraction)       (build study)
─────────────────────────────────────────────────────────────────────

Agent 1 ─────────████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  (shared-core)

Agent 2 ─────────░░░░████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  (shared-ui)                   ↑ can start after Agent 1 begins
                                  (different files)

Agent 6 ─────────░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░
  (infrastructure)  ↑ workspace setup early          firestore rules ↑

Agent 3 ─────────░░░░░░░░░░░░░░░░████████████░░░░░░░░░░░░░░░░░░░░
  (shared-funcs)              ↑ starts after Agent 1 types are done

Agent 4 ─────────░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████
  (study backend)                              ↑ needs Agents 1+3

Agent 5 ─────────░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████
  (study frontend)                             ↑ needs Agents 1+2
                                               Agents 4+5 run in parallel

Agent 8 ─────────░░░░████████████████████████████████████████████
  (tester — sync-sit regression + sync-study scope coverage)
                  ↑ active after every phase boundary

Agent 9 ─────────░░░░░░░░░░░░░░░░████████████████████████████████
  (security specialist — security risks + GDPR)
                                ↑ active from Phase 2 onward, heaviest at Phase 4
```

---

### Project-Wide Skill Installation

Skills in Claude Code are installed at the **project** (or user) level and become visible to every agent in the team — they cannot be scoped to one subagent. So we install the full union once, then each agent's role brief tells it which skills to invoke for which work.

**One-shot install** — fully non-interactive (passes `npx --yes`, `--agent claude-code`, and `-y` so the CLI never prompts for scope or agent picker):

```bash
bash scripts/install-sync-study-skills.sh                   # install everything (project-level)
bash scripts/install-sync-study-skills.sh --check           # dry run
bash scripts/install-sync-study-skills.sh --group firebase  # one group only
bash scripts/install-sync-study-skills.sh --global          # install at user level (~/.claude)
```

Groups: `workflow`, `typescript`, `frontend`, `firebase`, `testing`. If you'd rather paste the commands manually, the same list is below, grouped by purpose for readability — the order doesn't matter to the installer.

**Workflow & orchestration (used by every agent):**
```bash
npx skills add https://github.com/obra/superpowers --skill writing-plans
npx skills add https://github.com/obra/superpowers --skill executing-plans
npx skills add https://github.com/obra/superpowers --skill subagent-driven-development
npx skills add https://github.com/obra/superpowers --skill dispatching-parallel-agents
npx skills add https://github.com/obra/superpowers --skill test-driven-development
npx skills add https://github.com/obra/superpowers --skill requesting-code-review
npx skills add https://github.com/obra/superpowers --skill receiving-code-review
npx skills add https://github.com/mattpocock/skills --skill improve-codebase-architecture
npx skills add https://github.com/wshobson/agents --skill monorepo-management
```

**TypeScript & refactor (Agents 1, 4):**
```bash
npx skills add https://github.com/wshobson/agents --skill typescript-advanced-types
npx skills add https://github.com/mcollina/skills --skill typescript-magician
npx skills add https://github.com/pproenca/dot-skills --skill zod
npx skills add https://github.com/github/awesome-copilot --skill refactor-plan
```

**Frontend (Agents 2, 5):**
```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
npx skills add https://github.com/wshobson/agents --skill tailwind-design-system
npx skills add https://github.com/wshobson/agents --skill design-system-patterns
npx skills add https://github.com/wshobson/agents --skill react-state-management
npx skills add https://github.com/addyosmani/web-quality-skills --skill accessibility
npx skills add https://github.com/antfu/skills --skill vite
npx skills add https://github.com/sickn33/antigravity-awesome-skills --skill i18n-localization
```

**Firebase & backend (Agents 3, 4, 5, 6):**
```bash
npx skills add https://github.com/firebase/agent-skills --skill firebase-basics
npx skills add https://github.com/firebase/agent-skills --skill firebase-auth-basics
npx skills add https://github.com/firebase/agent-skills --skill firebase-firestore
npx skills add https://github.com/firebase/agent-skills --skill firebase-hosting-basics
npx skills add https://github.com/firebase/agent-skills --skill firebase-app-hosting-basics
npx skills add https://github.com/wshobson/agents --skill nodejs-backend-patterns
```

**Testing & review (Agent 7, plus all agents post-change):**
```bash
npx skills add https://github.com/antfu/skills --skill vitest
npx skills add https://github.com/wshobson/agents --skill javascript-testing-patterns
npx skills add https://github.com/wshobson/agents --skill code-review-excellence
npx skills add https://github.com/dotneet/claude-code-marketplace --skill typescript-react-reviewer
```

**Functional QA (Agent 8 — Tester):**
```bash
npx skills add https://github.com/wshobson/agents --skill e2e-testing-patterns
npx skills add https://github.com/softaworks/agent-toolkit --skill qa-test-planner
```

**Security & GDPR (Agent 9 — Security Specialist):**
```bash
npx skills add https://github.com/firebase/agent-skills --skill firebase-security-rules-auditor
npx skills add https://github.com/wshobson/agents --skill gdpr-data-handling
npx skills add https://github.com/sickn33/antigravity-awesome-skills --skill api-security-best-practices
npx skills add https://github.com/wshobson/agents --skill secrets-management
npx skills add https://github.com/wshobson/agents --skill threat-mitigation-mapping
npx skills add https://github.com/wshobson/agents --skill security-requirement-extraction
```

**Total: 38 unique skills.** All become available to every agent. The per-agent role definitions below tell each agent which subset to actually invoke.

### Skills Every Agent Should Invoke

These four are the always-on baseline. Every agent — regardless of scope — invokes them around its own work:

| Skill | When |
|---|---|
| `writing-plans` | Before touching any file, draft the per-file/per-task plan |
| `executing-plans` | Drive the "copy → re-export → typecheck" loop in §7 |
| `test-driven-development` | When touching code paths covered by tests, or adding new ones |
| `requesting-code-review` | Before handing a phase to Agent 7 / merging |

Plus, the lead agent that dispatches the team invokes `subagent-driven-development` and `dispatching-parallel-agents`. `monorepo-management` and `improve-codebase-architecture` are situational across all extraction work (§5). Agents 7, 8, and 9 are continuous validators — they don't follow the per-phase task model but instead engage at every phase boundary; the coordinator routes the build/function/security gates to them in that order.

---

### Agent 1: Shared-Core Extraction

**Scope:** `packages/shared-core/`, `packages/shared/`

**Owns (exclusively):**
- All files in `packages/shared-core/`
- All files in `packages/shared/src/` (replacing contents with re-exports)

**Does NOT touch:**
- `apps/web/` (no import changes to sync-sit frontend)
- `apps/functions/` (no import changes to sync-sit backend)
- `apps/study-web/` or `apps/study-functions/` (don't exist yet)

**Tasks:**

1. Create `packages/shared-core/` package shell:
   - `package.json` (`@ejm/shared-core`, depends on `zod`)
   - `tsconfig.json`
   - `src/index.ts`
   - Empty `src/types/`, `src/constants/`, `src/utils/`, `src/validation/` directories

2. Migrate types (copy + re-export), one file at a time, in this order:
   - `types/common.ts`
   - `constants/config.ts`
   - `constants/roles.ts`
   - `constants/statuses.ts`
   - `utils/schedule.ts`
   - `utils/haversine.ts`
   - `utils/ejm-email.ts`
   - `types/schedule.ts`
   - `types/notification.ts`
   - `types/admin.ts`
   - `types/family.ts`
   - `types/verification.ts`
   - `types/reference.ts`

3. Split `types/user.ts`:
   - Create `shared-core/src/types/user.ts` with `UserBase`, `ServiceProviderBase`, `ParentUser`, `AdminUser`
   - Keep `BabysitterUser` and `UserDoc` (which includes BabysitterUser) in `packages/shared/src/types/user.ts`
   - `packages/shared` re-exports shared-core user types AND adds its own BabysitterUser + UserDoc

4. Split `types/appointment.ts`:
   - Extract `RecurringSlot` and base status/state types to shared-core
   - Keep `SearchDoc` and `AppointmentDoc` (babysitting-specific) in packages/shared

5. Split `validation/enrollment.ts`:
   - Move `strongPasswordSchema`, `checkPasswordRequirements`, `kidSchema`, `familyEnrollmentSchema`, `searchDefaultsSchema`, `joinFamilySchema` to shared-core
   - Keep `babysitterImmutableProfileSchema`, `babysitterProfileSchema`, `babysitterPreferencesSchema`, `isBabysitterProfileComplete` in packages/shared

6. Move `validation/auth.ts` to shared-core (entirely generic)

**Verification after each file:** `pnpm typecheck && pnpm build`

**Done when:** All app-agnostic code lives in `packages/shared-core/`. `packages/shared/` only contains babysitter-specific types and validation. sync-sit builds and passes typecheck with zero import changes.

**Role:** Owns the type/util/validation layer. Performs the most delicate part of the refactor — the `ServiceProviderBase` split and the `validation/enrollment.ts` split — without breaking sync-sit's imports.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `refactor-plan` | First — to formalize the step 1–17 file-by-file migration table from §5 into an executable plan |
| `typescript-advanced-types` | When designing `ServiceProviderBase`, the role-discriminated union, and `UserDoc` |
| `typescript-magician` | When the discriminated-union refactor needs codemod-style changes across many files |
| `zod` | When splitting `validation/enrollment.ts` and writing new shared schemas |

**Skills Agent 1 should NOT invoke:** anything React, Tailwind, Firebase, or Vite — Agent 1 doesn't touch frontend or backend code.

---

### Agent 2: Shared-UI Extraction

**Scope:** `packages/shared-ui/`, `apps/web/src/components/ui/`, `apps/web/src/components/forms/`, `apps/web/src/components/schedule/`

**Owns (exclusively):**
- All files in `packages/shared-ui/`
- `apps/web/src/components/ui/index.ts` (updating re-exports)
- Individual component files in `apps/web/src/components/ui/`, `forms/`, `schedule/` (replacing with re-exports)

**Does NOT touch:**
- `packages/shared/` or `packages/shared-core/` (Agent 1's territory)
- `apps/web/src/pages/` (page components stay in sync-sit)
- `apps/web/src/components/appointments/` (sync-sit-specific, stays)
- `apps/web/src/components/endorsements/` (sync-sit-specific, stays)

**Tasks:**

1. Create `packages/shared-ui/` package shell:
   - `package.json` (`@ejm/shared-ui`, depends on React, Tailwind)
   - `tsconfig.json`
   - `src/` directory structure

2. Extract theme tokens:
   - Create `src/theme/base.css` — font, radii, shadows, spacing, neutral colors (from `apps/web/src/index.css`)
   - Create `src/theme/sit.css` — red-600, red-500, red-100, red-50 overrides
   - Create `src/theme/study.css` — blue/teal accent color family
   - Update `apps/web/src/index.css` to import `base.css` + `sit.css`

3. Extract UI components (one at a time, leaf components first):
   - **Tier 1 (no internal deps):** Spinner, Badge, Chip, Avatar, Checkbox, Icons
   - **Tier 2 (simple deps):** Button, Input, Textarea, Select, Card, InfoBanner
   - **Tier 3 (composed):** Dialog, StepIndicator, TopNav, AppBar, EnrollmentAppBar, DateTag, LanguageSelector, PhotoLightbox, PushPrompt

4. Extract form components:
   - AddressAutocomplete, CodeInput, LanguagePicker, PhoneInput

5. Extract schedule components:
   - WeeklyTimeline, DayEditor, OverrideList

6. For each extracted component, update the original file to re-export from `@ejm/shared-ui`

**Verification:** After each component: `pnpm typecheck && pnpm build`. After all components: visual smoke test of sync-sit in browser.

**Done when:** All reusable components live in `packages/shared-ui/`. `apps/web/src/components/ui/index.ts` re-exports from `@ejm/shared-ui`. sync-sit renders correctly with no visual regressions.

**Role:** Owns the React component library. Extracts the 16-component barrel + form + schedule components into `packages/shared-ui/`, sets up the theme token split (`base.css` / `sit.css` / `study.css`), and replaces sync-sit's component files with re-exports — without any visual regressions.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `design-system-patterns` | First — when planning the shape of the `shared-ui` package (exports, theme strategy, build) |
| `tailwind-design-system` | When designing the `base.css` / `sit.css` / `study.css` token split (§4) |
| `vercel-react-best-practices` | When porting individual React 19 components — props patterns, ref forwarding, Suspense usage |
| `react-state-management` | When extracting form components that touch Zustand stores (e.g. `LanguagePicker`, `AddressAutocomplete`) |
| `accessibility` | On every extracted component — a11y is a shared-library responsibility, not a per-app one |

**Skills Agent 2 should NOT invoke:** anything Firebase, Zod schemas, TypeScript codemod skills — Agent 2 owns UI only, not types or backend.

---

### Agent 3: Shared-Functions Extraction

**Scope:** `packages/shared-functions/`, `apps/functions/src/`

**Owns (exclusively):**
- All files in `packages/shared-functions/`
- The files in `apps/functions/src/` that are being extracted (replacing with re-exports or imports)

**Does NOT touch:**
- `packages/shared/` or `packages/shared-core/` (Agent 1's territory)
- `apps/web/` (frontend)
- `apps/functions/src/search/` (sync-sit-specific, stays)
- `apps/functions/src/appointments/` (sync-sit-specific, stays)
- `apps/functions/src/family/` (sync-sit-specific, stays)

**Depends on:** Agent 1 must have completed the core type extraction (shared-functions imports from `@ejm/shared-core`).

**Tasks:**

1. Create `packages/shared-functions/` package shell:
   - `package.json` (`@ejm/shared-functions`, depends on `firebase-functions`, `firebase-admin`, `@ejm/shared-core`)
   - `tsconfig.json`

2. Extract config helpers:
   - `config/firebase.ts` (Admin SDK initialization)
   - `config/cors.ts` (CORS origin configuration)
   - `config/email.ts` (Resend email client)
   - `config/push.ts` (FCM push delivery)
   - `config/notifyParents.ts` (multi-channel notification delivery)

3. Extract auth functions:
   - `auth/verifyEjmEmail.ts`
   - `auth/verifyParentEmail.ts`
   - `auth/verifyCode.ts`

4. Extract enrollment functions (family-related only):
   - `enrollment/enrollFamily.ts`
   - `enrollment/generateInviteLink.ts`
   - `enrollment/joinFamily.ts`
   - `enrollment/validateInviteLink.ts`
   - `enrollment/removeCoParent.ts`

5. Extract verification functions:
   - All 8 verification functions (submitVerification through getVerificationDocument)

6. Extract admin functions:
   - `admin/writeAuditLog.ts`, `admin/verifyAdmin.ts`
   - `admin/blockUser.ts`, `admin/deleteUser.ts`, `admin/deactivateUser.ts`, `admin/resetUserPassword.ts`
   - `admin/listUsers.ts`, `admin/listAuditLogs.ts`
   - `admin/updateHolidays.ts`, `admin/exportUserData.ts`
   - `admin/managePreapprovedEmails.ts`

7. Update `apps/functions/src/index.ts` to import shared functions from `@ejm/shared-functions` and re-export them

**Verification:** `pnpm typecheck && pnpm build:functions`. Deploy to emulator and test auth flow, family enrollment, verification upload, admin dashboard.

**Done when:** All shared cloud functions live in `packages/shared-functions/`. `apps/functions/` only contains sync-sit-specific functions (enrollBabysitter, searchBabysitters, sendContactRequest, appointment lifecycle, references trigger, family preferences, scheduled tasks). sync-sit functions deploy and work correctly.

**Role:** Owns the Cloud Functions extraction. Moves shared functions (auth, family enrollment, verification, notifications, admin, config helpers) from `apps/functions/` into `packages/shared-functions/`, leaving sync-sit's deploy intact.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `nodejs-backend-patterns` | First — when planning the module boundary of `shared-functions/` (config, auth, enrollment, verification, notifications, admin) |
| `firebase-basics` | When wiring `shared-functions/src/config/firebase.ts` (Admin SDK init) |
| `firebase-auth-basics` | When extracting `verifyEjmEmail`, `verifyParentEmail`, `verifyCode` |
| `firebase-firestore` | On every function that touches `users` / `families` / `schedules` — cross-app collection writes need consistent patterns |

**Skills Agent 3 should NOT invoke:** anything React, Tailwind, Vite — Agent 3 owns backend only.

---

### Agent 4: Sync-Study Backend

**Scope:** `apps/study-functions/`

**Owns (exclusively):**
- All files in `apps/study-functions/`

**Does NOT touch:**
- Any file outside `apps/study-functions/`

**Depends on:** Agent 1 (shared-core types) + Agent 3 (shared function helpers).

**Tasks:**

1. Create `apps/study-functions/` package:
   - `package.json` (depends on `@ejm/shared-core`, `@ejm/shared-functions`, `firebase-functions`, `firebase-admin`)
   - `tsconfig.json`
   - `src/index.ts` (function exports)

2. Define sync-study-specific types (in the functions package or a study-specific types file):
   - `TutorUser` extending `ServiceProviderBase`
   - `SubjectOffering`, `LocationPref`
   - `SessionDoc`, `SessionInstanceDoc`
   - `SessionStatus`, `InstanceStatus`
   - Subject taxonomy constants (`SUBJECTS`, `CLASS_LEVELS`)
   - Tutor validation schemas

3. Build tutor enrollment:
   - `enrollTutor` cloud function — creates TutorUser with subjects, session lengths, location prefs, padding. Creates empty schedule. Sets `profiles.study.enrollmentComplete = false`.
   - Handle cross-app enrollment: detect existing sync-sit user, skip email verification, just collect tutoring preferences

4. Build search:
   - `searchTutors(subject, level, filters?)` — query tutors by subject+level match, apply filters (location pref, max rate, distance), return results with rate range, languages, endorsement count
   - `getTutorAvailability(tutorUid, startDate, endDate)` — read schedule + overrides, return sanitized boolean grid (no reasons exposed). Account for padding when calculating available start times for each allowed session length.

5. Build session booking:
   - `bookSession(tutorUid, subject, level, date, startTime, sessionLength, location)` — validate availability (including padding for in-person), lock in per-subject rate, create SessionDoc with status `pending`
   - `confirmSession(sessionId)` — tutor accepts; create schedule override for padded block; if recurring, trigger instance generation
   - `cancelSession(sessionId, reason)` — cancel session; remove schedule override; if recurring, cancel all future instances
   - `rescheduleInstance(instanceId, newDate, newStartTime)` — cancel one instance, create a new one-off session

6. Build recurring instance management:
   - `generateInstances(sessionId)` — on recurring session confirmation, generate SessionInstanceDoc for next 8 weeks (skip holiday weeks when schoolWeeksOnly=true)
   - `extendRecurring` (scheduled function) — weekly: for each active recurring session, generate the next week's instances to maintain the 8-week rolling window
   - Instance-level schedule override management

7. Build session lifecycle:
   - `modifySession(sessionId, fields)` — family modifies (mirrors sync-sit's modifyAppointment)
   - `acknowledgeModification(sessionId)` — tutor confirms seen
   - `getParentContacts(sessionId)` — fetch family contact info

**Verification:** Deploy to emulator. Test: tutor enrollment, subject-based search, availability query, one-time booking with padding, recurring booking with instance generation, single instance cancellation.

**Done when:** Full tutoring backend works end-to-end in emulator.

**Role:** Owns the new tutoring backend in `apps/study-functions/`. Builds tutor enrollment, subject-based search, availability queries with padding logic, session booking lifecycle, and recurring-instance generation. Reuses `@ejm/shared-functions` for everything shared.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `nodejs-backend-patterns` | First — when laying out the `study-functions` module structure (enrollment / search / sessions / scheduled) |
| `firebase-firestore` | On every write that creates schedule overrides with `appSource: 'study'` (§2), and when designing the `study-sessions/{id}/instances/{id}` subcollection with instance-level status independence (§6) |
| `zod` | When writing tutor enrollment schemas (`tutorImmutableProfileSchema`, `tutorSubjectsSchema`, `tutorSessionPrefsSchema`) and session-booking input validation |

The recurring-instance generator (`generateInstances`) and weekly `extendRecurring` Cloud Task are bespoke domain logic with no direct skill — drive them via the baseline `writing-plans` + `executing-plans`.

**Skills Agent 4 should NOT invoke:** anything React, Tailwind, Vite, accessibility — Agent 4 owns backend only.

---

### Agent 5: Sync-Study Frontend

**Scope:** `apps/study-web/`

**Owns (exclusively):**
- All files in `apps/study-web/`

**Does NOT touch:**
- Any file outside `apps/study-web/`

**Depends on:** Agent 1 (shared-core types) + Agent 2 (shared UI components).

**Tasks:**

1. Create `apps/study-web/` Vite+React app:
   - `package.json` (depends on `@ejm/shared-core`, `@ejm/shared-ui`, React, Tailwind, etc.)
   - `vite.config.ts`
   - `tsconfig.json`
   - `src/main.tsx`, `src/App.tsx`, `src/router.tsx`
   - `src/index.css` importing `@ejm/shared-ui/theme/base.css` + `@ejm/shared-ui/theme/study.css`
   - `src/config/firebase.ts` (same project, possibly different hosting site config)

2. Set up stores and hooks:
   - `src/stores/authStore.ts` (same pattern as sync-sit, with `profiles.study` awareness)
   - `src/hooks/useSessions.ts` (equivalent to useAppointments)
   - `src/hooks/useFamilySessions.ts`
   - `src/hooks/useSchedule.ts` (reuse shared schedule hook pattern)

3. Set up i18n:
   - `src/i18n/en.ts`, `src/i18n/fr.ts` with tutoring-specific translations
   - Shared keys (common UI labels) can reference shared translations

4. Build layouts and auth guards:
   - `src/layouts/PublicLayout.tsx`, `TutorLayout.tsx`, `FamilyLayout.tsx`, `AdminLayout.tsx`
   - `src/layouts/AuthGuard.tsx` (same pattern, checks `role === 'tutor'` or `role === 'parent'`)

5. Build public pages:
   - WelcomePage (study-branded), LoginPage (shared pattern), SignUpRolePage (tutor/parent choice)
   - About, Privacy, Terms, guides (study-specific content)

6. Build tutor enrollment:
   - `TutorEnrollment.tsx` — orchestrator (same pattern as BabysitterEnrollment)
   - Shared steps: StepEmail, StepVerify, StepPassword (import from shared-ui or copy pattern)
   - StepProfile (same as babysitter: name, DOB, class, gender)
   - **StepSubjects** (NEW) — subject picker: for each subject, select class levels and set per-subject rate
   - **StepSessionPrefs** (NEW) — session length checkboxes (30/45/60/75 min), location preference multi-select, padding minutes selector, about me, contact info, area settings

7. Build parent enrollment:
   - Largely identical to sync-sit parent enrollment — use shared components
   - May include abbreviated flow for cross-app enrollment (detect existing sync-sit parent)

8. Build subject-based search page:
   - Subject + level selector
   - Optional filters: location preference, max rate, distance
   - Results cards: tutor name, photo, languages, rate range, session lengths, locations, distance, endorsements
   - Click tutor -> expand or navigate to tutor availability view

9. Build calendar slot picker (the biggest new component):
   - Week-by-week view of tutor's availability (fetched via getTutorAvailability)
   - Click a day -> show available start times for each allowed session length
   - Padding is transparent to the family (they only see session times, not padding blocks)
   - Select start time + session length + location -> proceed to booking confirmation

10. Build tutor dashboard:
    - Pending session requests (accept/decline)
    - Upcoming sessions (with instance-level view for recurring)
    - Quick actions: view schedule, manage profile

11. Build family dashboard (tutoring version):
    - Active sessions, upcoming instances
    - Search for tutor shortcut
    - Pending requests status

12. Build session detail views:
    - Session card component (subject, tutor, date/time, location, rate, status)
    - Instance list for recurring sessions (with per-instance cancel/reschedule)

13. Build tutor portal pages:
    - AccountPage, SchedulePage (reuse WeeklyTimeline from shared-ui), EndorsementsPage
    - SubjectsPage (manage subjects, levels, rates post-enrollment)

**Verification:** Start dev server, test: tutor enrollment end-to-end, parent enrollment, search by subject, calendar slot picker, booking flow, recurring session dashboard.

**Done when:** Full tutoring frontend works end-to-end against emulator backend.

**Role:** Owns the new tutoring frontend in `apps/study-web/`. Scaffolds the Vite app, wires the `study.css` theme, builds tutor enrollment with two new steps (`StepSubjects`, `StepSessionPrefs`), the subject-based search page, and the calendar slot-picker. Reuses `@ejm/shared-ui` and `@ejm/shared-core` for everything shared.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `vite` | First — when scaffolding `apps/study-web/` (vite config, tsconfig, entry points) |
| `vercel-react-best-practices` | When building all new pages and components (router, layouts, hooks) |
| `tailwind-design-system` | When wiring `src/index.css` to import `@ejm/shared-ui/theme/base.css` + `study.css` correctly |
| `react-state-management` | When building `authStore` with `profiles.study` awareness (§2) and `useSessions` / `useFamilySessions` hooks |
| `firebase-auth-basics` | When wiring the auth guard that detects existing sync-sit users and routes them through the abbreviated tutoring-only enrollment (§2) |
| `i18n-localization` | On every new translation key — sync-study ships with en + fr parity from day one |

The calendar slot-picker (week-by-week availability with padding-aware start times) is bespoke and has no direct skill — drive it via the baseline `writing-plans` + `executing-plans`.

**Skills Agent 5 should NOT invoke:** Firebase Firestore data-modeling skills (that's Agent 4), Cloud Functions skills, refactor/codemod TypeScript skills — Agent 5 only consumes shared types, doesn't refactor them.

---

### Agent 6: Infrastructure & Integration

**Scope:** Root config files, Firebase configuration, Firestore rules, CI/CD

**Owns (exclusively):**
- `pnpm-workspace.yaml`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`
- Root `package.json` (scripts only)
- Root `tsconfig.base.json`
- `scripts/` directory

**Does NOT touch:**
- Any file inside `packages/` or `apps/`

**Tasks:**

1. **Phase 0 — Baseline:**
   - Tag current state: `git tag v1.0-pre-refactor`
   - Verify `pnpm typecheck && pnpm build && pnpm lint` passes
   - Document manual smoke test checklist for sync-sit

2. **Phase 1 — Workspace setup:**
   - Update `pnpm-workspace.yaml` to include new packages:
     ```yaml
     packages:
       - 'packages/*'
       - 'apps/*'
       - '!apps/mobile'
     ```
     (Already covers new packages/shared-core, shared-ui, shared-functions, study-web, study-functions)
   - Update root `package.json` scripts to include sync-study build/dev commands
   - Update `tsconfig.base.json` if needed for new package paths

3. **Firebase multi-site hosting:**
   - Create second hosting site target for sync-study
   - Update `firebase.json`:
     ```json
     {
       "hosting": [
         {
           "target": "sit",
           "public": "apps/web/dist",
           ...
         },
         {
           "target": "study",
           "public": "apps/study-web/dist",
           ...
         }
       ]
     }
     ```
   - Configure `.firebaserc` with hosting targets

4. **Functions deployment:**
   - Decide: single codebase with namespaced exports OR separate codebases
   - Update `firebase.json` functions config accordingly
   - Update predeploy/postdeploy scripts for shared package bundling

5. **Firestore rules update:**
   - Add rules for new collections: `study-sessions`, `study-searches`
   - Ensure `schedules` collection rules allow reads from both app contexts
   - Add `appSource` field awareness to override rules

6. **Firestore indexes:**
   - Add composite indexes for sync-study queries:
     - `study-sessions`: (tutorUserId + status + createdAt), (familyId + status + createdAt)
     - `study-searches`: (status + createdAt)
   - Keep existing sync-sit indexes unchanged

7. **Storage rules:**
   - Extend for tutor photo uploads (same pattern as babysitter photos)

8. **Build validation:**
   - After extraction phases: run full `pnpm typecheck && pnpm build && pnpm lint`
   - After sync-study is built: run same + emulator smoke tests

**Done when:** Both apps can be built, deployed independently, and share the same Firebase project correctly.

**Role:** Owns the root configs — workspace topology, Firebase project topology, Firestore security and indexes, deploy plumbing. The only agent permitted to edit `firebase.json`, `firestore.rules`, and `pnpm-workspace.yaml`.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `monorepo-management` (from baseline) | When updating `pnpm-workspace.yaml`, root scripts, and `tsconfig.base.json` for the new packages |
| `firebase-hosting-basics` | When configuring the multi-site hosting block in `firebase.json` (step 3) |
| `firebase-app-hosting-basics` | Only if a decision is made to switch one or both apps to App Hosting; otherwise skip |

**Skills Agent 6 should NOT invoke:** anything inside `packages/` or `apps/` — Agent 6 owns root config only. No React, Vite, TypeScript-codemod, or Firestore-data-modeling skills.

---

### Optional: Agent 7 — Regression Guardian

**Scope:** Read-only. Does not write code.

**Purpose:** After any other agent pushes changes, this agent pulls and runs:
```bash
pnpm typecheck && pnpm build && pnpm lint
```

If any command fails, it reports exactly what broke and which agent's last change likely caused it.

This agent acts as continuous integration for teams without a CI pipeline. It can be dropped once CI is set up.

**Role:** Read-only validator. Never writes code. After any other agent finishes a phase, Agent 7 runs the build pipeline, interprets failures, and points the team at the offending change. Uses `receiving-code-review` (baseline) as the lens for reviewing diffs.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `vitest` | When interpreting test output, deciding whether a failure is a true regression or a flake |
| `javascript-testing-patterns` | When suggesting which tests the prior agent should add to catch the regression next time |
| `code-review-excellence` | When reviewing the diff of a completed phase against §4's "stays where" tables and §8's ownership rules |
| `typescript-react-reviewer` | After Agents 1, 2, and 5 — catches import-path drift after re-export swaps and stale component prop types |

**Skills Agent 7 should NOT invoke:** any skill that produces code changes (`refactor-plan`, `executing-plans` in write mode, `typescript-magician`). Agent 7 reports, it does not fix.

---

### Agent 8: Tester

**Scope:** Cross-cutting. Read-mostly. Owns the functional test plan and runs the full functional regression of sync-sit plus the scope-coverage check of sync-study.

**Owns (exclusively):**
- `docs/agent-runs/agent-8-test-plan.md` (the living test plan)
- New test files anywhere under `apps/web/src/**/__tests__/`, `apps/functions/src/**/__tests__/`, `apps/study-web/src/**/__tests__/`, `apps/study-functions/src/**/__tests__/` (NEW tests only — never edits existing tests authored by other agents)

**Does NOT touch:**
- Production code in any `packages/` or `apps/` source file
- Firestore rules (Agent 6) or firebase.json (Agent 6)
- Existing test files written by other agents

**Depends on:** Has read access to every other agent's branch. Activated by the coordinator at each phase boundary.

**Two binding mandates:**
1. **Sync-sit must not regress.** After every phase, exercise the full sync-sit functional surface (babysitter enrollment, parent enrollment, family invite, search, contact request, appointment lifecycle, schedule edit, references, admin actions, verification flow). If any pre-existing behavior changes, flag it as a regression.
2. **Sync-study scope must be fully implemented.** After Phase 3 completes, verify every feature listed in §6 (Domain Model), §9 (V1 Scope Decisions), and Agent 5's task list is reachable end-to-end — tutor enrollment with subjects and session prefs, subject-based search, calendar slot picker with padding-aware availability, one-time and recurring session booking, instance-level cancel/reschedule, schoolWeeksOnly holiday handling.

**Tasks:**

1. **Phase 0 deliverable:** Produce `docs/agent-runs/agent-8-test-plan.md` containing:
   - Sync-sit regression checklist (one row per user-facing flow, with steps + expected result)
   - Sync-study scope-coverage matrix (one row per V1 feature, mapped to the §6 / §9 / Agent 5 anchor)
   - Definition of "pass" for each row (visual, log, network, Firestore write)

2. **After every phase boundary:** Run the sync-sit regression checklist (against emulator + a sync-sit dev build of the integration branch). Report any deltas to the coordinator with the specific failing flow + repro steps.

3. **After Phase 3:** Run the sync-study scope-coverage matrix. For each row, write a thin automated test or document a manual reproduction. Report any uncovered scope to the coordinator with the specific gap.

4. **Post-Phase 4 final pass:** Full sync-sit regression + full sync-study scope coverage + cross-app scenarios (a user enrolled in sync-sit completing the abbreviated sync-study enrollment; a booking from one app blocking slots visible in the other).

5. **Test artifacts:** Add new tests under the test directories above when a flow is automatable. Never modify a test authored by another agent — if a test is wrong, report it.

**Role:** The functional auditor. Agent 7 confirms it builds; Agent 8 confirms it works. Agent 8 is the only member tasked with end-to-end user-flow verification of both apps.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `qa-test-planner` | First — when producing the Phase 0 test plan document (`docs/agent-runs/agent-8-test-plan.md`) |
| `e2e-testing-patterns` | When designing or running end-to-end flows (sync-sit regression scenarios, sync-study booking happy paths) |
| `webapp-testing` (built-in) | When operating the sync-sit and sync-study dev servers via Playwright to verify flows |
| `javascript-testing-patterns` | When writing new Vitest tests under `__tests__/` directories |
| `vitest` | When interpreting test output and configuring focused runs |

**Skills Agent 8 should NOT invoke:** any refactor or codemod skill (`refactor-plan`, `typescript-magician`), any production code-authoring skill, Firebase config-modification skills. Agent 8 verifies; it does not fix.

**Done when:**
- The test plan exists and was approved by the coordinator before Phase 1 began.
- Every phase boundary has a green sync-sit regression report.
- The post-Phase 3 scope-coverage matrix is 100% covered (every row is either green or has an explicit, user-approved waiver).
- The post-Phase 4 final pass is green.

---

### Agent 9: Security Specialist

**Scope:** Cross-cutting. Read-mostly. Owns the security baseline, the security review of every phase, and the GDPR review of new data flows.

**Owns (exclusively):**
- `docs/agent-runs/agent-9-security-baseline.md` (security baseline established at Phase 0)
- `docs/agent-runs/agent-9-phase-<N>-review.md` (one review report per phase)

**Does NOT touch:**
- Any production code, configuration, or rules file
- Firestore rules (Agent 6 implements; Agent 9 reviews and approves)
- Firebase secrets, service accounts, or environment variables (read for review only)

**Depends on:** Has read access to every other agent's branch. Activated by the coordinator at every phase boundary, with heavier engagement at Phases 2, 3, and 4.

**Two binding mandates:**
1. **No new security risks.** Every change must be at least as secure as sync-sit's current posture: auth boundaries preserved, cross-app blast radius controlled, secrets handling unchanged, Firestore rules tightened or unchanged (never loosened), CORS surface unchanged for shared endpoints.
2. **GDPR expectations preserved.** Personal data handling (user, family, kid, verification documents) must continue to meet the existing posture: data minimization, purpose limitation, retention behavior (cleanupOldData), DSR support (exportUserData), no new PII leak surfaces, no cross-border data movement beyond europe-west1.

**Tasks:**

1. **Phase 0 deliverable:** Produce `docs/agent-runs/agent-9-security-baseline.md`:
   - Current auth model (who can call which Cloud Function)
   - Current Firestore rules summary (which collections + which document fields are protected)
   - Current PII inventory (where personal data lives across `users`, `families`, `kids`, `verifications`, `appointments`, `references`)
   - Current secrets surface (Resend, FCM, Firebase Admin)
   - Current GDPR posture (DSR endpoints, retention, region locking)

2. **After Phase 2 (shared-functions extraction):**
   - Confirm extracted auth functions preserve exact authorization checks
   - Confirm shared notification senders preserve recipient validation
   - Confirm `notifyParents` does not leak PII across apps

3. **After Phase 3 (sync-study backend):**
   - Audit `searchTutors` for over-fetch (no babysitter-only fields leaking into tutor responses)
   - Audit `getTutorAvailability` for the sanitized boolean grid requirement (no reason exposure per §6)
   - Audit `bookSession` and recurring instance generation for authz on the booking family
   - Audit cross-app schedule override writes (`appSource` tag, no cross-tenant data flow)
   - Confirm tutor PII handling matches babysitter PII handling
   - Audit `enrollTutor` for the same email-verification and identity-verification posture as `enrollBabysitter`

4. **After Phase 4 (Agent 6 — firestore.rules update):**
   - Audit the new rules for `study-sessions/*` and `study-searches/*` against the baseline
   - Confirm shared `schedules` rules still enforce per-user write isolation
   - Confirm `appSource` field cannot be set to forge cross-app writes
   - Confirm the new composite indexes don't reveal data via index-only scans
   - Confirm storage.rules tutor-photo additions match babysitter-photo posture

5. **Final pass:** Produce a sign-off `agent-9-final-review.md` listing every reviewed surface and approval state.

**Role:** The security and privacy auditor. Reads the diff, runs the rules through `firebase-security-rules-auditor`, maps changes against GDPR posture, blocks merge on any unmitigated finding.

**Skills to Invoke (beyond the baseline):**

| Skill | When to invoke |
|---|---|
| `security-requirement-extraction` | First — when producing the Phase 0 security baseline from §3 and §4 |
| `firebase-security-rules-auditor` | After every change to `firestore.rules` (heaviest engagement at Phase 4) |
| `gdpr-data-handling` | After Phases 2, 3, 4 — for the GDPR data-flow review |
| `api-security-best-practices` | After Phases 2 and 3 — Cloud Functions are the API surface |
| `secrets-management` | After Phase 2 — when shared-functions takes ownership of Resend / FCM clients |
| `threat-mitigation-mapping` | After Phase 3 — to model cross-app blast radius (sync-sit ↔ sync-study) |
| `/security-review` (built-in) | At every phase boundary — pending-changes security review on the integration branch |

**Skills Agent 9 should NOT invoke:** any code-authoring or refactor skill. Agent 9 reads, reviews, blocks; it does not modify.

**Done when:**
- The Phase 0 security baseline exists and was approved by the coordinator before Phase 1 began.
- Every per-phase review report exists with a clear PASS / BLOCKED state.
- All BLOCKED findings have been remediated by the originating agent and re-reviewed.
- The final review `agent-9-final-review.md` exists with a PASS state across every reviewed surface.

---

### Skills Explicitly Skipped

These were considered but are not worth installing for this project:

| Skill | Why skipped |
|---|---|
| `firebase-data-connect`, `firebase-ai-logic`, `developing-genkit-*` | Genkit and Data Connect are not in the stack |
| `gcp-cloud-run`, `azure-*` | Wrong cloud surface — sync-platform runs on Firebase Functions 2nd gen + Hosting |
| `playwright-*` | §7 calls for manual smoke tests + emulator runs, not browser E2E. Revisit only if a Playwright suite is later adopted |
| `prd-*` (PRD authoring) | This plan already exists; PRD authoring is not the bottleneck |

---

### Agent Coordination Rules

| Rule | Reason |
|------|--------|
| Agent 1 is the **only** one that touches `packages/shared/` and `packages/shared-core/` | Prevents merge conflicts on re-export files |
| Agent 2 is the **only** one that touches `apps/web/src/components/ui/` | Component extraction |
| Agent 3 is the **only** one that touches `apps/functions/src/` (existing function files) | Function extraction |
| Agent 6 is the **only** one that touches root config files | Prevents conflicting firebase.json edits |
| Agents 4 and 5 work in **completely separate directories** | No overlap possible |
| Agent 1 completing core types is the **gate** for Agents 3, 4, 5 | Types are the foundation everything imports |
| Every agent runs `pnpm typecheck` after its changes | Catches breakage immediately |
| No agent pushes to main/master without Agent 7 (or CI) validating | Safety net |
| Agent 8 (Tester) is the **only** one that authors tests in `__tests__/` directories during this project | Prevents implementation agents from green-stamping their own work |
| Agent 9 (Security) is the **only** one with sign-off authority on `firestore.rules` and `storage.rules` changes | Single point of accountability for security posture |
| No phase advances until Agents 7, 8, and 9 have all reported PASS for that phase | Triple gate: build, function, security |

---

## 9. V1 Scope Decisions

Decisions made during planning, recorded here for reference:

| Feature | V1 Decision | Rationale |
|---------|------------|-----------|
| **Group tutoring** | No | Future upgrade to availability module (capacity per slot). Design SessionInstance so `participants[]` is additive later. |
| **Per-subject pricing** | Yes | Natural expectation. `SubjectOffering` includes `rate`. Search shows rate range. |
| **Session notes** | No | Future: simple `preSessionNote` / `postSessionNote` free-text fields on SessionInstance. No task/homework management. |
| **Cancellation policy** | Same as babysitting | Simple cancel-anytime. Policy communication is out of scope. |
| **Online session link** | No | Tutor shares their own link. No platform integration. |
| **Tutor-initiated booking** | No | Future: cross-app feature. Provider proposes -> family confirms. Will benefit both apps. |
| **In-app messaging** | No | Participants use existing contact methods. |
| **Waiting lists** | No | Separate feature, no architectural impact. |
| **Trial sessions** | No | Just a `type: 'trial'` flag later. No structural change. |
| **Tutor qualifications display** | No | Just profile fields later. Additive. |

---

## 10. Future Roadmap

Features deferred from V1, ordered by architectural impact:

### Near-term (V1.1 — incremental additions)

1. **Session notes** — Add `preSessionNote` and `postSessionNote` to SessionInstanceDoc. Add UI for tutor to fill in post-session. Additive change, no migration.
2. **Trial sessions** — Add `type: 'trial'` to SessionDoc. First session in a recurring plan can be flagged as trial. UI shows trial badge.
3. **Tutor-initiated booking** — Add `proposedBy: 'provider' | 'family'` to session base type in shared-core. Build "propose session" flow for both apps. Tutors and babysitters can propose times to families they've worked with.

### Medium-term (V2 — module upgrades)

4. **Group sessions / capacity-based availability** — Upgrade ScheduleDoc: slots become capacity counters (e.g., `maxConcurrent: 3`). Booking decrements capacity instead of blocking. Works for both group tutoring and group babysitting (multiple families).
5. **Parental account governance** — For 13-year-old students who are both kids (in a family) and providers (tutor or babysitter). Parent account governs the child's provider account. Shared-core gets `governedBy: parentUid` on ServiceProviderBase.
6. **Non-EJM providers** — Extend enrollment to allow non-@ejm.org email with alternative verification (admin approval, community vouching). Shared across both apps.
7. **Cancellation policies** — Add `cancellationPolicy` config per provider or per app. Enforce cancellation windows in session lifecycle functions.

### Long-term (V3 — platform features)

8. **In-app messaging** — Real-time chat between families and providers. Shared infrastructure for both apps.
9. **Progress tracking** — Full tutoring progress system: session logs, homework assignments, progress reports. sync-study-specific feature.
10. **Waiting lists** — Notify families when a popular tutor has availability. New collection, triggered by schedule changes.
11. **Analytics dashboard** — Admin view: usage stats, popular subjects, tutor utilization, booking completion rates.
12. **Unified admin panel** — Single admin app managing both sync-sit and sync-study. Separate from either app's admin section.
