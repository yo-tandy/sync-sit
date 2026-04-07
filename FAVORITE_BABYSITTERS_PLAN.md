# Favorite Babysitters Feature - Implementation Plan

## Overview
Implement a "favorite babysitters" feature for families to save, manage, and quickly re-contact babysitters they've already worked with. This reduces friction for repeat engagements and improves user experience for families with established childcare relationships.

---

## Current State Analysis

### Search Flow (SearchPage.tsx)
- Parents search for babysitters using: date/time, recurring slots, kid ages, address, budget
- Results displayed sorted by: distance (closest first), then reference count (most first)
- Results show: photo, name, age, class level, languages, kid age range, max kids, distance, references, about-me blurb
- "Returning babysitter" indicator (⭐) exists for babysitters with confirmed appointments
- Contact button opens dialog to send request with message and offered rate

### Data Models

#### FamilyDoc (packages/shared/src/types/family.ts)
```
- familyId, familyName, address, latLng
- parentIds, photoUrl, pets, note
- searchDefaults: { minBabysitterAge, preferredGender, requireReferences, maxRate }
- verification, createdAt, updatedAt, status
```

#### AppointmentDoc
- Contains full search context + babysitter details
- Has status: pending, confirmed, cancelled, completed (inferred)
- Tracks familyId and babysitterUserId relationship

#### ParentUser
- uid, role: 'parent', email, familyId
- No favorites list currently exists

### Current Features
- "Returning babysitter" detection via confirmed appointments (line 142-149 SearchPage.tsx)
- Search defaults saved in FamilyDoc (searchDefaults)
- Contact history implicit through appointments

---

## Proposed Solution: Favorites Feature

### 1. Data Model Changes

#### Add to FamilyDoc (packages/shared/src/types/family.ts)
```typescript
export interface FamilyDoc {
  // ... existing fields ...
  favoriteBabysitters?: {
    [babysitterUserId: string]: {
      savedAt: FirestoreTimestamp;
      notes?: string;  // Family's private notes about this sitter
      rating?: number;  // 1-5 star rating (optional)
    }
  }
}
```

**Rationale**: Store as nested object keyed by babysitterUserId for:
- O(1) lookup when checking if favorite
- Easy addition/removal
- Atomicity of single document updates
- No subcollection complexity

---

### 2. Backend Cloud Functions (apps/functions/src/)

#### New Function: `addFavoriteBabysitter`
**Path**: `apps/functions/src/search/addFavoriteBabysitter.ts`

**Purpose**: Add or update a babysitter as favorite
- Auth: Parent user only
- Input: babysitterUserId, notes (optional), rating (optional)
- Validation:
  - Caller must be family member (check familyId)
  - Babysitter must exist and be active
  - Family must be fully verified (reuse existing pattern)
- Action: Update FamilyDoc.favoriteBabysitters[babysitterUserId]
- Return: Updated favorites object
- Error handling: Handle re-adding existing favorite (idempotent)
- Audit: Log via writeUserActivity

#### New Function: `removeFavoriteBabysitter`
**Path**: `apps/functions/src/search/removeFavoriteBabysitter.ts`

**Purpose**: Remove babysitter from favorites
- Auth: Parent user only
- Input: babysitterUserId
- Validation: Same as add
- Action: Delete FamilyDoc.favoriteBabysitters[babysitterUserId]
- Return: Success confirmation
- Idempotent: OK if already removed
- Audit: Log via writeUserActivity

#### Update: `searchBabysitters`
**Modification**: Add favorite indicator to results
- At result building: Check if babysitter in FamilyDoc.favoriteBabysitters
- Add to BabysitterResult interface: `isFavorite?: boolean`
- Return this field (already querying family data for verification)

---

### 3. Frontend Components (apps/web/src/)

#### New Page: FavoritesPage.tsx
**Path**: `apps/web/src/pages/family/FavoritesPage.tsx`

**Features**:
- Tab/section accessible from family dashboard or search page
- Display list of favorite babysitters with:
  - Avatar, name, rating/review section, saved date
  - Quick actions: View full profile, Contact, Remove from favorites
  - Edit notes (inline or dialog)
- Fallback: "No favorites yet" + link to search
- Sort options: By saved date (newest first), by rating, alphabetically
- Each card shows:
  - Babysitter name + profile photo
  - Star rating (if rated by family)
  - Family's private notes
  - "Days until last contact" or "Last contacted X days ago"
  - Quick action buttons: Contact (opens same dialog as search), Remove, Edit notes

**Interactions**:
- Click card → expand to show full details
- Contact button → pre-populate with babysitter info, offer to send quick message
- Remove → confirmation dialog
- Edit notes → inline textarea or modal
- No deletion, just removal from list

#### Update: SearchPage.tsx
**Modifications**:
1. **Favorites indicator** (line 490)
   - Change star icon styling for favorites vs returning
   - Add heart icon for favorites
   - Show "💗 Favorite" or "⭐ Returning" labels
   
2. **Favorite button on result cards** (after Contact button, line 517)
   ```
   <Button size="sm" variant="outline" onClick={(e) => {
     e.stopPropagation();
     handleToggleFavorite(b);
   }}>
     {isFavorite(b.uid) ? '💗 Remove from Favorites' : '🤍 Add to Favorites'}
   </Button>
   ```

3. **State management** (line 105+)
   ```typescript
   const [favorites, setFavorites] = useState<Set<string>>(new Set());
   const [favoritesLoading, setFavoritesLoading] = useState(false);
   ```

4. **Load favorites** (update useEffect at line 122)
   - When loading family doc, also extract favoriteBabysitters keys
   - Store in Set for O(1) lookup

5. **Handle toggle favorite** (new function)
   ```typescript
   const handleToggleFavorite = async (babysitter: BabysitterResult) => {
     const isFav = favorites.has(babysitter.uid);
     try {
       if (isFav) {
         await httpsCallable(functions, 'removeFavoriteBabysitter')({
           babysitterUserId: babysitter.uid,
         });
         setFavorites(new Set([...favorites].filter(id => id !== babysitter.uid)));
       } else {
         await httpsCallable(functions, 'addFavoriteBabysitter')({
           babysitterUserId: babysitter.uid,
         });
         setFavorites(new Set([...favorites, babysitter.uid]));
       }
     } catch (err) {
       setSearchError(err.message || 'Failed to update favorite');
     }
   };
   ```

#### Update: Family Dashboard
**Path**: `apps/web/src/pages/family/FamilyDashboard.tsx` (if exists)
- Add link/section "Your Favorite Babysitters" → FavoritesPage
- Or sidebar option for quick access to favorites

---

### 4. UI/UX Details

#### Visual Indicators
- Search results: 
  - Heart icon (💗 or ❤️) for favorites
  - Distinguish from returning sitter (⭐)
  - Both if applicable
- Favorites page: Hero section if none yet

#### Interactions
- **Quick Contact from Favorites**:
  - Button opens contact dialog
  - Pre-fills with babysitter name
  - Can pre-fill last offered rate (from last appointment if available)
  
- **Edit Notes**:
  - Inline or modal for family's private thoughts
  - Saves automatically (debounced)
  - Max 500 chars

#### Sorting/Filtering
- Default: Newest saved first
- Option: Most recently contacted first
- Option: Highest rated first (if ratings implemented)

---

### 5. Database Schema Summary

#### New Subcollection? 
**Decision**: NO - Use nested object in FamilyDoc
- Simpler queries
- No need for separate authorization rules
- Easier to check "is this a favorite" without extra query
- FamilyDoc already modified for other metadata

#### Indexes Needed
None required initially:
- No queries filtering by favorite status across families
- No sorting by favorite metadata
- Single document reads only

---

## Implementation Order

### Phase 1: Backend Foundation
1. Add FamilyDoc type updates to `family.ts`
2. Create `addFavoriteBabysitter` cloud function
3. Create `removeFavoriteBabysitter` cloud function
4. Update `searchBabysitters` to include favorite indicator

### Phase 2: Frontend UI - Search Integration
5. Update SearchPage.tsx:
   - Load favorites from family doc
   - Add favorite toggle button
   - Update result display with indicator
6. Update FamilySettingsPage.tsx (if needed for defaults handling)

### Phase 3: Dedicated UI
7. Create FavoritesPage.tsx component
8. Add navigation link (dashboard, top nav, or menu)
9. Implement view/edit/remove interactions

### Phase 4: Polish & Testing
10. Add translations (i18n)
11. Write tests for cloud functions
12. Test edge cases (remove while viewing, etc.)

---

## API Contract Examples

### addFavoriteBabysitter Request
```json
{
  "babysitterUserId": "baby123",
  "notes": "Loves bedtime stories, great with toddlers",
  "rating": 5
}
```

### addFavoriteBabysitter Response
```json
{
  "success": true,
  "favorites": {
    "baby123": {
      "savedAt": "2025-04-03T10:30:00Z",
      "notes": "Loves bedtime stories...",
      "rating": 5
    }
  }
}
```

### searchBabysitters BabysitterResult Update
```typescript
interface BabysitterResult {
  // ... existing fields ...
  isFavorite?: boolean;  // NEW
}
```

---

## Edge Cases & Considerations

1. **Adding non-existent babysitter**: Validate exists before adding
2. **Adding already-favorite**: Idempotent - just update notes/rating if provided
3. **Removing non-favorite**: Idempotent - return success
4. **Family with 0 confirmed appointments**: Still allowed to add favorites
5. **Babysitter deactivates**: Favorite stays in list (soft-delete pattern)
6. **Displaying favorites**: Filter out inactive babysitters from favorite list
7. **Sync across devices**: All parent users in family see same favorites (shared on FamilyDoc)

---

## Files to Create/Modify

### Create:
- `apps/functions/src/search/addFavoriteBabysitter.ts`
- `apps/functions/src/search/removeFavoriteBabysitter.ts`
- `apps/web/src/pages/family/FavoritesPage.tsx`

### Modify:
- `packages/shared/src/types/family.ts` (add favoriteBabysitters to FamilyDoc)
- `packages/shared/src/types/appointment.ts` (BabysitterResult interface)
- `apps/web/src/pages/family/SearchPage.tsx` (UI + logic for toggle)
- `apps/functions/src/search/searchBabysitters.ts` (add favorite indicator)
- `apps/web/src/pages/family/FamilyDashboard.tsx` (navigation link - if exists)
- i18n files: `apps/web/src/i18n/en.ts`, `apps/web/src/i18n/fr.ts`

---

## Success Criteria

- [✓] Families can add/remove babysitters as favorites
- [✓] Favorite status persists across sessions
- [✓] Favorites visible in search results with clear indicator
- [✓] Dedicated favorites page shows all saved babysitters
- [✓] Can add notes and ratings to favorites (for future use)
- [✓] All parent users in family see same favorites
- [✓] Favorites don't interfere with existing search/appointment flows
- [✓] Cloud functions are secured and audited
- [✓] UI is responsive and matches design system

---

## Notes

- **Why nested object vs subcollection?**
  - Simpler permission model
  - No need for separate security rules
  - Atomic updates (add/remove favorite is single write)
  - Easier to read all favorites in one query
  - Performance: nested objects up to ~100KB are fine in Firestore
  - Even 1000 favorites @ ~200 bytes each = 200KB (acceptable)

- **Why not store in babysitter's document?**
  - Would require babysitter permission (auth complexity)
  - Multiple writes per family per sitter
  - Query inefficiencies for showing "I've been favorited by X families"

- **Why not Cloud Firestore with subcollection?**
  - `families/{familyId}/favorites/{babysitterUserId}` would work
  - Adds complexity for checking "is this favorite" (requires read)
  - Current approach: single read returns all favorites
  - Tradeoff: simplicity over perfect separation

---

## Future Enhancements (Out of Scope)

- **Ratings/Reviews**: Extend with 1-5 stars, written reviews
- **Notification on favorite babysitter availability**: "Your favorite X is now available"
- **Sharing favorites**: "Share your sitter list with family" (co-parenting)
- **Babysitter stats**: "You've used X for Y hours over Z months"
- **Auto-recommendation**: "Based on your favorites, you might like..."
- **Favorite groups**: "Date nights" vs "School pickups" with different sitters
