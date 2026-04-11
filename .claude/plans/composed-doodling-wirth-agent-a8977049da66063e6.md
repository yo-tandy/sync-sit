# Contact Info Consent System — Implementation Plan

## Overview

This plan addresses PII exposure of babysitter contact info (email, phone) to all parents in search results. The solution introduces consent-gated contact sharing across four domains: babysitter account consent, appointment-scoped sharing, favorite-triggered sharing requests, and a babysitter "My Fans" management page.

---

## Data Model Changes

### 1. BabysitterUser type — packages/shared/src/types/user.ts

Add to the BabysitterUser interface:
- `contactSharingConsent?: boolean;`
- `approvedFamilies?: string[];` — familyIds the babysitter approved for contact sharing

### 2. New Firestore collection: contactSharingRequests

Top-level collection with auto-generated doc IDs. Each document:
- requestId: string
- babysitterUserId: string
- familyId: string
- familyName: string
- parentName: string
- status: 'pending' | 'approved' | 'declined'
- createdAt: Date
- respondedAt?: Date

Rationale for top-level collection: queryable by both babysitterUserId and familyId, clean audit trail, doesn't bloat user docs, Firestore rules can scope access cleanly.

### 3. New Firestore collection: contactSharingPending

Documents written when parent adds favorite, picked up by scheduled function after 1-min delay:
- pendingId: string
- babysitterUserId: string
- familyId: string
- familyName: string
- parentName: string
- notifyAt: Date (createdAt + 1 minute)
- processed: boolean
- createdAt: Date

### 4. NotificationType update — packages/shared/src/types/notification.ts

Add `'contact_sharing_request'` to the NotificationType union.

### 5. Firestore indexes — firestore.indexes.json

Add indexes for contactSharingRequests (babysitterUserId + createdAt DESC, babysitterUserId + familyId) and contactSharingPending (processed + notifyAt).

### 6. Firestore security rules — firestore.rules

Add rules for both new collections — babysitter reads own requests, parents read requests for their family, all writes via Cloud Functions only.

---

## Phase 1: Consent Checkbox + Strip Contact from Search

Goal: Immediately stop exposing contact info in search results. Add consent gate on account page.

### apps/web/src/pages/babysitter/AccountPage.tsx
- Add `contactSharingConsent` state, initialized from babysitter doc
- Insert consent checkbox above the Contact Info section (line 371 area)
- When unchecked, disable email/phone/whatsapp fields
- Persist consent boolean to user doc on toggle (same pattern as notification prefs)
- In handleContactSave, also persist contactSharingConsent

### apps/functions/src/search/searchBabysitters.ts
- Remove contactEmail and contactPhone from the result object (lines ~160-161 where they are set)
- Contact info only available per-appointment or via approved sharing (Phase 3)

### apps/web/src/pages/family/SearchPage.tsx
- In the success dialog (lines 717-721), remove display of contactTarget.contactEmail and contactPhone
- Replace with message: "Contact info will be available on the appointment once they respond"

### apps/functions/src/family/lookupBabysitter.ts
- Already does not return contact fields — no changes needed

### apps/web/src/pages/family/PreferredBabysittersPage.tsx
- In loadInfos (lines 85-115): stop extracting contactEmail, contactPhone, whatsapp from user docs
- In renderCard (lines 246-264): remove the entire contact details block

### packages/shared/src/types/user.ts
- Add contactSharingConsent and approvedFamilies to BabysitterUser

---

## Phase 2: Favorite-Triggered Contact Sharing Request

Goal: When parent favorites a babysitter, send delayed notification asking to share contact info.

### apps/functions/src/family/addPreferredBabysitter.ts
- After arrayUnion update, read family doc for familyName and caller name
- Write contactSharingPending doc with notifyAt = now + 60 seconds

### NEW: apps/functions/src/scheduled/processContactSharingPending.ts
- Scheduled function running every 1 minute (follows sendReminders pattern using onSchedule)
- Query contactSharingPending where processed == false AND notifyAt <= now
- For each: verify babysitter still in family's preferred list, dedup against existing contactSharingRequests
- Create contactSharingRequest doc with status 'pending'
- Create notification doc, send push + email to babysitter
- Mark pending doc as processed

### NEW: apps/functions/src/family/respondToContactSharing.ts
- Callable function for babysitter to accept/decline
- Validates auth (caller must be the babysitterUserId on the request)
- Updates contactSharingRequests doc status and respondedAt
- If approved: adds familyId to babysitter's approvedFamilies array (batch write)
- If declined: removes familyId from approvedFamilies if present

### apps/functions/src/index.ts
- Export processContactSharingPending from scheduled
- Export respondToContactSharing from family

---

## Phase 3: Conditional Contact Info Based on Approval

Goal: Show contact info only to approved families in search and favorites.

### apps/functions/src/search/searchBabysitters.ts
- Read each babysitter's approvedFamilies array
- Only include contactEmail/contactPhone if callerFamilyId is in approvedFamilies

### apps/web/src/pages/family/PreferredBabysittersPage.tsx
- Read approvedFamilies from babysitter user doc in loadInfos
- Only show contact details if approvedFamilies includes current parent's familyId
- Show sharing status indicator: "Shared", "Pending", or "Not shared"

---

## Phase 4: Babysitter "My Fans" Page

Goal: New page for babysitters to see and manage which families can see their contact info.

### NEW: apps/web/src/pages/babysitter/FansPage.tsx
- TopNav with title and back to /babysitter
- Explanatory text about what this page does
- Note: "If these families contact you for babysitting, your contact info will be visible regardless"
- Firestore onSnapshot on contactSharingRequests filtered by babysitterUserId
- Each entry: family name, parent name, toggle switch (approved/declined)
- Toggle calls respondToContactSharing cloud function
- Empty state when no families have favorited

### apps/web/src/router.tsx
- Import FansPage, add route at /babysitter/fans

### apps/web/src/components/ui/AppBar.tsx
- Add menu item in babysitter section: "My Fans" linking to /babysitter/fans

---

## Phase 5: i18n Keys

### apps/web/src/i18n/en.ts and fr.ts
- account.contactSharingConsent
- account.contactFieldsDisabled
- fans.title, fans.description, fans.appointmentNote
- fans.noFans, fans.noFansDesc
- fans.shareContact, fans.approved, fans.pending, fans.declined
- menu.myFans
- search.requestSentContactNote
- preferred.contactShared, preferred.contactPending, preferred.contactNotShared
- notifications.contactSharingRequest

---

## Phase 6: Cleanup and GDPR

### apps/functions/src/scheduled/cleanupOldData.ts
- Add cleanup for processed contactSharingPending docs older than 7 days
- Add cleanup for declined contactSharingRequests older than 30 days

### apps/functions/src/family/removePreferredBabysitter.ts
- When removing favorite, cancel unprocessed contactSharingPending docs for this pair
- Optionally update contactSharingRequests status

---

## Implementation Sequence

1. Phase 1 — smallest blast radius, immediately fixes PII exposure
2. Phase 2 — delayed notification infrastructure
3. Phase 3 — conditional contact sharing
4. Phase 4 — fans management UI
5. Phase 5 — i18n (incrementally with each phase)
6. Phase 6 — cleanup and edge cases

---

## Key Architecture Decisions

- Contact sharing data: top-level collection + approvedFamilies array on user doc (collection for queries/audit, array for fast search-time lookup)
- Delayed notification: scheduled function polling every minute (reliable, follows sendReminders pattern)
- Contact info in search: conditionally included based on approvedFamilies (minimal change to search function)
- Babysitter consent: boolean on user doc (simple, client read/write)

---

## Risks and Mitigations

1. Scheduled function cost: exits immediately when no pending docs, negligible cost
2. Race condition on remove-then-re-add: dedup check prevents duplicate requests
3. Denormalization of approvedFamilies: respondToContactSharing updates both atomically in batch
4. Firestore rules allow parents to read babysitter docs including contact fields: client code no longer displays them, but for full lockdown a future phase could move contact data to a private subcollection
