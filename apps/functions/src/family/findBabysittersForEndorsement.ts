import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { getParentProfile, getBabysitterView } from '@ejm/sit-core';
import type { User } from '@ejm/sit-core';
import { lookupBabysitterSchema } from '../validation/lookup.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/**
 * A babysitter as the endorsement picker shows it — and nothing else.
 * Deliberately NOT `BabysitterSummary`: this callable exists so that the
 * picker no longer needs the users collection at all (issue #529), so the
 * projection is the five fields it renders, not the search-result shape.
 */
export interface EndorsementPickerHit {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  classLevel: string;
}

const MAX_RESULTS = 10;

/**
 * findBabysittersForEndorsement (issue #529, PR1): name search for the
 * family endorsement picker (`/family/endorsements` → "add a reference").
 *
 * The page used to run this search in the browser by downloading EVERY
 * active babysitter's full user document on each debounced keystroke and
 * substring-matching client-side — which worked only because the users
 * read rule lets any signed-in account read any active babysitter's whole
 * doc (dateOfBirth, address, contact, ejemEmail, approvedFamilies,
 * fcmTokens…). Moving the search here keeps the feature and returns only
 * the five fields the picker renders; PR3 of the ladder narrows the rule
 * once nothing else depends on it.
 *
 * Semantics are the page's, unchanged on purpose:
 *   - population: `status == 'active'` babysitters, enrollment complete OR
 *     NOT (a family may endorse a babysitter who has not finished
 *     enrolling); the `searchable` toggle is NOT applied — a babysitter
 *     hidden from search can still be endorsed by a family who used them.
 *   - match: case-insensitive substring of "first last".
 *   - cap: 10.
 * No age backstop either: this is not a discovery surface (nothing here
 * leads to contact or booking), and the page never applied one.
 *
 * Caller gate: an authenticated parent with a family. The page sits behind
 * AuthGuard role="parent"; verification is not required to submit a
 * reference today, so it is not required to search for one.
 */
export const findBabysittersForEndorsement = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    // Same bounds as lookupBabysitter: ≤100 chars, ≥2 after trim.
    const parsed = lookupBabysitterSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid search query',
      );
    }
    const q = parsed.data.query.toLowerCase();

    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can search babysitters to endorse');
    }

    // Exactly the query the page ran client-side (equality + `in`, no
    // composite index beyond what already exists).
    const snap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.babysitter.enrollmentComplete', 'in', [true, false])
      .get();

    const results: EndorsementPickerHit[] = [];
    for (const d of snap.docs) {
      const b = getBabysitterView(d.data() as User);
      if (!b) continue;
      const fullName = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
      if (!fullName.includes(q)) continue;
      results.push({
        uid: d.id,
        firstName: b.firstName || '',
        lastName: b.lastName || '',
        photoUrl: b.photoUrl || null,
        classLevel: b.classLevel || '',
      });
      if (results.length >= MAX_RESULTS) break;
    }

    await writeUserActivity(uid, 'babysitter_endorsement_search', { query: parsed.data.query, matchCount: results.length });

    return { results };
  },
);
