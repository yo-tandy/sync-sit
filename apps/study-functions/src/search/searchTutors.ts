import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
// haversineDistance lives in @ejm/shared-core (sit-core merely re-exports it);
// study-functions already depends on @ejm/shared-core, so we import it there
// directly rather than pulling in sit-core just for the geo helper.
import { haversineDistance, getParentProfile, postcodeToArrondissement, getContact } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, SubjectOffering, TutorSearchResult } from '@ejm/study-core';
import { searchTutorsSchema } from '../validation/search.js';
import { latestRequestStatusByTutor, resolveRequestStatus } from './requestStatus.js';

export const searchTutors = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const parsed = searchTutorsSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid search parameters',
      );
    }
    const params = parsed.data;

    // Requested session-location TYPES, normalized to the array form: the
    // multi-select `locationPrefs` wins; the legacy single `locationPref` is
    // folded in for older clients. Empty → no location filtering.
    const requestedPrefs =
      params.filters?.locationPrefs ??
      (params.filters?.locationPref ? [params.filters.locationPref] : []);

    // ── Caller gate: must be a parent whose family is fully verified ──
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can search for tutors');
    }
    const callerFamilyId = callerParent.familyId;
    const callerFamilyDoc = await db.collection('families').doc(callerFamilyId).get();
    if (!callerFamilyDoc.data()?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before searching for tutors');
    }

    // ── Candidate tutors: one equality filter (no composite index needed) ──
    // `effectiveSearchable` (issue #435 PR2, computeEffectiveSearchable in
    // @ejm/shared-core) is a server-maintained denormalization that already
    // folds in `status === 'active'`, `searchable === true` (the tutor's own
    // visibility switch), and `enrollmentComplete === true` (kept, even
    // though it's true from creation for every current tutor — owner
    // decision 2026-08-17: no admin identity approval — to exclude legacy
    // dev/test docs enrolled under the old gated model). Replaces the three
    // separate `.where()` clauses this used to be; the write-trigger that
    // maintains it lives in apps/functions (deploys once, from the sit
    // codebase — see onUserWrittenRecomputeSearchable.ts).
    const usersSnap = await db.collection('users')
      .where('profiles.tutor.effectiveSearchable', '==', true)
      .get();

    console.log(`Found ${usersSnap.size} searchable tutors`);
    if (usersSnap.empty) {
      await writeUserActivity(request.auth.uid, 'search_tutors', { subject: params.subject, level: params.level });
      return { results: [] };
    }

    // Endorsement counts are read from the tutor's denormalized, server-owned
    // `endorsementCount` on the profile (below) — respondToTutorEndorsement
    // maintains it. This replaces a per-call scan of the entire study
    // references collection.

    // ── This family's request status per tutor (latest wins) ──
    // The projection rules (tutor-initiated pending => 'incoming', closed
    // tutor-initiated requests excluded) live in requestStatus.ts, shared
    // with lookupTutor (issue #235) so both family-facing cards agree.
    const requestsSnap = await db.collection('studyContactRequests')
      .where('familyId', '==', callerFamilyId)
      .get();
    const latestRequest = latestRequestStatusByTutor(requestsSnap.docs);

    // ── Match, filter, score ──
    const results: TutorSearchResult[] = [];

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() as StudyUser;
      const tutor: TutorProfile | undefined = user.profiles?.tutor;
      if (!tutor) continue;
      const uid = userDoc.id;

      // Subject-first offering match: subject AND the searched level covered.
      const offering: SubjectOffering | undefined = tutor.subjects?.find(
        (o) => o.subject === params.subject && o.levels.includes(params.level),
      );
      if (!offering) continue;

      // Filter: max rate (against the MATCHED subject's rate).
      if (params.filters?.maxRate !== undefined && offering.rate > params.filters.maxRate) {
        continue;
      }

      // Contact fields only for families the tutor has approved. Computed BEFORE
      // the geography checks because an existing consent relationship overrides
      // geography: an approved family reaching this tutor (e.g. via the
      // accepted-request deep-link, which replays the family's saved latLng) must
      // never be filtered out by the tutor's radius or the maxDistanceKm filter.
      const contactApproved = (tutor.approvedFamilies ?? []).includes(callerFamilyId);

      // Distance + reachability (computed before the location-type filter so
      // the radius result can feed the coverage decision). withinRange tracks
      // the TUTOR'S OWN radius only — the family's maxDistanceKm filter is a
      // separate, whole-tutor concern handled just below.
      let distance: number | null = null;
      let withinRange = false;
      if (tutor.areaMode === 'distance' && tutor.areaLatLng && params.latLng) {
        const rawDistance = haversineDistance(tutor.areaLatLng, params.latLng);
        withinRange = rawDistance <= (tutor.areaRadiusKm ?? 5);
        distance = Math.round(rawDistance * 10) / 10;
      } else if (tutor.areaMode === 'arrondissement') {
        // Arrondissement coverage is enforced by the location-type filter
        // below (label intersection) — location-untyped queries deliberately
        // include all arrondissement tutors. Here we only surface a distance
        // for sorting when both points happen to be known.
        if (tutor.areaLatLng && params.latLng) {
          distance = Math.round(haversineDistance(tutor.areaLatLng, params.latLng) * 10) / 10;
        }
      }

      // Filter: the family's explicit distance ceiling. Unlike the tutor's
      // radius (coverage — constrains family-side legs via `covers` below),
      // maxDistanceKm is the FAMILY'S preference for how far away a tutor may
      // be at all, so it excludes the whole tutor on typed and untyped
      // queries alike — no online exemption; a family capping distance asked
      // for nearby tutors, and the UI offers the input unconditionally.
      // Approved families keep their relationship-over-geography bypass.
      if (
        params.filters?.maxDistanceKm !== undefined &&
        distance !== null &&
        !contactApproved &&
        distance > params.filters.maxDistanceKm
      ) {
        continue;
      }

      // Coverage: does this tutor's area reach THIS family? Model: geography
      // constrains only the family-side legs ('family_home'/'library'). An
      // existing consent relationship (approvedFamilies) overrides geography
      // in BOTH modes — an approved family keeps their tutor's family-side
      // legs regardless of label or radius. Otherwise: arrondissement mode
      // matches the family's resolved area label; stored values are
      // string-guarded (the field is client-written — one junk element must
      // degrade to "does not match", never throw and take the whole callable
      // down) and normalized through postcodeToArrondissement because the
      // free-text era taught tutors postcodes ('75016'), which must keep
      // matching '16e'. Distance mode needs BOTH sides' coordinates and the
      // tutor's radius to hold; missing coordinates on either side fail
      // closed, like arr-mode with no label.
      const covers =
        contactApproved ||
        (tutor.areaMode === 'distance'
          ? !!tutor.areaLatLng && !!params.latLng && withinRange
          : !!params.areaLabel &&
            (tutor.arrondissements ?? []).some(
              (a) =>
                typeof a === 'string' &&
                (a === params.areaLabel || postcodeToArrondissement(a) === params.areaLabel),
            ));

      // Projection honesty (unconditional — typed AND untyped): the card and
      // booking form SUBTRACT family-side legs the coverage cannot serve from
      // the tutor's full prefs, so a family is never offered "at your home"
      // by a tutor whose coverage does not reach them — on the default
      // untyped search too. Never intersected with the request: every leg
      // the tutor genuinely offers this family stays, requested or not.
      let projectedPrefs = tutor.locationPrefs ?? [];
      if (!covers) {
        projectedPrefs = projectedPrefs.filter((p) => p !== 'family_home' && p !== 'library');
      }

      // Filter: session location types (issue #167). A tutor matches when the
      // requested set intersects a leg they can actually serve: tutor-side
      // legs ('online'/'tutor_home') always; family-side legs only when
      // coverage reaches the family — THIS is the trust boundary for
      // "in-person tutors must have a coverage area"; the area page's save
      // gate is UX only.
      if (requestedPrefs.length > 0) {
        const matchedPrefs = requestedPrefs.filter((p) => tutor.locationPrefs?.includes(p));
        if (matchedPrefs.length === 0) continue;
        const servable = matchedPrefs.some(
          (p) => p === 'online' || p === 'tutor_home' || covers,
        );
        if (!servable) continue;
      } else if (
        tutor.areaMode === 'distance' &&
        distance !== null &&
        !withinRange &&
        !contactApproved
      ) {
        // Location-UNTYPED queries keep the pre-#167 whole-tutor radius gate:
        // with no requested legs there is no tutor-side leg to ride in on,
        // and dropping out-of-range distance-mode tutors is what the tutor's
        // radius always meant here. For TYPED queries the radius result only
        // feeds `covers` above — a far-away tutor rides in on a matched
        // tutor-side leg with the family-side legs subtracted, never
        // silently vanishing.
        continue;
      }

      // Actionable-status whitelist (shared, see requestStatus.ts): anything
      // unrecognized — including 'cancelled' — falls back to 'none'.
      const requestStatus = resolveRequestStatus(latestRequest.get(uid));

      const result: TutorSearchResult = {
        uid,
        firstName: user.firstName,
        lastName: user.lastName || '',
        photoUrl: user.photoUrl,
        languages: tutor.languages || [],
        aboutMe: tutor.aboutMe,
        classLevel: tutor.classLevel,
        subject: params.subject,
        level: params.level,
        rate: offering.rate,
        levels: offering.levels,
        sessionLengthsMin: tutor.sessionLengthsMin || [],
        locationPrefs: projectedPrefs,
        distance,
        endorsementCount: tutor.endorsementCount ?? 0,
        cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
        requestStatus,
      };
      if (contactApproved) {
        // Canonical root ?? nested resolution (issue #203 shared identity):
        // a root-only Account edit reaches families immediately.
        const contact = getContact(user as unknown as User);
        result.contactEmail = contact.contactEmail ?? undefined;
        result.contactPhone = contact.contactPhone ?? undefined;
        result.whatsapp = contact.whatsapp ?? undefined;
      }
      results.push(result);
    }

    // Sort: distance ascending with nulls last, then endorsementCount descending.
    results.sort((a, b) => {
      if (a.distance === null && b.distance === null) {
        return b.endorsementCount - a.endorsementCount;
      }
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.endorsementCount - a.endorsementCount;
    });

    console.log(`Returning ${results.length} matching tutors`);
    await writeUserActivity(request.auth.uid, 'search_tutors', { subject: params.subject, level: params.level });

    return { results };
  },
);
