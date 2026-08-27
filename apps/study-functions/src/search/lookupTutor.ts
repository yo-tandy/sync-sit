import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { getEjemEmail, getParentProfile } from '@ejm/shared-core';
import { getTutorView } from '@ejm/study-core';
import type { User } from '@ejm/shared-core';

interface LookupResult {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  classLevel: string;
  languages: string[];
  subjects: { subject: string; levels: string[] }[];
  aboutMe: string | null;
  requestStatus: 'none' | 'pending' | 'accepted' | 'incoming';
}

/**
 * lookupTutor (issue #235, parity A2): sit's lookupBabysitter ported --
 * a family finds a tutor they already know by NAME (substring) or exact
 * email/ejemEmail, without the tutor having to surface in subject search.
 *
 * Correction to the issue text: sit's mechanism is name/email lookup, not a
 * personal code -- the port mirrors what actually shipped there.
 *
 * Gates mirror sit exactly: parent-only caller, and only tutors who opted in
 * (`profiles.tutor.searchable == true`) resolve -- a hidden tutor stays
 * hidden here too, because study's contact-reveal surfaces filter on it (the
 * #213 reasoning). No family-verification gate, mirroring sit's lookup: the
 * results are display-only, and sendTutorContactRequest (the only next step)
 * enforces isFullyVerified itself. Resolving NEVER bypasses the two-stage
 * model: the result
 * carries display fields plus the pair's request status, and the family
 * proceeds through the ordinary sendTutorContactRequest flow.
 */
export const lookupTutor = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const { query } = request.data as { query?: string };
    if (!query || query.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'Search query must be at least 2 characters');
    }

    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller?.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can look up tutors');
    }
    const familyId = caller.familyId;

    const q = query.trim().toLowerCase();
    const results: LookupResult[] = [];

    const snap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.tutor.searchable', '==', true)
      .get();

    // The pair's existing requests, for per-result status (searchTutors'
    // idiom): equality-only, no composite index.
    const reqSnap = await db.collection('studyContactRequests')
      .where('familyId', '==', familyId)
      .get();
    // searchTutors' idiom exactly: a TUTOR-initiated pending is 'incoming',
    // never 'pending' -- rendering it as "request sent" would lie, and
    // rendering 'none' would offer a send CTA that fails as already-exists
    // (issue #207 PR4 / PR #213 review). A pending in either direction
    // outranks an older accepted for the same pair.
    const statusByTutor = new Map<string, 'pending' | 'accepted' | 'incoming'>();
    for (const d of reqSnap.docs) {
      const r = d.data();
      const tid = r.tutorUserId as string;
      if (r.status === 'pending') {
        statusByTutor.set(tid, r.initiatedBy === 'tutor' ? 'incoming' : 'pending');
      } else if (r.status === 'accepted') {
        const prev = statusByTutor.get(tid);
        if (prev !== 'pending' && prev !== 'incoming') statusByTutor.set(tid, 'accepted');
      }
    }

    for (const doc of snap.docs) {
      // getEjemEmail MUST see the RAW doc (root-first precedence, issue #203);
      // the flattened view is for display fields only -- sit's exact note.
      const raw = doc.data() as User;
      const view = getTutorView(raw);
      if (!view) continue;
      const fullName = `${view.firstName || ''} ${view.lastName || ''}`.toLowerCase();
      const email = ((raw.email as string | undefined) || '').toLowerCase();
      const ejemEmail = (getEjemEmail(raw) || '').toLowerCase();
      if (fullName.includes(q) || email === q || ejemEmail === q) {
        results.push({
          uid: doc.id,
          firstName: view.firstName || '',
          lastName: view.lastName || '',
          photoUrl: view.photoUrl || null,
          classLevel: view.classLevel || '',
          languages: view.languages || [],
          subjects: (view.subjects || []).map((o) => ({ subject: o.subject, levels: o.levels })),
          aboutMe: view.aboutMe || null,
          requestStatus: statusByTutor.get(doc.id) ?? 'none',
        });
      }
      if (results.length >= 10) break;
    }
    return { results };
  },
);
