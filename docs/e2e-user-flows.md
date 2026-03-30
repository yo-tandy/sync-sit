# EJM Babysitting Coordinator — End-to-End User Flows

> These flows trace complete user journeys from start to finish,
> showing how screens, notifications, and system actions connect across actors.
> Each step notes WHO does WHAT and WHERE (which screen/channel).

---

## E2E Flow A — First-Time Setup (Both Sides)

> A babysitter enrolls. A family enrolls. The system is ready for matching.

```
Timeline
═══════════════════════════════════════════════════════════════════

BABYSITTER (Marie, 17, EJM student)         PARENT (Yoav)
──────────────────────────────         ──────────────────

1. Opens app → Welcome screen
2. Taps "Babysitter"
3. Enters marie.duval28@ejm.org
   * System validates @ejm.org + year 28
   * System sends 6-digit code via Resend
4. Enters code → verified
5. Creates password
   * Firebase Auth account created
6. Fills personal info:
   name, DoB, class, photo, languages
7. Fills preferences:
   ages 3–12, max 3 kids, €15/hr,
   areas: 1er–6e arrondissement,
   phone + personal email
8. Taps "Complete enrollment"
   * Account active
   * Redirected to empty dashboard
9. Sets weekly schedule:
   Mon–Fri 17h–21h,
   Wed 14h–21h,
   Sat 9h–18h
   Holiday: same as regular
10. Adds a manual reference:
    "Jean Dupont, EJM family,
     2 kids ages 5 & 8"
                                        1. Opens app → Welcome screen
                                        2. Taps "Parent"
                                        3. Enters yoav@gmail.com
                                           * System sends verification code
                                        4. Enters code → verified
                                        5. Creates password
                                           * Firebase Auth account created
                                        6. Fills family info:
                                           Family name: "Schwartz"
                                           Address: 12 Rue de Rivoli, 75004
                                           Kids: Noah (4), Emma (7)
                                           Languages: FR, EN
                                           Pets: cat
                                        7. Sets search defaults:
                                           Min age: 16, any gender,
                                           prefer references, max €18/hr
                                        8. Taps "Complete enrollment"
                                           * Family + parent account created
                                           * Redirected to empty dashboard

RESULT: Both accounts exist. Marie is searchable. Yoav can search.
```

---

## E2E Flow B — The Core Loop: Search → Request → Confirm → Done

> The most common flow in the app. A family finds a babysitter,
> requests them, the babysitter accepts, and the loop closes.

```
Timeline
═══════════════════════════════════════════════════════════════════

PARENT (Yoav)                    SYSTEM                     BABYSITTER (Marie)
─────────────                    ──────                     ──────────────────

1. Taps "Find a Babysitter"
2. Selects "One-time"
3. Fills search form:
   Date: Apr 5, 18h–22h
   Kids: Noah (4), Emma (7)
   Address: (pre-filled)
   Rate: €16/hr
   Filters: min age 16,
   prefer references
   Additional: "Dinner at 19h,
   bedtime 20h30"
4. Taps [Search]
                                 5. System runs matching:
                                    - Date: Apr 5 is a Saturday
                                    - Marie's schedule: Sat 9h–18h
                                      ❌ Doesn't cover 18h–22h
                                    - Lucas: Sat available 16h–23h ✅
                                    - Emma B: Sat available 17h–22h ✅
                                    - Checks area overlap ✅
                                    - Checks kid age range ✅
                                    - Checks rate ≤ €16/hr ✅
                                    - Checks no date override blocking ✅
                                    - Returns: Lucas, Emma B
                                    (Marie excluded — schedule mismatch)

6. Sees 2 result cards:
   Lucas R. (16, 1.8km, 1 ref)
   Emma B. (17, 0.9km, 2 refs)
   Sorted by proximity.

7. Taps [Contact Emma B.]
8. Sees contact confirmation:
   "We'll notify Emma."
   Adds message: "Dinner at 19h,
   bedtime 20h30 please"
   Rate offered: €15/hr
9. Taps [Send request]
                                 10. System creates appointment
                                     request (status: pending)
                                 11. Sends email to Emma's EJM
                                     address via Resend
                                 12. Sends FCM push notification
                                     to Emma's devices

13. Sees Emma's contact info
    (if she provided any)
14. Request appears in
    "Pending Requests" under
    "Search: Apr 5, 18h–22h"

15. Also taps [Contact Lucas]
    → Same flow, sends request
    → Lucas also notified

16. Dashboard now shows:
    Pending Requests:
     Search: Apr 5, 18h–22h
      → Emma B. — waiting
      → Lucas R. — waiting
                                                             17. Emma gets push: "New
                                                                 babysitting request!"
                                                             18. Opens app → sees request
                                                                 in "New Requests (1)"
                                                             19. Taps to view details:
                                                                 Schwartz family, Apr 5
                                                                 18h–22h, 2 kids (4,7),
                                                                 cat, dinner at 19h,
                                                                 €15/hr offered,
                                                                 contact: yoav@gmail.com
                                                                 + phone

                                                             20. Taps [Accept]
                                                             21. Sees confirmation screen:
                                                                 "Contact family first to
                                                                  coordinate details."
                                                                 ☑ Block schedule for
                                                                   Apr 5 18h–22h
                                                             22. Taps [Confirm appointment]

                                 23. System updates appointment
                                     status → confirmed
                                 24. System adds date override
                                     to Emma's schedule:
                                     Apr 5, 18h–22h = blocked
                                 25. Sends email + push to Yoav:
                                     "Emma B. confirmed!"

                                                             26. Emma sees post-confirmation:
                                                                 "✅ Confirmed!"
                                                                 [Download .ics]
                                                             27. Downloads .ics, adds to
                                                                 her calendar

28. Yoav gets push notification
29. Opens app → sees:
    "Emma B. confirmed your
     appointment for Apr 5!"
    "You have 1 other pending
     request in this search.
     Cancel it?"
30. Taps [Cancel other requests]

                                 31. System cancels Lucas request
                                     (status → cancelled,
                                      reason: "cancelled by family")
                                 32. Sends email + push to Lucas:
                                     "Request cancelled"

                                                             Lucas sees the request move
                                                             to "Rejected" with note
                                                             "Request was cancelled"

33. Yoav's dashboard now shows:
    Confirmed:
     Emma B. │ Apr 5, 18h–22h

RESULT: Appointment confirmed. Both calendars updated. Other requests cleaned up.
```

---

## E2E Flow C — Recurring Babysitting Arrangement

> A family needs ongoing weekly babysitting. Babysitter accepts the series.

```
Timeline
═══════════════════════════════════════════════════════════════════

PARENT (Yoav)                    SYSTEM                     BABYSITTER (Marie)
─────────────                    ──────                     ──────────────────

1. Taps "Find a Babysitter"
2. Selects "Recurring"
3. Fills form:
   Mon 17h–19h30
   Wed 14h–18h
   School weeks only
   Kid: Noah (4)
   Rate: €14/hr
   Note: "Pick up from school,
   help with activities"

4. Taps [Search]
                                 5. System matches against
                                    WEEKLY schedules:
                                    - Mon 17h–19h30: who's free?
                                    - Wed 14h–18h: who's free?
                                    - Must match BOTH days
                                    - Rate ≤ €14/hr
                                    - Area overlap with family
                                    - Returns: Marie (matches both)

6. Sees 1 result: Marie D.
7. Taps [Contact Marie]
   Message: "Looking for regular
   help with Noah after school"
   Rate: €14/hr
8. Taps [Send request]
                                 9. Creates recurring request
                                 10. Notifies Marie (email + push)

                                                             11. Marie sees request:
                                                                 "Recurring: Mon 17h–19h30
                                                                  + Wed 14h–18h
                                                                  School weeks only"
                                                                 Schwartz family details...

                                                             12. Calls Yoav to coordinate
                                                                 (using contact info shown)

                                                             13. Taps [Accept]
                                                             14. Sees recurring warning:
                                                                 "This accepts the entire
                                                                  series. Your weekly
                                                                  availability will be
                                                                  updated for Mon 17h–19h30
                                                                  and Wed 14h–18h.
                                                                  Verify your ongoing
                                                                  availability."
                                                                 ☑ Update my weekly schedule
                                                             15. Taps [Confirm appointment]

                                 16. Appointment confirmed
                                 17. Marie's WEEKLY schedule
                                     updated: Mon 17h–19h30
                                     and Wed 14h–18h now
                                     marked as booked
                                 18. During school holidays,
                                     these slots are auto-freed
                                     (school weeks only)
                                 19. Notifies Yoav

20. Yoav sees confirmation
    Recurring shows in
    "Confirmed" section with
    ongoing schedule display

RESULT: Ongoing arrangement. Marie's weekly availability reflects the commitment.
        New searches from other families won't see Marie for those slots.
```

---

## E2E Flow D — Babysitter Declines + Family Tries Again

> What happens when things don't work out on the first try.

```
Timeline
═══════════════════════════════════════════════════════════════════

PARENT (Yoav)                    SYSTEM                     BABYSITTER (Lucas)
─────────────                    ──────                     ──────────────────

1–9. (Same as Flow B: Yoav
     searches, finds Lucas and
     Emma, contacts both)
                                                             10. Lucas sees request
                                                             11. He has a family dinner
                                                                 that evening — not in
                                                                 his schedule overrides
                                                             12. Taps [Decline]
                                                             13. Confirms decline

                                 14. Request status → rejected
                                     (reason: declined by
                                      babysitter)
                                 15. Notifies Yoav (email + push)

16. Yoav sees: "Lucas R.
    declined your request"
    Request moves to
    "Rejected" section

17. Emma hasn't responded yet.
    Yoav waits...

    ─── 2 days pass, no response from Emma ───

18. Yoav goes back to original
    search results (still saved)
19. Sees a 3rd option he hadn't
    contacted: Paul M.
20. Taps [Contact Paul]
    → Request sent
                                 21. Notifies Paul
                                                             PAUL:
                                                             22. Sees and accepts request
                                 23. Confirms appointment
                                 24. Notifies Yoav

25. Yoav sees Paul confirmed
26. System asks: "Cancel other
    pending requests?"
    (Emma is still pending)
27. Taps [Cancel other requests]
                                 28. Cancels Emma's request
                                 29. Notifies Emma

RESULT: Family found a babysitter on the second try.
        Rejected and cancelled requests are visible for 1 week then fade.
```

---

## E2E Flow E — Cancellation (Both Directions)

### E5a: Family cancels a one-time appointment

```
PARENT (Yoav)                    SYSTEM                     BABYSITTER (Emma)
─────────────                    ──────                     ──────────────────

1. Plans changed — Noah is sick
2. Opens confirmed appointment:
   Emma B. — Apr 5, 18h–22h
3. Taps [Cancel appointment]
4. Sees warning:
   "Emma will be notified and
    her schedule unblocked."
5. Taps [Confirm cancellation]
                                 6. Appointment → rejected
                                    (reason: cancelled by family)
                                 7. Removes Emma's schedule
                                    override for Apr 5 18h–22h
                                 8. Notifies Emma (email + push)

                                                             9. Emma sees notification:
                                                                "Schwartz family cancelled
                                                                 the Apr 5 appointment"
                                                             10. Apr 5 18h–22h is free
                                                                 again in her schedule

RESULT: Appointment cancelled. Babysitter's availability restored.
```

### E5b: Babysitter cancels a recurring series

```
BABYSITTER (Marie)               SYSTEM                     PARENT (Yoav)
──────────────────               ──────                     ─────────────

1. Marie is overwhelmed with
   schoolwork, can't continue
2. Opens confirmed recurring:
   Schwartz — Mon+Wed weekly
3. Taps [Cancel appointment]
4. Sees recurring warning:
   "⚠️ This cancels the ENTIRE
    series (Mon+Wed weekly).
    All parents in the Schwartz
    family will be notified."
5. Taps [Cancel entire series]
                                 6. Appointment → rejected
                                    (reason: cancelled by
                                     babysitter)
                                 7. Restores Marie's weekly
                                    schedule: Mon 17h–19h30
                                    and Wed 14h–18h → free
                                 8. System suggests to Marie:
                                    "Review your availability
                                     schedule"
                                 9. Notifies ALL parents in
                                    Schwartz family

                                                             10. Yoav AND partner both
                                                                 get notification:
                                                                 "Marie cancelled the
                                                                  recurring arrangement"
                                                             11. Appointment moves to
                                                                 "Rejected" section
                                                             12. Family can now search
                                                                 for a replacement

RESULT: Recurring arrangement ended. Marie's full availability restored.
        Family needs to initiate a new search.
```

---

## E2E Flow F — Second Parent Joins & Manages Appointments

> Showing the multi-parent family experience.

```
Timeline
═══════════════════════════════════════════════════════════════════

PARENT 1 (Yoav)                  SYSTEM                     PARENT 2 (Tanya)
────────────────                 ──────                     ────────────────

1. Opens Family Settings
2. Taps [+ Add a parent]
3. Copies invite link
   (valid 1 hour)
4. Sends link to Tanya
   via WhatsApp/SMS
                                                             5. Tanya opens link
                                                             6. Sees: "Join the
                                                                Schwartz Family"
                                                             7. Enters email, password,
                                                                full name
                                                             8. Email verification
                                                             9. Taps [Join family]

                                 10. Tanya added to family
                                 11. Tanya sees FULL family
                                     dashboard — same view
                                     as Yoav, including all
                                     pending + confirmed
                                     appointments

                                                             12. Tanya sees the confirmed
                                                                 appointment with Emma B.
                                                                 that Yoav set up
                                                             13. Tanya initiates a NEW
                                                                 search for a different
                                                                 date → finds and books
                                                                 a babysitter

14. Yoav opens app
15. Sees Tanya's new confirmed
    appointment too — full
    visibility both ways

    ─── Later: Yoav removes himself ───

16. Yoav taps [Leave family]
17. Sees: "You'll be removed.
    Tanya still has access."
18. Confirms → Yoav's parent
    account deleted
19. Tanya is now sole parent
    (no impact on appointments)

RESULT: Both parents had equal access. Removing one doesn't affect the family.
```

---

## E2E Flow G — Post-Appointment Reference Submission

> After a successful babysitting session, the family leaves a reference.

```
Timeline
═══════════════════════════════════════════════════════════════════

                                 SYSTEM
                                 ──────
                                 1. Apr 5 has passed.
                                 2. Emma's appointment with
                                    Schwartz moves to "Past"

PARENT (Yoav)                                               BABYSITTER (Emma)
─────────────                                               ──────────────────

3. Opens app, sees Past section:
   "Emma B. — Apr 5, 18h–22h"
   [Be a reference for Emma]

4. Taps the reference button
5. Sees explanation:
   "Your name and contact info
    will be shared with families
    who view Emma's profile
    (only if Emma approves)."

6. Writes reference text:
   "Emma was wonderful with our
    kids. Very responsible."
7. Taps [Submit reference]
                                 8. Reference created
                                    (status: pending approval)
                                    Type: "family submitted"
                                 9. Notifies Emma

                                                             10. Emma sees in References:
                                                                 "🔵 Yoav Schwartz
                                                                  (family submitted)
                                                                  Status: ⏳ Pending"
                                                             11. Reads the reference text
                                                             12. Taps [Approve]

                                 13. Reference now visible
                                     to all families in
                                     search results
                                     Badge: "Family submitted"
                                     (vs "Manually added")

RESULT: Emma now has a verified family reference visible in search results.
        Future families see "⭐ 1 family-submitted reference" on her card.
```

---

## E2E Flow H — Annual Revalidation Cycle

> August 1st: all babysitters must re-confirm or become invisible.

```
Timeline — August 1st
═══════════════════════════════════════════════════════════════════

                                 SYSTEM
                                 ──────
                                 1. Aug 1, scheduled job runs
                                 2. ALL babysitter accounts
                                    → status: "invalid"
                                 3. Sends email + push to
                                    every babysitter:
                                    "Please reconfirm your
                                     enrollment for the new
                                     school year"

BABYSITTER (Marie)               BABYSITTER (Lucas — inactive)
──────────────────               ────────────────────────────

4. Marie gets notification              4. Lucas gets notification
5. Opens app                            5. Lucas ignores it (graduated)
6. Sees revalidation dialog:
   "Confirm you are still a
    student at EJM and wish
    to continue."
   ☑ I am still at EJM
   ☑ I want to stay listed
7. Taps [Confirm]

   * Marie → status: active             * Lucas stays "invalid"
   * Marie visible in search            * Lucas hidden from search
   * Marie's profile, schedule,         * Lucas's data preserved
     references all preserved           * Existing requests unchanged
                                          but no new searches find him

    ─── A parent searches on Aug 15 ───

PARENT (Yoav)
─────────────
8. Searches for a babysitter
9. Results include Marie ✅
   Results do NOT include Lucas ❌
   (Lucas is still in the system
    but invisible to new searches)

RESULT: Active babysitters carry forward seamlessly.
        Inactive ones fade from search without data loss.
```

---

## E2E Flow I — Account Deletion & GDPR

### I-a: Babysitter deletes account

```
BABYSITTER (Marie)               SYSTEM                     PARENTS (affected)
──────────────────               ──────                     ──────────────────

1. Marie decides to stop
2. Opens Settings
3. Taps [Delete account]
4. Sees warning:
   "All your personal data will
    be removed. Active requests
    will be cancelled. Affected
    families will be notified.
    You can re-enroll later."
5. Types "DELETE" to confirm
6. Taps [Delete my account]
                                 7. All pending requests
                                    → cancelled
                                 8. All confirmed appointments
                                    → cancelled
                                 9. Notifies every affected
                                    family (email + push)
                                 10. Removes all PI from
                                     Marie's record
                                 11. Keeps user ID + links
                                     (for data integrity)
                                 12. Disables login
                                                             13. Each affected family
                                                                 gets: "Babysitter
                                                                 cancelled — their
                                                                 account was deleted"

RESULT: Marie's data gone. Appointment records show "deleted user."
        Marie can re-enroll with a new account using same EJM email.
```

### I-b: Last parent leaves → family deletion

```
PARENT (Yoav — sole parent)      SYSTEM                     BABYSITTERS (affected)
───────────────────────────      ──────                     ──────────────────────

1. Yoav taps [Leave family]
2. Sees: "⚠️ You are the last
   parent. This will DELETE
   the Schwartz family:
   • All family data removed
   • All requests cancelled
   • Babysitters notified"
3. Taps [Delete family & leave]
                                 4. Cancels all active requests
                                 5. Notifies affected babysitters
                                 6. Removes all family PI
                                 7. Removes Yoav's parent account
                                 8. Family entity preserved as
                                    shell (for referential
                                    integrity only)
                                                             9. Affected babysitters see:
                                                                "Appointment cancelled —
                                                                 family account deleted"
                                                             10. Schedules unblocked

RESULT: Family fully removed. Babysitters freed up.
```

---

## E2E Flow J — Admin Manages the System

```
Timeline
═══════════════════════════════════════════════════════════════════

ADMIN
─────

1. Logs into admin portal

── Scenario: Block a misbehaving user ──

2. Opens User Management
3. Searches for "Lucas R."
4. Taps [Block]
5. Confirms
   * Lucas can't log in
   * Lucas hidden from search
   * Existing appointments unchanged
   * Action logged: "Admin blocked
     lucas.renard27@ejm.org
     at 2026-04-01 14:32"

── Scenario: Update holiday calendar ──

6. Opens School Holiday Calendar
7. Pre-loaded with Zone C dates
8. Adjusts Printemps holiday:
   Apr 10 → Apr 12 (correction)
9. Saves
   * All recurring "school weeks
     only" appointments recalculate
   * Action logged

── Scenario: GDPR data export ──

10. Receives email request from
    a parent wanting their data
11. Opens GDPR Data Export
12. Searches for user
13. Taps [Export data]
14. Downloads JSON file containing:
    - Profile information
    - Family details
    - All appointment history
    - All system emails sent
    - Account activity log
15. Sends file to requester
    * Action logged

RESULT: Admin maintains system integrity with full audit trail.
```

---

## Flow Summary

| Flow | Name | Actors | Key Outcome |
|------|------|--------|-------------|
| **A** | First-Time Setup | Babysitter + Parent (independent) | Both accounts ready |
| **B** | Core Loop: Search → Confirm | Parent → Babysitter → Parent | Appointment confirmed, others cleaned up |
| **C** | Recurring Arrangement | Parent → Babysitter | Ongoing weekly schedule locked |
| **D** | Decline + Retry | Parent → Babysitter₁ (no) → Babysitter₂ (yes) | Resilience when first choice fails |
| **E** | Cancellation (both sides) | Parent OR Babysitter | Clean cancellation, schedules restored |
| **F** | Multi-Parent Family | Parent₁ → Parent₂ | Shared access, independent management |
| **G** | Post-Appointment Reference | Parent → Babysitter (approves) | Verified reference in search results |
| **H** | Annual Revalidation | System → all Babysitters | Active users carry forward, inactive hidden |
| **I** | Account Deletion / GDPR | Any user + Admin | Clean removal with notifications |
| **J** | Admin Operations | Admin | Block users, manage holidays, export data |

---

## Edge Cases Embedded in These Flows

- **Search returns no results** (Flow B step 5 — if no one matches, show "No babysitters found")
- **Babysitter has multiple overlapping requests** (Flow B/D — accepting one does NOT auto-cancel others)
- **Family contacts multiple babysitters in same search** (Flow B steps 7+15 — all tracked under one search)
- **Recurring request during holidays** (Flow C step 18 — auto-freed if "school weeks only")
- **Expired invite link** (Flow F — after 1 hour, link shows "This invite has expired")
- **Re-enrollment after deletion** (Flow I-a — same EJM email can create new account)
- **Family-submitted vs manual references** (Flow G — different badges in search results)
