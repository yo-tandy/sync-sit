# EJM Babysitting Coordinator — Test Plan

> Comprehensive testing document organized by feature area.
> Each test case includes preconditions, steps, and expected results.
> Priority: P0 = must pass before any release, P1 = must pass before launch, P2 = should pass.

---

## 0. Global Navigation & Info Pages

| ID | Test Case | Priority | Preconditions | Steps | Expected Result |
|----|-----------|----------|---------------|-------|-----------------|
| NAV-001 | Menu accessible before login | P0 | Not logged in, on welcome screen | Tap ☰ menu | Shows: About, Report a Problem, Privacy Policy, Terms & Conditions |
| NAV-002 | Menu accessible after login (babysitter) | P0 | Logged in as babysitter | Tap ☰ menu | Shows: About, Report a Problem, Privacy Policy, T&C, My Portal, Settings, Log out |
| NAV-003 | Menu accessible after login (parent) | P0 | Logged in as parent | Tap ☰ menu | Same as NAV-002 but portal goes to family dashboard |
| NAV-004 | About page loads | P1 | Any state | Tap About | About page shown with app info and version |
| NAV-005 | Report a Problem — logged in | P0 | Logged in as user usr_abc123 | Tap Report a Problem → Send email | Opens mailto: with pre-filled user ID, timestamp, app version, platform |
| NAV-006 | Report a Problem — not logged in | P0 | Not logged in | Tap Report a Problem → Send email | Opens mailto: with "Not logged in" as user ID, timestamp, version, platform |
| NAV-007 | Report a Problem — includes local errors | P1 | Client-side error occurred recently | Tap Report a Problem → Send email | Email body includes recent error details |
| NAV-008 | Report a Problem — no local errors | P1 | No recent errors | Tap Report a Problem → Send email | Email body shows errors section as empty/omitted |
| NAV-009 | Privacy Policy page loads (EN) | P0 | Language set to EN | Tap Privacy Policy | English version shown |
| NAV-010 | Privacy Policy page loads (FR) | P0 | Language set to FR | Tap Privacy Policy | French version shown |
| NAV-011 | Terms & Conditions page loads (EN) | P0 | Language set to EN | Tap Terms & Conditions | English version shown |
| NAV-012 | Terms & Conditions page loads (FR) | P0 | Language set to FR | Tap Terms & Conditions | French version shown |
| NAV-013 | Menu available on all screens | P1 | Logged in, on any screen | Check for ☰ icon | Menu icon present and functional |
| NAV-014 | Info pages available during enrollment | P1 | Mid-enrollment (step 2 of 3) | Tap ☰ → Privacy Policy | Page loads; can return to enrollment without losing progress |

---

## 1. Authentication & Enrollment

### 1.1 Babysitter Enrollment

| ID | Test Case | Priority | Preconditions | Steps | Expected Result |
|----|-----------|----------|---------------|-------|-----------------|
| AUTH-001 | Valid EJM email accepted | P0 | None | Enter `name28@ejm.org` | Verification code sent |
| AUTH-002 | Non-EJM domain rejected | P0 | None | Enter `name@gmail.com` | Error: "Please use your EJM email" |
| AUTH-003 | Expired graduation year rejected | P0 | Current valid years: 26-29 | Enter `name25@ejm.org` | Error: "This email doesn't appear to be a current EJM student" |
| AUTH-004 | Future graduation year beyond range rejected | P0 | Current valid years: 26-29 | Enter `name30@ejm.org` | Error: rejected |
| AUTH-005 | Graduation year rollover | P1 | System date is Sep 1 | Enter `name26@ejm.org` | Error: 26 is no longer valid (range now 27-30) |
| AUTH-006 | Verification code — correct | P0 | Code sent | Enter correct 6-digit code | Proceeds to password screen |
| AUTH-007 | Verification code — incorrect | P0 | Code sent | Enter wrong code | Error: "Invalid code" |
| AUTH-008 | Verification code — resend cooldown | P1 | Code just sent | Tap "Resend" immediately | Button disabled for 60 seconds |
| AUTH-009 | Password creation — valid | P0 | Code verified | Enter matching passwords meeting requirements | Account created |
| AUTH-010 | Password creation — mismatch | P0 | Code verified | Enter non-matching passwords | Error: "Passwords don't match" |
| AUTH-011 | DoB validation — under 15 | P0 | On personal info screen | Enter DoB making user 14 | Error: "Must be at least 15 years old" |
| AUTH-012 | DoB validation — exactly 15 | P1 | On personal info screen | Enter DoB making user exactly 15 today | Accepted |
| AUTH-013 | Photo upload — valid | P1 | On personal info screen | Upload 3MB JPG | Photo saved, thumbnail shown |
| AUTH-014 | Photo upload — too large | P1 | On personal info screen | Upload 10MB image | Error: "Photo must be under 5MB" |
| AUTH-015 | Contact info — at least one required | P0 | On preferences screen | Leave both email and phone blank | Error: "Provide at least one contact method" |
| AUTH-016 | Area — arrondissement selection | P1 | On preferences screen | Select 3 arrondissements | Saved correctly |
| AUTH-017 | Area — distance from address | P1 | On preferences screen | Enter address + 3km radius | Address geocoded, radius saved |
| AUTH-018 | Duplicate EJM email | P0 | Account exists for `name28@ejm.org` | Try to enroll with same email | Error: "Account already exists" |
| AUTH-019 | Complete enrollment — all required fields | P0 | All steps completed | Submit final step | Account created, redirected to dashboard |

### 1.2 Parent + Family Enrollment

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| AUTH-020 | Any email domain accepted | P0 | Enter `parent@gmail.com` | Verification code sent |
| AUTH-021 | Family created with correct data | P0 | Complete all enrollment steps | Family + parent account created |
| AUTH-022 | At least one kid required | P0 | Try to proceed with 0 kids | Error: "Add at least one child" |
| AUTH-023 | Address geocoded | P1 | Enter valid Paris address | Address autocompleted, lat/lng stored |
| AUTH-024 | Search defaults optional | P1 | Skip search defaults step | Enrollment completes, defaults blank |
| AUTH-025 | Family name defaults to editable | P1 | Check "Your full name" field | Pre-filled with family name, editable |

### 1.3 Parent Invite

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| AUTH-026 | Generate invite link | P0 | Tap "+ Add a parent" | Link generated, shown with copy button |
| AUTH-027 | Invite link expires after 1 hour | P0 | Wait 61 minutes, open link | Error: "This invite has expired" |
| AUTH-028 | Valid invite — join family | P0 | Open valid link, complete signup | New parent added to family |
| AUTH-029 | Invite link — single use | P1 | Use link once, try again | Error: "This invite has already been used" |
| AUTH-030 | Invited parent sees full dashboard | P0 | Join family | See all existing appointments and requests |

### 1.4 Login & Password

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| AUTH-031 | Login — valid credentials | P0 | Enter correct email + password | Logged in, redirected to portal |
| AUTH-032 | Login — wrong password | P0 | Enter wrong password | Error: "Invalid credentials" |
| AUTH-033 | Login — blocked account | P0 | Admin has blocked account | Error: "Account suspended" |
| AUTH-034 | Forgot password flow | P0 | Tap "Forgot password", enter email | Reset email sent via Firebase |
| AUTH-035 | Session persists (long-lived) | P1 | Log in, close app, reopen after 1 day | Still logged in |
| AUTH-036 | Language auto-detection | P1 | Browser set to French | App defaults to French |
| AUTH-037 | Language override | P1 | Set language to English in settings | All UI in English |

---

## 2. Search & Matching

### 2.1 One-Time Search

| ID | Test Case | Priority | Preconditions | Steps | Expected Result |
|----|-----------|----------|---------------|-------|-----------------|
| SRCH-001 | Basic search returns matches | P0 | Babysitters exist with matching availability | Search for specific date/time | Matching babysitters shown |
| SRCH-002 | Date/time filter works | P0 | Babysitter A free Sat 10h-18h, Babysitter B free Sat 16h-23h | Search Sat 19h-22h | Only B shown |
| SRCH-003 | Area filter — arrondissement | P0 | Babysitter covers 1er-6e, family in 4e | Search | Babysitter shown |
| SRCH-004 | Area filter — distance | P0 | Babysitter: 3km from address X, family 5km from X | Search | Babysitter NOT shown (outside radius) |
| SRCH-005 | Rate filter — at or below | P0 | Babysitter rate €15/hr, family max €16/hr | Search | Babysitter shown |
| SRCH-006 | Rate filter — above | P0 | Babysitter rate €20/hr, family max €16/hr | Search | Babysitter NOT shown |
| SRCH-007 | Age range filter | P1 | Kids aged 4 & 7, babysitter accepts 3-12 | Search | Match ✅ |
| SRCH-008 | Age range filter — mismatch | P1 | Kid aged 2, babysitter accepts 5-12 | Search | No match ❌ |
| SRCH-009 | Max kids filter | P1 | Family has 3 kids, babysitter max 2 | Search | No match ❌ |
| SRCH-010 | Gender preference filter | P2 | Preference: female, babysitter: male | Search | Not shown |
| SRCH-011 | Reference required filter | P1 | Filter: must have reference, babysitter has 0 | Search | Not shown |
| SRCH-012 | Min age filter | P1 | Pref: min 17, babysitter is 16 | Search | Not shown |
| SRCH-013 | Zero results | P0 | No babysitters match | Search | "No babysitters found" message |
| SRCH-014 | Schedule override blocks date | P1 | Babysitter normally free Mon, but has override "unavailable" for specific Monday | Search that Monday | Babysitter NOT shown |
| SRCH-015 | Sort by proximity | P1 | Multiple results | Sort by proximity | Closest first |
| SRCH-016 | Sort by age | P1 | Multiple results | Sort by age | Youngest/oldest first |
| SRCH-017 | Search defaults pre-fill | P1 | Family has saved defaults | Open search form | Fields pre-populated |
| SRCH-018 | Defaults editable per search | P1 | Family has saved defaults | Change a filter for this search | New value used, defaults unchanged |
| SRCH-019 | Invalidated babysitter not shown | P0 | Babysitter hasn't revalidated (Aug 1 passed) | Search | Babysitter NOT in results |
| SRCH-020 | Blocked babysitter not shown | P0 | Admin blocked babysitter | Search | Babysitter NOT in results |

### 2.2 Recurring Search

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| SRCH-021 | Recurring — must match all selected days | P0 | Search Mon+Wed, babysitter free Mon only | Babysitter NOT shown |
| SRCH-022 | Recurring — matches all days | P0 | Search Mon+Wed, babysitter free both | Babysitter shown |
| SRCH-023 | Recurring — school weeks only vs holiday | P1 | Search "school weeks only", check if holiday weeks affect matching | Match based on school-week availability |
| SRCH-024 | Recurring — no end date | P1 | Create recurring request | No end date field, persists until cancelled |

### 2.3 Search Results & Contact

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| SRCH-025 | Card shows correct info | P0 | View result card | Shows: name, age, class, languages, kid age range, max kids, distance, reference count, about text. NO rate shown |
| SRCH-026 | Rate NOT visible on card | P0 | View card of babysitter with €15/hr rate | Rate is not displayed anywhere on card |
| SRCH-027 | Contact button triggers notification | P0 | Tap [Contact] → [Send request] | Email sent to babysitter's EJM email + FCM push |
| SRCH-028 | Contact shows babysitter's contact info | P0 | After sending request, babysitter has phone set | Phone number displayed to parent |
| SRCH-029 | Contact — babysitter has no contact info | P1 | Babysitter only has EJM email (no personal contact) | Message: "Babysitter has been notified" (no extra contact shown) |
| SRCH-030 | Rate suggestion to parent | P1 | Contact screen | Shows tip: "Include the rate you're willing to pay" |
| SRCH-031 | Multiple contacts from same search | P0 | Contact 3 babysitters from one search | All 3 appear under same search in Pending |
| SRCH-032 | Request appears in family dashboard | P0 | Send request | Visible in "Pending Requests" grouped by search |

---

## 3. Appointment Lifecycle

### 3.1 Babysitter Response

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| APPT-001 | View request details | P0 | Open new request | Shows: family info, date/time, kids, address, distance, note, rate offered, contact info |
| APPT-002 | Accept — one-time | P0 | Tap Accept → Confirm | Appointment status → confirmed, schedule blocked, family notified |
| APPT-003 | Accept — schedule blocking | P0 | Accept with "block schedule" checked | Date override created for that time slot |
| APPT-004 | Accept — recurring | P0 | Accept recurring request | Weekly schedule updated, warning shown about ongoing commitment |
| APPT-005 | Accept — .ics download | P1 | After confirming | .ics file downloads with correct event details |
| APPT-006 | Decline | P0 | Tap Decline → Confirm | Status → rejected (by babysitter), family notified |
| APPT-007 | Multiple requests same time — accept one | P1 | Has 2 requests for same time, accept one | Other request remains pending (NOT auto-cancelled) |
| APPT-008 | Contact-first recommendation | P1 | Tap Accept | "We recommend contacting the family first" message shown |

### 3.2 Closing the Loop

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| APPT-009 | Confirmation triggers cancel prompt | P0 | Babysitter confirms, family has other pending | Family sees "Cancel other requests?" |
| APPT-010 | Cancel other requests | P0 | Tap [Cancel other requests] | All other requests in search → cancelled, babysitters notified |
| APPT-011 | Keep other requests | P0 | Tap [Keep them open] | Other requests unchanged |
| APPT-012 | Single request — no prompt | P1 | Only 1 request in search, babysitter confirms | No "cancel others" prompt (nothing to cancel) |

### 3.3 Cancellation

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| APPT-013 | Family cancels one-time | P0 | Cancel confirmed one-time appointment | Status → cancelled by family, babysitter notified, schedule unblocked |
| APPT-014 | Family cancels recurring | P0 | Cancel recurring appointment | Warning: "Cancels entire series", babysitter notified, weekly schedule restored |
| APPT-015 | Babysitter cancels one-time | P0 | Cancel confirmed one-time | Status → cancelled by babysitter, ALL family parents notified, schedule unblocked |
| APPT-016 | Babysitter cancels recurring | P0 | Cancel recurring | Warning shown, all parents notified, weekly schedule restored, recheck suggestion shown |
| APPT-017 | Confirmed appointment not editable | P0 | Try to edit a confirmed appointment | No edit option available, only cancel |
| APPT-018 | Cancel all in search | P1 | Tap "Cancel all requests" on a search group | All pending requests cancelled, babysitters notified |

---

## 4. Babysitter Schedule

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| SCHED-001 | Set weekly recurring schedule | P0 | Set Mon 17h-21h available | Saved, reflected in searches |
| SCHED-002 | 15-minute granularity | P1 | Set availability starting 17:15 | Accepted and saved |
| SCHED-003 | Holiday schedule — same as regular | P1 | Select "Same as regular schedule" | Holiday weeks use regular schedule |
| SCHED-004 | Holiday schedule — different | P1 | Set different holiday schedule | Holiday weeks use alternate schedule |
| SCHED-005 | Holiday schedule — not available | P1 | Select "Not available during holidays" | Babysitter hidden in holiday-week searches |
| SCHED-006 | Date override — unavailable | P0 | Mark Apr 5 as unavailable | Apr 5 searches don't show babysitter |
| SCHED-007 | Date override — custom hours | P1 | Set Apr 5 available 14h-20h (different from regular) | Apr 5 searches use override hours |
| SCHED-008 | Delete date override | P1 | Remove an override | Reverts to regular schedule for that date |
| SCHED-009 | Recurring acceptance updates schedule | P0 | Accept recurring Mon+Wed | Weekly schedule shows those slots as booked |
| SCHED-010 | Cancellation restores schedule | P0 | Cancel a recurring appointment | Weekly schedule slots freed |

---

## 5. References

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| REF-001 | Babysitter adds manual reference | P1 | Fill reference form with name, contact, note | Reference saved, shown as "Manually added" |
| REF-002 | Manual reference — at least one contact | P1 | Leave both phone and email blank | Error |
| REF-003 | Family submits reference | P1 | Tap "Be a reference" on past appointment, write text | Reference created as pending |
| REF-004 | Reference pending until approved | P0 | Family submits reference | Not visible to other families until babysitter approves |
| REF-005 | Babysitter approves reference | P1 | Tap [Approve] on pending reference | Reference visible with "Family submitted" badge |
| REF-006 | Babysitter removes reference | P1 | Tap [Remove] on any reference | Reference deleted |
| REF-007 | Babysitter updates reference contact | P1 | Edit phone/email on a manual reference | Updated |
| REF-008 | Reference badge distinction | P1 | View references in search results | "Family submitted" vs "Manually added" clearly labeled |
| REF-009 | Reference count on search card | P1 | Babysitter has 2 refs | Card shows "⭐ 2 references" |
| REF-010 | "Be a reference" only for past confirmed | P1 | View pending/rejected appointment | Button NOT shown |

---

## 6. Portal & Dashboard

### 6.1 Babysitter Portal

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| PORT-001 | New requests shown with count | P0 | Has 2 pending requests | "New Requests (2)" section visible |
| PORT-002 | Confirmed appointments listed | P0 | Has confirmed appointments | Shown in Confirmed section |
| PORT-003 | Past appointments — 1 week visibility | P1 | Appointment was 8 days ago | Not visible in portal |
| PORT-004 | Rejected — 1 week visibility | P1 | Rejection was 8 days ago | Not visible in portal |
| PORT-005 | Edit profile — allowed fields | P0 | Edit preferences, contact, about | Changes saved |
| PORT-006 | Edit profile — locked fields | P0 | Try to edit name, DoB, gender | Fields not editable |
| PORT-007 | Notification badge | P1 | New request arrives | 🔔 badge shows count |

### 6.2 Family Portal

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| PORT-008 | Pending grouped by search | P0 | Sent 3 requests from 2 searches | Grouped under respective searches |
| PORT-009 | Confirmed appointments listed | P0 | Has confirmations | Shown in Confirmed section |
| PORT-010 | Past appointments — reference button | P0 | Appointment in past | "Be a reference" button visible |
| PORT-011 | Rejected — shows reason | P1 | Babysitter declined | Shows "Rejected by babysitter" |
| PORT-012 | Cancelled — shows reason | P1 | Family cancelled | Shows "Cancelled by family" |
| PORT-013 | All parents see everything | P0 | 2 parents in family, parent A creates request | Parent B sees it too |
| PORT-014 | Edit family data | P1 | Edit kids, address, etc. | Changes saved |
| PORT-015 | Remove another parent | P1 | Parent A removes Parent B | B's account deleted, A still has access |

---

## 7. Notifications

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| NOTIF-001 | Email sent on new request | P0 | Parent contacts babysitter | Email received at EJM address |
| NOTIF-002 | Push sent on new request | P0 | Parent contacts babysitter | FCM push received |
| NOTIF-003 | Email on confirmation | P0 | Babysitter confirms | Parent gets email |
| NOTIF-004 | Push on confirmation | P0 | Babysitter confirms | Parent gets push |
| NOTIF-005 | Email on decline | P0 | Babysitter declines | Parent gets email |
| NOTIF-006 | Email on cancellation (by family) | P0 | Family cancels | Babysitter gets email |
| NOTIF-007 | Email on cancellation (by babysitter) | P0 | Babysitter cancels | ALL parents get email |
| NOTIF-008 | Notification preferences respected | P1 | User turns off push, keeps email | Only email sent |
| NOTIF-009 | Revalidation email (Aug 1) | P0 | Aug 1 trigger | All babysitters get email |
| NOTIF-010 | Account deletion notifications | P0 | Babysitter deletes account | Affected families notified |
| NOTIF-011 | Bilingual emails | P1 | User language is French | Email in French |

---

## 8. Annual Revalidation

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| REVAL-001 | Aug 1 — all accounts invalidated | P0 | System date passes Aug 1 | All babysitters → invalid status |
| REVAL-002 | Invalid babysitter hidden from search | P0 | Babysitter hasn't revalidated | Not in search results |
| REVAL-003 | Revalidation dialog on login | P0 | Invalid babysitter logs in | Revalidation dialog shown |
| REVAL-004 | Successful revalidation | P0 | Check both boxes, confirm | Status → active, visible in search |
| REVAL-005 | Existing requests unchanged | P1 | Babysitter has pending request, hasn't revalidated | Request still exists, family can still see it |
| REVAL-006 | Notification sent to all babysitters | P0 | Aug 1 trigger | Email + push to every babysitter |

---

## 9. Account Management

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| ACCT-001 | Babysitter self-deletion | P0 | Delete account flow | PI removed, appointments cancelled, families notified, login disabled |
| ACCT-002 | Babysitter re-enrollment after deletion | P1 | Delete account, then enroll with same EJM email | New account created |
| ACCT-003 | Parent leaves family (not last) | P0 | Leave family | Parent account removed, family unchanged |
| ACCT-004 | Last parent leaves → family deleted | P0 | Sole parent leaves | Family deleted, all data removed, babysitters notified |
| ACCT-005 | Parent removes another parent | P1 | Remove other parent | That parent's account deleted |
| ACCT-006 | Family deletion warning | P0 | Last parent tries to leave | Warning about family deletion shown |

---

## 10. Admin Portal

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| ADMIN-001 | Admin login | P0 | Log in with admin credentials | Admin dashboard shown |
| ADMIN-002 | Block babysitter | P0 | Block a babysitter | Can't log in, hidden from search |
| ADMIN-003 | Block parent | P0 | Block a parent | Can't log in |
| ADMIN-004 | Delete account (admin) | P0 | Admin deletes a user | Same as self-deletion but admin-initiated |
| ADMIN-005 | Reset password | P1 | Admin resets user password | User receives reset email |
| ADMIN-006 | View appointments | P1 | Open appointment list | All appointments visible with filters |
| ADMIN-007 | Delete appointment | P1 | Admin deletes an appointment | Removed, both parties notified |
| ADMIN-008 | Edit holiday calendar | P0 | Change holiday dates | Saved, affects recurring availability |
| ADMIN-009 | Pre-loaded Zone C calendar | P1 | Initial deployment | Current year Zone C dates present |
| ADMIN-010 | Audit log | P0 | Perform any admin action | Action logged with timestamp + admin ID |
| ADMIN-011 | GDPR data export | P0 | Export user data | JSON file with all user data downloaded |
| ADMIN-012 | Admin action visibility | P1 | View audit log | All past actions visible with filters |

---

## 11. Data Retention & GDPR

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| GDPR-001 | Past appointments visible 1 week in UI | P1 | Check 8-day-old appointment | Not visible in portal |
| GDPR-002 | Soft delete after 1 month | P1 | Check database 31 days after rejection | Record soft-deleted |
| GDPR-003 | Right to be forgotten | P0 | Delete account | All PI removed from system |
| GDPR-004 | Data export contains all user data | P0 | Admin exports user data | Includes: profile, appointments, emails, logs |
| GDPR-005 | Cookie consent (if applicable) | P1 | First visit | Cookie banner shown, can decline |
| GDPR-006 | No data for commercial purposes | P2 | Audit data collection | No analytics/tracking beyond operational needs |

---

## 12. Cross-Platform & Responsive

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| PLAT-001 | Desktop web — full functionality | P0 | Use app in Chrome desktop | All features work |
| PLAT-002 | Mobile web — full functionality | P0 | Use app in mobile browser | All features work, responsive layout |
| PLAT-003 | iOS app — full functionality | P0 | Use Flutter iOS app | All features work |
| PLAT-004 | Android app — full functionality | P0 | Use Flutter Android app | All features work |
| PLAT-005 | Push notifications — iOS | P0 | Trigger notification on iOS | Push received |
| PLAT-006 | Push notifications — Android | P0 | Trigger notification on Android | Push received |
| PLAT-007 | Push notifications — browser | P1 | Trigger notification in browser | Browser push received |
| PLAT-008 | Photo upload from mobile camera | P1 | Take photo during enrollment | Photo captured and uploaded |

---

## 13. Localization (i18n)

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| I18N-001 | All UI text in English | P0 | Set language to EN | Every screen in English |
| I18N-002 | All UI text in French | P0 | Set language to FR | Every screen in French |
| I18N-003 | Emails in user's language | P1 | User language FR, trigger email | Email in French |
| I18N-004 | Date format localized | P1 | View dates in FR locale | DD/MM/YYYY format |
| I18N-005 | Language persists across sessions | P1 | Set to FR, logout, login | Still French |
| I18N-006 | Auto-detect on first visit | P1 | Browser set to French | App defaults to French |

---

## 14. Edge Cases & Error Handling

| ID | Test Case | Priority | Steps | Expected Result |
|----|-----------|----------|-------|-----------------|
| EDGE-001 | Network error during search | P1 | Lose connection mid-search | Friendly error message, retry option |
| EDGE-002 | Session expired | P1 | Token expires | Redirect to login, no data loss |
| EDGE-003 | Concurrent edits — two parents edit family | P2 | Both parents edit family info simultaneously | Last save wins, no crash |
| EDGE-004 | Babysitter deleted while request pending | P1 | Babysitter deletes account with pending request from family | Family sees request as cancelled |
| EDGE-005 | Family deleted while request pending | P1 | Last parent leaves with pending request | Babysitter sees request cancelled |
| EDGE-006 | Double-submit prevention | P1 | Tap [Send request] rapidly twice | Only 1 request created |
| EDGE-007 | Invite link opened after family deleted | P2 | Family deleted, then invite link opened | Error: "This family no longer exists" |
| EDGE-008 | Search with no babysitters in system | P2 | Zero babysitters enrolled | "No babysitters found" message |
| EDGE-009 | Babysitter accepts after family cancelled | P1 | Family cancels, babysitter taps accept at same time | Accept fails gracefully: "This request was cancelled" |
| EDGE-010 | Upload non-image file as photo | P1 | Upload .pdf as profile photo | Error: "Please upload an image file" |

---

## Test Case Summary

| Category | P0 | P1 | P2 | Total |
|----------|----|----|----|----|
| Global Nav & Info Pages | 6 | 8 | 0 | 14 |
| Auth & Enrollment | 14 | 12 | 0 | 26 |
| Search & Matching | 10 | 14 | 1 | 25 |
| Appointment Lifecycle | 10 | 5 | 0 | 15 |
| Schedule | 4 | 6 | 0 | 10 |
| References | 1 | 9 | 0 | 10 |
| Portal & Dashboard | 5 | 10 | 0 | 15 |
| Notifications | 6 | 5 | 0 | 11 |
| Revalidation | 4 | 2 | 0 | 6 |
| Account Management | 3 | 3 | 0 | 6 |
| Admin | 4 | 5 | 0 | 9 |
| GDPR & Retention | 2 | 3 | 1 | 6 |
| Cross-Platform | 5 | 3 | 0 | 8 |
| i18n | 2 | 4 | 0 | 6 |
| Edge Cases | 0 | 6 | 4 | 10 |
| **Total** | **76** | **95** | **6** | **177** |
