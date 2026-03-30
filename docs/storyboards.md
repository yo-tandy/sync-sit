# EJM Babysitting Coordinator — Storyboards

> Each storyboard describes a user flow screen-by-screen.
> Notation: `[Button]`, `(input field)`, `→` = navigates to, `*` = system action behind the scenes.

---

## Flow 0 — Global Navigation & Info Pages

> These elements are accessible to ALL users — before and after enrollment,
> logged in or not. They appear in a persistent menu (hamburger or footer).

### Screen 0.1 · Global Menu
```
┌─────────────────────────────────┐
│  ☰ Menu                         │
│                                 │
│  [About]                        │
│  [Report a Problem]             │
│  [Privacy Policy]               │
│  [Terms & Conditions]           │
│                                 │
│  ── If logged in: ──            │
│  [My Portal]                    │
│  [Settings]                     │
│  [Log out]                      │
└─────────────────────────────────┘
```
* Available on every screen via a persistent menu icon
* Same menu for babysitters, parents, and unauthenticated visitors

### Screen 0.2 · About Page
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  About EJM Babysitting          │
│                                 │
│  This app connects EJM high     │
│  school students who babysit    │
│  with EJM families looking      │
│  for childcare.                  │
│                                 │
│  [Content TBD — Yoav to provide │
│   or approve draft copy]        │
│                                 │
│  Version: 1.0.0                 │
└─────────────────────────────────┘
```

### Screen 0.3 · Report a Problem
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Report a Problem                │
│                                 │
│  If you're experiencing an       │
│  issue, please send an email     │
│  to our support address.         │
│                                 │
│  [Send email to support]         │
│                                 │
│  This will open your email app   │
│  with the following pre-filled:  │
│                                 │
│  To:   support@[domain TBD]     │
│  Subject: Problem Report         │
│  Body:                           │
│  ┌─────────────────────────────┐│
│  │ User ID: usr_abc123         ││
│  │ (or "Not logged in")       ││
│  │ Time: 2026-03-28 14:32 CET ││
│  │ App version: 1.0.0         ││
│  │ Platform: iOS / Web / …    ││
│  │ Recent errors:              ││
│  │  [auto-captured client-side ││
│  │   errors, if any]           ││
│  │                             ││
│  │ Describe your issue:        ││
│  │ ___________________________  ││
│  └─────────────────────────────┘│
│                                 │
│  ℹ️ Your user ID is included to │
│  help us investigate. No other   │
│  personal data is sent           │
│  automatically.                  │
└─────────────────────────────────┘
```
* Uses `mailto:` link to open native email client
* Pre-fills: user ID (if logged in, otherwise "Not logged in"),
  timestamp, app version, platform, and any recent client-side
  errors captured from the local error log
* User can edit the email freely before sending

### Screen 0.4 · Privacy Policy
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Privacy Policy                  │
│                                 │
│  [Content TBD — to be provided  │
│   before launch]                 │
│                                 │
│  Last updated: [date]            │
└─────────────────────────────────┘
```
* Static page, content provided separately
* Available in EN and FR (follows user's language setting or browser locale)

### Screen 0.5 · Terms & Conditions
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                 │
│  Terms & Conditions              │
│                                 │
│  [Content TBD — to be provided  │
│   before launch]                 │
│                                 │
│  Last updated: [date]            │
└─────────────────────────────────┘
```
* Static page, content provided separately
* Available in EN and FR

---

## Flow 1 — Babysitter Enrollment

### Screen 1.1 · Welcome / Role Selection
```
┌─────────────────────────────────┐
│  ☰          EJM Babysitting     │
│                                 │
│  I am a...                      │
│  ┌─────────────┐                │
│  │ Babysitter  │                │
│  └─────────────┘                │
│  ┌─────────────┐                │
│  │   Parent    │                │
│  └─────────────┘                │
│                                 │
│  Already have an account?       │
│  [Log in]                       │
└─────────────────────────────────┘
```
* ☰ menu icon gives access to About, Report a Problem, Privacy Policy, Terms & Conditions

### Screen 1.2 · EJM Email Verification
```
┌─────────────────────────────────┐
│  Step 1 of 3 — Verify School    │
│                                 │
│  Enter your EJM email address:  │
│  (___________@ejm.org)          │
│                                 │
│  [Send verification code]       │
│                                 │
│  ℹ️ You must use your EJM email │
│    ending in 26–29              │
└─────────────────────────────────┘
```
* System validates domain is `@ejm.org`
* System validates last 2 digits of the local part are within the allowed graduation year range
* System sends a 6-digit code via Resend to the EJM address
* If invalid domain or year → inline error: "Please use a current EJM student email"

### Screen 1.3 · Code Entry
```
┌─────────────────────────────────┐
│  Enter the code we sent to      │
│  marie.duval28@ejm.org          │
│                                 │
│  ( _ _ _ _ _ _ )                │
│                                 │
│  [Verify]     Resend code       │
└─────────────────────────────────┘
```
* On success → Screen 1.4
* On failure → "Invalid code. Try again."
* Resend has a 60-second cooldown

### Screen 1.4 · Set Password
```
┌─────────────────────────────────┐
│  Create your password            │
│                                 │
│  Password      (************)   │
│  Confirm       (************)   │
│                                 │
│  [Continue]                     │
└─────────────────────────────────┘
```
* Firebase Auth account created with email + password

### Screen 1.5 · Personal Information
```
┌─────────────────────────────────┐
│  Step 2 of 3 — About You        │
│                                 │
│  First name *     (__________)  │
│  Last name *      (__________)  │
│  Date of birth *  (DD/MM/YYYY)  │
│  Gender           (dropdown ▾)  │
│                    ☐ Prefer not │
│  Class *          (__________)  │
│  Photo            [Upload]      │
│                                 │
│  Languages spoken *             │
│  ☑ French  ☑ English  ☐ Other  │
│                                 │
│  [Continue]                     │
└─────────────────────────────────┘
```
* DoB validated: must be ≥ 15 years old
* Photo: optional, max 5 MB, stored in GCS
* Gender: optional

### Screen 1.6 · Babysitting Preferences
```
┌─────────────────────────────────┐
│  Step 3 of 3 — Preferences      │
│                                 │
│  Age range of kids I'll watch * │
│  (min age ▾)  to  (max age ▾)  │
│                                 │
│  Max number of kids *  (__ ▾)   │
│                                 │
│  Hourly rate (€) *   (______)   │
│                                 │
│  About me / experience          │
│  (__________________________)   │
│                                 │
│  Contact (at least one) *       │
│  Email        (______________)  │
│  Phone        (______________)  │
│                                 │
│  Area I can babysit in *        │
│  ○ By arrondissement / town     │
│    ☐ 1er ☐ 2e ... ☐ 20e        │
│    ☐ Boulogne ☐ Neuilly ...     │
│  ○ By distance from address     │
│    Address (________________)   │
│    Max distance  (____ km ▾)    │
│                                 │
│  [Complete enrollment]          │
└─────────────────────────────────┘
```
* On submit → account created, redirect to babysitter portal
* Geocoding via api-adresse.data.gouv.fr if address mode selected

---

## Flow 2 — Babysitter Portal (Home)

### Screen 2.1 · Dashboard
```
┌─────────────────────────────────┐
│  👋 Hi Marie           [⚙️] [🔔]│
│                                 │
│  ┌─ New Requests (2) ─────────┐ │
│  │ Dupont family  │ Mar 28 18h│ │
│  │ 2 kids (4,7)   │ [View]   │ │
│  ├─────────────────┼──────────┤ │
│  │ Martin family  │ Recurring │ │
│  │ 1 kid (10)     │ [View]   │ │
│  └─────────────────┴──────────┘ │
│                                 │
│  ┌─ Confirmed (3) ───────────┐  │
│  │ Bernard family │ Mar 30 …  │ │
│  │ ...                        │ │
│  └────────────────────────────┘ │
│                                 │
│  ┌─ Past (1) ────────────────┐  │
│  │ Petit family   │ Mar 20 …  │ │
│  └────────────────────────────┘ │
│                                 │
│  ┌─ Rejected (1) ────────────┐  │
│  │ Moreau family  │ Mar 22 …  │ │
│  └────────────────────────────┘ │
│                                 │
│  [Edit Profile] [Edit Schedule] │
│  [Manage References]            │
└─────────────────────────────────┘
```
* Past appointments: visible for 1 week after appointment date
* Rejected appointments: visible for 1 week
* 🔔 badge shows unread notification count

---

## Flow 3 — Babysitter Schedule Management

### Screen 3.1 · Weekly Recurring Schedule
```
┌──────────────────────────────────────┐
│  My Weekly Schedule                   │
│                                       │
│  Mon  ░░░░░░░░████████░░░░░░░░░░░░  │
│  Tue  ░░░░░░░░░░░░░░░░████████░░░░  │
│  Wed  ░░░░░░░░████████████████░░░░  │
│  Thu  ░░░░░░░░░░░░░░░░████████░░░░  │
│  Fri  ░░░░░░░░████████████████████  │
│  Sat  ████████████████░░░░░░░░░░░░  │
│  Sun  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│       6h    9h   12h   15h   18h  21h│
│                                       │
│  ████ = Available  ░░░░ = Unavailable │
│  Tap a day row to edit 15-min slots   │
│                                       │
│  School holidays:                     │
│  ○ Same as regular schedule           │
│  ○ Different (expand to edit)         │
│  ○ Not available during holidays      │
│                                       │
│  Notes for holidays:                  │
│  (_________________________________) │
│                                       │
│  [Save]                               │
└──────────────────────────────────────┘
```

### Screen 3.2 · Date Overrides
```
┌──────────────────────────────────────┐
│  Schedule Overrides                   │
│                                       │
│  These override your weekly schedule  │
│  for specific dates.                  │
│                                       │
│  ┌──────────────────────────────┐    │
│  │ Apr 5 — Unavailable          │ [✕]│
│  │ Apr 12 — Available 14h–20h   │ [✕]│
│  └──────────────────────────────┘    │
│                                       │
│  [+ Add override]                     │
│                                       │
│  Date      (DD/MM/YYYY)              │
│  ○ Unavailable all day                │
│  ○ Available during:                  │
│    From (HH:MM ▾)  To (HH:MM ▾)     │
│                                       │
│  [Save override]                      │
└──────────────────────────────────────┘
```

---

## Flow 4 — Babysitter References

### Screen 4.1 · References List
```
┌─────────────────────────────────┐
│  My References                   │
│                                  │
│  ┌ Manually Added ─────────────┐│
│  │ Jean Dupont  📞 06...       ││
│  │ EJM family · 2 kids (5, 8) ││
│  │ "Very reliable babysitter"  ││
│  │ [Edit contact] [Remove]     ││
│  └─────────────────────────────┘│
│                                  │
│  ┌ Family Submitted ───────────┐│
│  │ 🔵 Sophie Martin            ││
│  │ EJM family · 1 kid (10)    ││
│  │ "Marie is wonderful with…"  ││
│  │ Status: ⏳ Pending approval  ││
│  │ [Approve] [Remove]          ││
│  └─────────────────────────────┘│
│                                  │
│  [+ Add reference manually]     │
└─────────────────────────────────┘
```

### Screen 4.2 · Add Reference Manually
```
┌─────────────────────────────────┐
│  Add a Reference                 │
│                                  │
│  Full name *     (____________) │
│  Phone           (____________) │
│  Email           (____________) │
│  EJM family?     ☐ Yes          │
│  Number of kids  (__▾)          │
│  Ages of kids    (__, __, __)   │
│  Note            (___________   │
│                   ___________)  │
│                                  │
│  [Save reference]                │
└─────────────────────────────────┘
```

---

## Flow 5 — Parent + Family Enrollment

### Screen 5.1 · Parent Email Verification
```
┌─────────────────────────────────┐
│  Step 1 of 3 — Your Account     │
│                                  │
│  Email address *  (___________) │
│  [Send verification code]       │
└─────────────────────────────────┘
```
* Any email domain accepted
* Same 6-digit code flow as babysitter

### Screen 5.2 · Code Entry + Password
```
(Same pattern as Screens 1.3 + 1.4)
```

### Screen 5.3 · Parent & Family Info
```
┌─────────────────────────────────┐
│  Step 2 of 3 — Your Family      │
│                                  │
│  Family name *    (___________) │
│  Your last name   (___________) │
│    (if different from family name)│
│  First name *     (___________) │
│                                  │
│  Address *        (___________) │
│    (autocomplete via gouv.fr)    │
│                                  │
│  Family photo     [Upload]       │
│  Pets             (___________) │
│  Note about family               │
│  (___________________________)  │
└─────────────────────────────────┘
```

### Screen 5.4 · Kids
```
┌─────────────────────────────────┐
│  Step 2 (cont.) — Your Kids     │
│                                  │
│  Kid 1                           │
│  First name *  (________)       │
│  Age *         (__▾)            │
│  Languages *   ☑ FR ☑ EN ☐ …   │
│                                  │
│  [+ Add another kid]            │
│                                  │
│  [Continue]                      │
└─────────────────────────────────┘
```

### Screen 5.5 · Default Search Preferences (optional)
```
┌─────────────────────────────────┐
│  Step 3 of 3 — Search Defaults  │
│  (These pre-fill every search.   │
│   You can skip and set later.)   │
│                                  │
│  Min babysitter age  (__▾)      │
│  Preferred gender    (any ▾)    │
│  Must have references ☐          │
│  Max rate (€/hr)     (______)   │
│                                  │
│  [Complete enrollment]           │
│  [Skip for now]                  │
└─────────────────────────────────┘
```
* On submit → redirect to family portal

---

## Flow 6 — Parent Invite (Second Parent Joins Family)

### Screen 6.1 · Generate Invite Link (from Family Portal)
```
┌─────────────────────────────────┐
│  Family Settings                 │
│                                  │
│  Members:                        │
│  • Yoav Schwartz (you)          │
│  • [+ Add a parent]             │
│                                  │
│  → Generates a secure link       │
│    valid for 1 hour              │
│                                  │
│  ┌──────────────────────────┐   │
│  │ https://app.../invite/   │   │
│  │ abc123xyz                │   │
│  │ [Copy link]  Expires in  │   │
│  │              58 minutes  │   │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

### Screen 6.2 · Invited Parent Lands on Link
```
┌─────────────────────────────────┐
│  Join the Schwartz Family        │
│                                  │
│  You've been invited to join     │
│  this family on EJM Babysitting. │
│                                  │
│  Your email *    (____________) │
│  Password *      (************) │
│  Last name       (____________) │
│    (if different from Schwartz)  │
│  First name *    (____________) │
│                                  │
│  [Join family]                   │
└─────────────────────────────────┘
```
* Email verification required
* On submit → added to the family, sees the family portal

---

## Flow 7 — Family Portal (Home)

### Screen 7.1 · Family Dashboard
```
┌─────────────────────────────────┐
│  Schwartz Family       [⚙️] [🔔]│
│                                  │
│  [🔍 Find a Babysitter]         │
│                                  │
│  ┌─ Pending Requests ──────────┐│
│  │ Search: Mar 28, 18h–22h    ││
│  │  → Marie D. — waiting      ││
│  │  → Lucas R. — waiting      ││
│  │ [Cancel all in this search] ││
│  ├─────────────────────────────┤│
│  │ Search: Recurring Tue/Thu   ││
│  │  → Emma B. — waiting       ││
│  └─────────────────────────────┘│
│                                  │
│  ┌─ Confirmed (2) ────────────┐ │
│  │ Marie D. │ Mar 30 18h–22h  │ │
│  │ Emma B.  │ Recurring Tue…  │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌─ Past (1)  ────────────────┐ │
│  │ Lucas R. │ Mar 20          │ │
│  │ [Be a reference for Lucas] │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌─ Rejected/Cancelled (1) ──┐  │
│  │ Paul M. │ Rejected by BS   │ │
│  └────────────────────────────┘ │
│                                  │
│  [Family Settings] [Edit Kids]  │
└─────────────────────────────────┘
```
* "Be a reference" button appears on past confirmed appointments

---

## Flow 8 — Family Search for Babysitter

### Screen 8.1 · Search Type Selection
```
┌─────────────────────────────────┐
│  Find a Babysitter               │
│                                  │
│  What type of babysitting?       │
│  ┌───────────────┐               │
│  │  One-time     │               │
│  └───────────────┘               │
│  ┌───────────────┐               │
│  │  Recurring    │               │
│  └───────────────┘               │
└─────────────────────────────────┘
```

### Screen 8.2a · One-Time Search Details
```
┌─────────────────────────────────┐
│  One-Time Babysitting            │
│                                  │
│  Date *       (DD/MM/YYYY)      │
│  Start time * (HH:MM ▾)        │
│  End time *   (HH:MM ▾)        │
│                                  │
│  Which kids? *                   │
│  ☑ Noah (4)  ☑ Emma (7)        │
│                                  │
│  Address *                       │
│  (pre-filled from family addr)  │
│  [Change address]                │
│                                  │
│  Rate you'd like to pay (€/hr)  │
│  (______)                        │ <-prefilled from the default settings
│  ℹ️ Only babysitters at or below │
│    this rate will appear         │
│                                  │
│  Additional info                 │
│  (e.g. serve dinner, bedtime…)  │
│  (___________________________)  │
│                                  │
│  ── Babysitter Filters ──        │
│  (pre-filled from defaults)      │
│  Min age        (__▾)           │
│  Gender pref    (any ▾)         │
│  Has reference  ☐               │
│                                  │
│  [Search]                        │
└─────────────────────────────────┘
```

### Screen 8.2b · Recurring Search Details
```
┌─────────────────────────────────┐
│  Recurring Babysitting           │
│                                  │
│  Days & times *                  │
│  ☑ Mon  (16:00 ▾) to (19:00 ▾)│
│  ☐ Tue                          │
│  ☑ Wed  (14:00 ▾) to (18:00 ▾)│
│  ☐ Thu                          │
│  ☐ Fri                          │
│  ☐ Sat                          │
│  ☐ Sun                          │
│                                  │
│  During school holidays too?     │
│  ○ School weeks only             │
│  ○ Including holidays            │
│                                  │
│  Which kids? *                   │
│  ☑ Noah (4)  ☐ Emma (7)        │
│                                  │
│  Address *  (pre-filled)        │
│  Rate (€/hr)  (______)          │<-prefilled from the default settings
│  Additional info (____________) │
│                                  │
│  ── Babysitter Filters ──        │
│  (same as one-time)              │
│                                  │
│  [Search]                        │
└─────────────────────────────────┘
```
* No end date for recurring — runs until cancelled

### Screen 8.3 · Search Results
```
┌──────────────────────────────────────┐
│  Results for Mar 28, 18h–22h  (5)    │
│                                       │
│  Sort by: (Age ▾) (Proximity ▾)      │
│                                       │
│  ┌──────────────────────────────┐    │
│  │ 📷 Marie D.        17 ans   │    │
│  │ Class: 2nde                  │    │
│  │ 🗣 FR, EN                    │    │
│  │ 👶 Ages 3–12, up to 3 kids  │    │
│  │ 📍 1.2 km away              │    │
│  │ ⭐ 2 references              │    │
│  │ "Experienced with toddlers…" │    │
│  │                              │    │
│  │ [Contact Marie]              │    │
│  └──────────────────────────────┘    │
│                                       │
│  ┌──────────────────────────────┐    │
│  │ 📷 Lucas R.        16 ans   │    │
│  │ ...                          │    │
│  │ [Contact Lucas]              │    │
│  └──────────────────────────────┘    │
│                                       │
│  ... more cards ...                   │
└──────────────────────────────────────┘
```
* Rate is NOT shown on the card (filtered behind the scenes)
* References count shown; families can tap to expand reference details
* No results → "No babysitters match your criteria. Try adjusting your filters."

### Screen 8.4 · Contact Confirmation
```
┌─────────────────────────────────┐
│  Contact Marie D.?               │
│                                  │
│  We will:                        │
│  • Notify Marie by email and     │
│    push notification              │
│  • Add this to your pending      │
│    requests                       │
│                                  │
│  💡 Tip: Include the rate you're │
│  willing to pay in your request  │
│  to help the babysitter decide.  │
│                                  │
│  Message to babysitter (optional)│
│  (___________________________)  │
│  Rate offered: €__/hr (optional) │ <-prefilled from the search parameters
│                                  │
│  [Send request]    [Cancel]      │
└─────────────────────────────────┘
```
* On "send request":
  - Email sent to babysitter's EJM email via Resend
  - FCM push notification triggered
  - If babysitter has contact info → show to parent on a confirmation screen "you can also contact the babysitter on email [....]/phone [....]". This will also be available in the pending requests list cards
  - Request appears in family's "Pending Requests" and babysitter's "New Requests"

---

## Flow 9 — Babysitter Responds to Request

### Screen 9.1 · Request Detail (from babysitter portal)
```
┌─────────────────────────────────┐
│  ← Back                         │
│                                  │
│  Request from Schwartz Family    │
│  📷 Family photo                 │
│                                  │
│  📅 March 28, 18h–22h           │
│  👶 Noah (4), Emma (7)           │
│  🗣 French, English              │
│  🐾 Cat                          │
│  📍 15 Rue de Rivoli, 75001     │
│     (1.2 km from you)            │
│                                  │
│  Note: "Serve dinner around 19h, │
│  bedtime at 20h30"               │
│                                  │
│  Rate offered: €15/hr            │
│                                  │
│  Contact:                        │
│  📧 parent@email.com             │
│  📞 06 12 34 56 78               │
│                                  │
│  [Accept]        [Decline]       │
└─────────────────────────────────┘
```

### Screen 9.2 · Accept Confirmation
```
┌─────────────────────────────────┐
│  Confirm Appointment             │
│                                  │
│  💡 We recommend contacting the  │
│  family first to coordinate      │
│  the details before confirming.  │
│                                  │
│  Block this time in my schedule? │
│  ☑ Yes, update my availability   │
│                                  │
│  [Confirm appointment]           │
│  [Go back]                       │
└─────────────────────────────────┘
```
* For recurring: "This will accept the entire recurring series. Your weekly schedule will be updated. We recommend verifying your ongoing availability."
* On confirm → appointment moves to Confirmed for both parties
* Family receives notification (email + push)

### Screen 9.3 · Post-Confirmation
```
┌─────────────────────────────────┐
│  ✅ Appointment Confirmed!       │
│                                  │
│  Schwartz Family                 │
│  Mar 28, 18h–22h                 │
│                                  │
│  Add to calendar:                │
│  [📅 Download .ics]              │
│                                  │
│  [Back to dashboard]             │
└─────────────────────────────────┘
```

### Screen 9.4 · Decline
```
┌─────────────────────────────────┐
│  Decline this request?           │
│                                  │
│  The family will be notified     │
│  that you declined.              │
│                                  │
│  [Confirm decline]  [Go back]   │
└─────────────────────────────────┘
```
* Moves to Rejected for both parties
* Family notified via email + push

---

## Flow 10 — Closing the Search Loop

### Screen 10.1 · Family receives confirmation notification
```
┌─────────────────────────────────┐
│  🔔 Marie D. confirmed!         │
│                                  │
│  Your appointment on Mar 28     │
│  18h–22h is confirmed.           │
│                                  │
│  You sent 2 other requests in    │
│  this search. Would you like to  │
│  cancel them?                    │
│                                  │
│  [Cancel other requests]         │
│  [Keep them open]                │
└─────────────────────────────────┘
```
* "Cancel other requests" → all other requests in this search get status "cancelled" with message "the request has been cancelled"
* Affected babysitters are notified

---

## Flow 11 — Appointment Cancellation

### Screen 11.1a · Family Cancels (one-time)
```
┌─────────────────────────────────┐
│  Cancel appointment?             │
│                                  │
│  Marie D. — Mar 28, 18h–22h     │
│                                  │
│  The babysitter will be notified │
│  and their schedule unblocked.   │
│                                  │
│  [Confirm cancellation]          │
│  [Go back]                       │
└─────────────────────────────────┘
```

### Screen 11.1b · Family Cancels (recurring)
```
┌─────────────────────────────────┐
│  Cancel recurring appointment?   │
│                                  │
│  Marie D. — Mon & Wed weekly     │
│                                  │
│  ⚠️ This will cancel the ENTIRE  │
│  recurring series.               │
│                                  │
│  The babysitter will be notified │
│  and their schedule unblocked.   │
│  We'll suggest they recheck      │
│  their availability.             │
│                                  │
│  [Cancel entire series]          │
│  [Go back]                       │
└─────────────────────────────────┘
```

### Screen 11.2 · Babysitter Cancels
```
(Same structure as 11.1a/11.1b but from babysitter perspective)
* All parents in the family are notified
```

---

## Flow 12 — Family Submits Reference for Babysitter

### Screen 12.1 · Trigger (from past appointment in family portal)
```
┌─────────────────────────────────┐
│  Past Appointments               │
│                                  │
│  Marie D. — Mar 20, 18h–21h     │
│  ✅ Completed                     │
│                                  │
│  [Be a reference for Marie]     │
└─────────────────────────────────┘
```

### Screen 12.2 · Reference Submission
```
┌─────────────────────────────────┐
│  Reference for Marie D.         │
│                                  │
│  By submitting this reference,   │
│  your name and contact details   │
│  will be shared with families    │
│  who view Marie's profile        │
│  (only if Marie approves it).    │
│                                  │
│  Your reference:                 │
│  (__________________________)   │
│  (__________________________)   │
│                                  │
│  [Submit reference]  [Cancel]   │
└─────────────────────────────────┘
```
* Reference appears in babysitter's portal as "Pending approval"
* Babysitter must approve before it becomes visible
* Shown with "Family submitted" badge (vs "Manually added")

---

## Flow 13 — Babysitter Annual Revalidation

### Screen 13.1 · Revalidation Prompt (after Aug 1 login)
```
┌─────────────────────────────────┐
│  Annual Revalidation             │
│                                  │
│  To continue using EJM           │
│  Babysitting, please confirm:    │
│                                  │
│  ☐ I am still a student at EJM  │
│  ☐ I want to continue being      │
│    listed on this service         │
│                                  │
│  [Confirm]                       │
│                                  │
│  If you no longer wish to be     │
│  listed, you can [delete your    │
│  account] instead.               │
└─────────────────────────────────┘
```
* Triggered: Aug 1 each year, all babysitter accounts → "invalid" state
* Notification sent via email + push
* Until confirmed: babysitter hidden from search results
* Existing active requests remain unchanged

---

## Flow 14 — Account Removal

### Screen 14.1 · Babysitter Self-Removal
```
┌─────────────────────────────────┐
│  Delete Account                  │
│                                  │
│  ⚠️ This will:                   │
│  • Remove all your personal data │
│  • Cancel all active requests    │
│  • Notify affected families      │
│  • You can re-enroll later with  │
│    a new account                  │
│                                  │
│  Type "DELETE" to confirm:       │
│  (__________)                    │
│                                  │
│  [Delete my account]  [Cancel]  │
└─────────────────────────────────┘
```

### Screen 14.2 · Parent Leaves Family
```
┌─────────────────────────────────┐
│  Leave Family                    │
│                                  │
│  You will be removed from the    │
│  Schwartz family. Other parents  │
│  will still have access.         │
│                                  │
│  [Leave family]    [Cancel]     │
└─────────────────────────────────┘
```

### Screen 14.3 · Last Parent Leaves (= Family Deletion)
```
┌─────────────────────────────────┐
│  ⚠️ You are the last parent      │
│                                  │
│  Leaving will DELETE the entire  │
│  Schwartz family account:        │
│  • All family data removed       │
│  • All active requests cancelled │
│  • Affected babysitters notified │
│                                  │
│  [Delete family & leave]         │
│  [Cancel]                        │
└─────────────────────────────────┘
```

---

## Flow 15 — Admin Portal

### Screen 15.1 · Admin Dashboard
```
┌──────────────────────────────────────┐
│  Admin Portal                [Logout]│
│                                       │
│  ┌──────────┐ ┌──────────┐ ┌───────┐│
│  │ Babysit. ││ Families ││ Appts ││
│  │   142    ││   89     ││  203  ││
│  └──────────┘ └──────────┘ └───────┘│
│                                       │
│  [Manage Users]                       │
│  [Manage Appointments]                │
│  [School Holiday Calendar]            │
│  [Audit Log]                          │
│  [GDPR Data Export]                   │
└──────────────────────────────────────┘
```

### Screen 15.2 · User Management
```
┌──────────────────────────────────────┐
│  Users              🔍 (search…)     │
│  Filter: [All ▾] [Babysitters ▾]    │
│          [Active ▾] [Blocked ▾]      │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ Marie Duval    │ Babysitter     │ │
│  │ marie28@ejm    │ Active         │ │
│  │ [Block] [Delete] [Reset PW]    │ │
│  │ [Export data]                   │ │
│  ├─────────────────────────────────┤ │
│  │ Yoav Schwartz  │ Parent         │ │
│  │ yoav@gmail     │ Active         │ │
│  │ [Block] [Delete] [Reset PW]    │ │
│  │ [Export data]                   │ │
│  └─────────────────────────────────┘ │
└──────────────────────────────────────┘
```
* All admin actions are logged with timestamp, admin ID, and action description

### Screen 15.3 · School Holiday Calendar
```
┌──────────────────────────────────────┐
│  School Holiday Calendar (Zone C)    │
│  2026–2027                           │
│                                       │
│  ┌────────────────────────────────┐  │
│  │ Toussaint  │ Oct 17 – Nov 1   │  │
│  │ Noël       │ Dec 19 – Jan 3   │  │
│  │ Hiver      │ Feb 13 – Mar 1   │  │
│  │ Printemps  │ Apr 10 – Apr 26  │  │
│  │ Été        │ Jul 4 – Sep 1    │  │
│  └────────────────────────────────┘  │
│                                       │
│  [Edit dates]  [+ Add holiday]       │
│                                       │
│  Day-before-holiday dates are         │
│  auto-calculated from these ranges.   │
└──────────────────────────────────────┘
```

---

## Flow 16 — Notification Preferences

### Screen 16.1 · Settings (both user types)
```
┌─────────────────────────────────┐
│  Notification Preferences        │
│                                  │
│  New request / appointment:      │
│  ☑ Push notification             │
│  ☑ Email                         │
│                                  │
│  Appointment confirmed:          │
│  ☑ Push notification             │
│  ☑ Email                         │
│                                  │
│  Appointment cancelled:          │
│  ☑ Push notification             │
│  ☑ Email                         │
│                                  │
│  Reminders:                      │
│  ☑ Push notification             │
│  ☐ Email                         │
│                                  │
│  Language: (English ▾)           │
│                                  │
│  [Save preferences]              │
└─────────────────────────────────┘
```

---

## Flow 17 — Login / Password Recovery

### Screen 17.1 · Login
```
┌─────────────────────────────────┐
│  Log In                          │
│                                  │
│  Email     (________________)   │
│  Password  (****************)   │
│                                  │
│  [Log in]                        │
│                                  │
│  [Forgot password?]              │
│  Don't have an account?          │
│  [Sign up]                       │
└─────────────────────────────────┘
```

### Screen 17.2 · Forgot Password
```
┌─────────────────────────────────┐
│  Reset Password                  │
│                                  │
│  Enter your email address:       │
│  (________________________)     │
│                                  │
│  [Send reset link]               │
│                                  │
│  ℹ️ Check your inbox for a link  │
│    to reset your password.       │
└─────────────────────────────────┘
```
* Uses Firebase Auth built-in password reset flow

---

## Summary of All Flows

| #  | Flow                              | Screens | Primary Actor   |
|----|-----------------------------------|---------|-----------------|
| 1  | Babysitter Enrollment             | 6       | Babysitter      |
| 2  | Babysitter Portal (Dashboard)     | 1       | Babysitter      |
| 3  | Babysitter Schedule Management    | 2       | Babysitter      |
| 4  | Babysitter References             | 2       | Babysitter      |
| 5  | Parent + Family Enrollment        | 5       | Parent          |
| 6  | Parent Invite (Join Family)       | 2       | Parent          |
| 7  | Family Portal (Dashboard)         | 1       | Parent          |
| 8  | Family Search for Babysitter      | 5       | Parent          |
| 9  | Babysitter Responds to Request    | 4       | Babysitter      |
| 10 | Closing the Search Loop           | 1       | Parent (system) |
| 11 | Appointment Cancellation          | 3       | Both            |
| 12 | Family Submits Reference          | 2       | Parent          |
| 13 | Annual Revalidation               | 1       | Babysitter      |
| 14 | Account Removal                   | 3       | Both            |
| 15 | Admin Portal                      | 3       | Admin           |
| 16 | Notification Preferences          | 1       | Both            |
| 17 | Login / Password Recovery         | 2       | Both            |
| **Total** |                          | **44**  |                 |
