import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
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

    const q = parsed.data.query.toLowerCase();
    const results: TutorLookupResult[] = [];

    const snap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.tutor.searchable', '==', true)
      .where('profiles.tutor.enrollmentComplete', '==', true)
      .get();

    // The pair's existing requests, for per-result status -- searchTutors'
    // resolution EXACTLY (latest request per pair wins, by createdAt):
    // a TUTOR-initiated pending is 'incoming', never 'pending' (rendering
    // "request sent" would lie; 'none' would offer a send CTA that fails as
    // already-exists -- issue #207 PR4 / PR #213 review). A tutor-initiated
    // closed request is not this family's history and stays out. A
    // family-initiated declined surfaces as 'declined' so the CTA carries
    // the cooldown hint instead of promising a clean send.
    const reqSnap = await db.collection('studyContactRequests')
      .where('familyId', '==', familyId)
      .get();
    const latestRequest = new Map<string, { status: string; createdAtMs: number }>();
    reqSnap.docs.forEach((d) => {
      const data = d.data();
      const tutorId = data.tutorUserId as string;
      if (!tutorId) return;
      const tutorInitiated = data.initiatedBy === 'tutor';
      if (tutorInitiated && data.status !== 'accepted' && data.status !== 'pending') return;
      const createdAtMs = data.createdAt?.toMillis
        ? data.createdAt.toMillis()
        : data.createdAt?.toDate
          ? data.createdAt.toDate().getTime()
          : 0;
      const prev = latestRequest.get(tutorId);
      if (!prev || createdAtMs >= prev.createdAtMs) {
        const status = tutorInitiated && data.status === 'pending'
          ? 'incoming'
          : (data.status as string);
        latestRequest.set(tutorId, { status, createdAtMs });
      }
    });
    const KNOWN = ['pending', 'accepted', 'declined', 'incoming'] as const;
    const statusOf = (tutorId: string): TutorLookupResult['requestStatus'] => {
      const s = latestRequest.get(tutorId)?.status;
      return (KNOWN as readonly string[]).includes(s ?? '')
        ? (s as TutorLookupResult['requestStatus'])
        : 'none';
    };

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
          requestStatus: statusOf(doc.id),
        });
      }
      if (results.length >= 10) break;
    }

    // Audit: an ungated enumeration surface is exactly where an activity
    // record earns its keep. The query itself is NOT logged -- it may be an
    // email address; length + hit count is enough to spot scraping.
    await writeUserActivity(uid, 'lookup_tutor', {
      queryLength: q.length,
      resultCount: results.length,
    });

    return { results };
  },
);
