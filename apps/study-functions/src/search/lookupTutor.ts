import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { registerLookup } from '@ejm/shared-functions/auth/sendRateLimit.js';
import { resolveFamilyRequestStatuses } from '../contact/requestStatus.js';
import { getEjemEmail, getParentProfile } from '@ejm/shared-core';
import { getTutorView } from '@ejm/study-core';
import type { TutorLookupResult } from '@ejm/study-core';
import type { User } from '@ejm/shared-core';
import { lookupTutorSchema } from '../validation/search.js';

/**
 * lookupTutor (issue #235, parity A2): sit's lookupBabysitter ported --
 * a family finds a tutor they already know by NAME (substring) or exact
 * email/ejemEmail, without the tutor having to surface in subject search.
 *
 * Correction to the issue text: sit's mechanism is name/email lookup, not a
 * personal code -- the port mirrors what actually shipped there.
 *
 * Gates: parent-only caller; `profiles.tutor.searchable == true` (a hidden
 * tutor stays hidden -- the #213 reasoning) AND `enrollmentComplete == true`
 * (searchTutors' third filter: legacy dev/test docs must not resolve). NO
 * family-verification gate, mirroring sit AND ACCEPTED AS A RISK: an
 * authenticated unverified parent can resolve searchable tutors' display
 * fields by name -- the same asymmetry sit ships -- but the results are
 * display-only, sendTutorContactRequest (the only next step) enforces
 * isFullyVerified itself, and every call leaves an audit entry below.
 * Resolving NEVER bypasses the two-stage model: no contact fields in the
 * payload, and the family proceeds through the ordinary
 * sendTutorContactRequest flow.
 */
export const lookupTutor = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = lookupTutorSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Search query must be at least 2 characters',
      );
    }

    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller?.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can look up tutors');
    }
    const familyId = caller.familyId;

    // Throttle, not a gate (PR #254 rounds 2-3): the surface is
    // deliberately reachable by unverified families, so the per-uid budget
    // is what makes scraping expensive rather than merely visible-in-audit.
    // TIERED by family verification -- a bare account is free, a verified
    // family is not, so the unverified budget is sized for "find the tutor
    // I already know", never enumeration. Same counter shape as the
    // email-send limits (exact under concurrency).
    const familyDoc = await db.collection('families').doc(familyId).get();
    const isVerifiedFamily = familyDoc.data()?.verification?.isFullyVerified === true;
    if (!(await registerLookup(uid, isVerifiedFamily))) {
      throw new HttpsError('resource-exhausted', 'lookup_rate_limited');
    }

    const q = parsed.data.query.toLowerCase();
    const matches: TutorLookupResult[] = [];

    const snap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.tutor.searchable', '==', true)
      .where('profiles.tutor.enrollmentComplete', '==', true)
      .get();

    // This family's per-tutor request status -- the ONE resolution, shared
    // with searchTutors (extracted PR #254 round 3; semantics documented at
    // the helper).
    const statusOf = await resolveFamilyRequestStatuses(familyId);

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
        matches.push({
          uid: doc.id,
          firstName: view.firstName || '',
          lastName: view.lastName || '',
          photoUrl: view.photoUrl || null,
          classLevel: view.classLevel || '',
          languages: view.languages || [],
          subjects: (view.subjects || []).map((o) => ({ subject: o.subject, levels: o.levels })),
          requestStatus: statusOf(doc.id),
        });
      }
    }

    // Deterministic order + an explicit truncation signal (PR #254 round 3):
    // snap.docs order is Firestore-internal and can shift between identical
    // queries, so an untyped cap silently returned an ARBITRARY 10. Sort by
    // name, cap, and tell the client the list is partial so it can say
    // "refine your search" instead of implying completeness.
    matches.sort((a, b) =>
      (`${a.lastName} ${a.firstName}`).localeCompare(`${b.lastName} ${b.firstName}`),
    );
    const truncated = matches.length > 10;
    const results = matches.slice(0, 10);

    // Audit: an ungated enumeration surface is exactly where an activity
    // record earns its keep. The query itself is NOT logged -- it may be an
    // email address; length + hit count is enough to spot scraping.
    await writeUserActivity(uid, 'lookup_tutor', {
      queryLength: q.length,
      resultCount: results.length,
      truncated,
    });

    return { results, truncated };
  },
);
