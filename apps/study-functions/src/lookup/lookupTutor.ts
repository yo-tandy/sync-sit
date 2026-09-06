import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import {
  haversineDistance,
  getParentProfile,
  postcodeToArrondissement,
  resolveAreaLabel,
  getContact,
  matchesProviderIdentity,
} from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, TutorLookupResult } from '@ejm/study-core';
import { lookupTutorSchema } from '../validation/lookup.js';
import { latestRequestStatusByTutor, resolveRequestStatus } from '../search/requestStatus.js';

const MAX_RESULTS = 10;

/**
 * lookupTutor (issue #437): find a tutor directly by name, email, or phone —
 * for a family who already knows who they're looking for and doesn't want to
 * hunt through search filters. Replaces the earlier personal-code flow
 * (issue #235): a query can match several tutors, so this returns a LIST
 * (like sit's lookupBabysitter), not a single resolved card.
 *
 * What a lookup IS and IS NOT, unchanged from the code-based version:
 * - It returns the same projection searchTutors returns (identity, offerings,
 *   endorsement count, request status; contact fields ONLY for an approved
 *   family) — so the caller gate is searchTutors' gate verbatim: a parent
 *   with a fully-verified family. A lookup is not a skeleton key around
 *   verification.
 * - Connecting from a result mints the NORMAL contact request
 *   (sendTutorContactRequest, with every one of its guards) — the lookup is a
 *   discovery shortcut, never a bypass of the approvedFamilies unlock.
 *
 * The `searchable` gate (folded into `effectiveSearchable`, same
 * denormalization searchTutors reads) is evaluated at lookup time like every
 * other field on the candidate — there's no separate mint step whose staleness
 * needs re-checking, unlike the code it replaces.
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
        parsed.error.issues[0]?.message || 'Invalid search query',
      );
    }
    const { query } = parsed.data;

    // ── Caller gate: a parent with a fully-verified family — searchTutors'
    // gate, unchanged, because this reveals the same profile projection. ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can look up tutors');
    }
    const familyId = callerParent.familyId;
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before looking up tutors');
    }

    // Same candidate predicate as searchTutors: effectiveSearchable already
    // folds in status === 'active', the tutor's own searchable toggle, and
    // enrollmentComplete.
    const usersSnap = await db.collection('users')
      .where('profiles.tutor.effectiveSearchable', '==', true)
      .get();

    if (usersSnap.empty) {
      await writeUserActivity(uid, 'tutor_identity_lookup', { query, matchCount: 0 });
      return { results: [] };
    }

    // ── Family-relative geometry, mirroring searchTutors: distance for
    // display, coverage for the family-side-legs projection. The family's
    // saved location comes off their own doc (already loaded for the
    // verification gate) — there is no search form here to type one into. ──
    const familyLatLng = familyData.latLng as { lat: number; lng: number } | undefined;
    const areaLabel = resolveAreaLabel({
      postcode: (familyData.postcode as string | undefined) ?? undefined,
      city: (familyData.city as string | undefined) ?? undefined,
    });

    // ── This family's request status per tutor (latest wins), batched once
    // for every candidate rather than per-match (issue #235 -> #437: a query
    // can match several tutors, unlike the single code it replaces). ──
    const requestsSnap = await db.collection('studyContactRequests')
      .where('familyId', '==', familyId)
      .get();
    const latestRequest = latestRequestStatusByTutor(requestsSnap.docs);

    const results: TutorLookupResult[] = [];

    for (const tutorDoc of usersSnap.docs) {
      const tutorUser = tutorDoc.data() as StudyUser;
      const tutor: TutorProfile | undefined = tutorUser.profiles?.tutor;
      if (!tutor) continue;

      const contact = getContact(tutorUser as unknown as User);
      if (!matchesProviderIdentity(query, {
        fullName: `${tutorUser.firstName || ''} ${tutorUser.lastName || ''}`,
        email: tutorUser.email || '',
        ejemEmail: tutorUser.ejemEmail || '',
        contactPhone: contact.contactPhone,
        whatsapp: contact.whatsapp,
      })) continue;

      const contactApproved = (tutor.approvedFamilies ?? []).includes(familyId);

      let distance: number | null = null;
      let withinRange = false;
      if (tutor.areaMode === 'distance' && tutor.areaLatLng && familyLatLng) {
        const rawDistance = haversineDistance(tutor.areaLatLng, familyLatLng);
        withinRange = rawDistance <= (tutor.areaRadiusKm ?? 5);
        distance = Math.round(rawDistance * 10) / 10;
      } else if (tutor.areaMode === 'arrondissement' && tutor.areaLatLng && familyLatLng) {
        distance = Math.round(haversineDistance(tutor.areaLatLng, familyLatLng) * 10) / 10;
      }

      // Coverage: same model as searchTutors — geography constrains only the
      // family-side legs; an existing consent relationship overrides geography
      // in both modes; arr-mode labels are string-guarded and normalized
      // through postcodeToArrondissement ('75016' must keep matching '16e');
      // missing coordinates/labels fail closed.
      const covers =
        contactApproved ||
        (tutor.areaMode === 'distance'
          ? !!tutor.areaLatLng && !!familyLatLng && withinRange
          : !!areaLabel &&
            (tutor.arrondissements ?? []).some(
              (a) =>
                typeof a === 'string' &&
                (a === areaLabel || postcodeToArrondissement(a) === areaLabel),
            ));

      // Projection honesty (searchTutors' rule): never offer "at your home" /
      // "library" from a tutor whose coverage does not reach this family.
      let projectedPrefs = tutor.locationPrefs ?? [];
      if (!covers) {
        projectedPrefs = projectedPrefs.filter((p) => p !== 'family_home' && p !== 'library');
      }

      const requestStatus = resolveRequestStatus(latestRequest.get(tutorDoc.id));

      // Unlike a search result there is no matched subject here — the family
      // arrived via identity, not a subject/level query — so the FULL
      // offerings list ships and the client picks the subject/level before
      // minting the normal request.
      const result: TutorLookupResult = {
        uid: tutorDoc.id,
        firstName: tutorUser.firstName,
        lastName: tutorUser.lastName || '',
        photoUrl: tutorUser.photoUrl,
        languages: tutor.languages || [],
        aboutMe: tutor.aboutMe,
        classLevel: tutor.classLevel || '',
        subjects: tutor.subjects || [],
        sessionLengthsMin: tutor.sessionLengthsMin || [],
        locationPrefs: projectedPrefs,
        distance,
        endorsementCount: tutor.endorsementCount ?? 0,
        cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
        requestStatus,
      };
      if (contactApproved) {
        result.contactEmail = contact.contactEmail ?? undefined;
        result.contactPhone = contact.contactPhone ?? undefined;
        result.whatsapp = contact.whatsapp ?? undefined;
      }

      results.push(result);
      if (results.length >= MAX_RESULTS) break;
    }

    await writeUserActivity(uid, 'tutor_identity_lookup', { query, matchCount: results.length });

    return { results };
  },
);
