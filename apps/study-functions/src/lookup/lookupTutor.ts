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
  computeEffectiveSearchable,
} from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, TutorLookupResult } from '@ejm/study-core';
import { lookupTutorSchema } from '../validation/lookup.js';
import { latestRequestStatusByTutor, resolveRequestStatus } from '../search/requestStatus.js';

/**
 * lookupTutor (issue #235, parity A2): resolve a tutor's personal code to
 * their profile card — the study twin of sit's lookupBabysitter, for the
 * family whose tutor was found offline and never surfaces in their search.
 *
 * What resolving a code IS and IS NOT:
 * - It returns the same projection searchTutors returns (identity, offerings,
 *   endorsement count, request status; contact fields ONLY for an approved
 *   family) — so the caller gate is searchTutors' gate verbatim: a parent
 *   with a fully-verified family. A code is not a skeleton key around
 *   verification.
 * - Connecting from the card mints the NORMAL contact request
 *   (sendTutorContactRequest, with every one of its guards) — the code is a
 *   discovery shortcut, never a bypass of the approvedFamilies unlock.
 *
 * The `searchable` gate is re-checked HERE, at lookup time — not only when
 * the code was minted. This is the load-bearing lesson from sit's
 * fix/lookup-babysitter-searchable (commit 5ed1c17): codes are permanent
 * artifacts that outlive visibility choices, so a tutor who has since
 * toggled themselves hidden (or been suspended, or lost enrollment) must
 * stop resolving from that moment, exactly as they drop out of search.
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
        parsed.error.issues[0]?.message || 'Invalid code',
      );
    }
    const { code } = parsed.data;

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

    // Every resolution failure below is a UNIFORM not-found, audited first.
    // Distinguishing "no such code" from "code exists but the tutor is
    // hidden/suspended" would let anyone with a parent account probe the
    // code space for hidden-but-real tutors — the exact population the
    // searchable flag exists to protect. The audit trail (found: false,
    // with the probed code) is what makes enumeration attempts visible to
    // admins instead. The tutor who legitimately handed their code out
    // while hidden explains themselves out of band; the account page warns
    // them their code is dormant.
    const notFound = async (): Promise<HttpsError> => {
      await writeUserActivity(uid, 'tutor_code_lookup', { code, found: false });
      return new HttpsError('not-found', 'No tutor found for this code');
    };

    // Single-field equality on the nested map key — served by Firestore's
    // automatic index, no composite entry needed. limit(2) so an ambiguous
    // (duplicated) code is detectable: minting guards uniqueness, but if the
    // negligible mint race ever produced a duplicate, resolving to
    // WHICHEVER doc sorted first would silently connect the family to the
    // wrong person. Ambiguity fails closed as not-found.
    const snap = await db.collection('users')
      .where('profiles.tutor.personalCode', '==', code)
      .limit(2)
      .get();
    if (snap.size !== 1) {
      throw await notFound();
    }

    const tutorDoc = snap.docs[0];
    const tutorUser = tutorDoc.data() as StudyUser;
    const tutor: TutorProfile | undefined = tutorUser.profiles?.tutor;

    // The searchTutors candidate predicate, re-applied at LOOKUP time (see
    // the header comment): computeEffectiveSearchable (issue #435 PR2,
    // @ejm/shared-core) folds in active status (the hard ban gate), completed
    // enrollment, and the tutor's own live searchable choice — the SAME three
    // inputs searchTutors' query now filters on via the denormalized
    // `effectiveSearchable` field. This call site computes it LIVE off the
    // doc just fetched rather than trusting that denormalized copy: a single
    // already-fetched doc costs nothing extra to recompute fresh, and doing
    // so is immune to the trigger's write lag (and to a not-yet-backfilled
    // legacy doc) in a way that reading the stored field could not be.
    if (!tutor || !computeEffectiveSearchable(tutorUser, tutor)) {
      throw await notFound();
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

    // ── This family's request status toward the tutor — the shared
    // projection (requestStatus.ts), so this card and the search card agree.
    // Two equality filters: no composite index needed. ──
    const requestsSnap = await db.collection('studyContactRequests')
      .where('tutorUserId', '==', tutorDoc.id)
      .where('familyId', '==', familyId)
      .get();
    const requestStatus = resolveRequestStatus(
      latestRequestStatusByTutor(requestsSnap.docs).get(tutorDoc.id),
    );

    // Unlike a search result there is no matched subject here — the family
    // arrived via a code, not a query — so the FULL offerings list ships and
    // the client picks the subject/level before minting the normal request.
    const result: TutorLookupResult = {
      uid: tutorDoc.id,
      firstName: tutorUser.firstName,
      lastName: tutorUser.lastName || '',
      photoUrl: tutorUser.photoUrl,
      languages: tutor.languages || [],
      aboutMe: tutor.aboutMe,
      classLevel: tutor.classLevel,
      subjects: tutor.subjects || [],
      sessionLengthsMin: tutor.sessionLengthsMin || [],
      locationPrefs: projectedPrefs,
      distance,
      endorsementCount: tutor.endorsementCount ?? 0,
      cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
      requestStatus,
    };
    if (contactApproved) {
      // Canonical root ?? nested resolution (issue #203 shared identity).
      const contact = getContact(tutorUser as unknown as User);
      result.contactEmail = contact.contactEmail ?? undefined;
      result.contactPhone = contact.contactPhone ?? undefined;
      result.whatsapp = contact.whatsapp ?? undefined;
    }

    await writeUserActivity(uid, 'tutor_code_lookup', {
      code,
      found: true,
      tutorUserId: tutorDoc.id,
    });

    return { result };
  },
);
