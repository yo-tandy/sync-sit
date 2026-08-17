import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
// haversineDistance lives in @ejm/shared-core (sit-core merely re-exports it);
// study-functions already depends on @ejm/shared-core, so we import it there
// directly rather than pulling in sit-core just for the geo helper.
import { haversineDistance, getParentProfile } from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import type { StudyUser, TutorProfile, SubjectOffering, TutorSearchResult } from '@ejm/study-core';
import { searchTutorsSchema } from '../validation/search.js';

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

    // ── Candidate tutors: three equality filters (no composite index needed) ──
    // enrollmentComplete is true from creation for every current tutor (owner
    // decision 2026-08-17: no admin identity approval); the filter stays to
    // exclude legacy dev/test docs enrolled under the old gated model.
    // searchable === true is the tutor's own visibility switch.
    const usersSnap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.tutor.enrollmentComplete', '==', true)
      .where('profiles.tutor.searchable', '==', true)
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
    const requestsSnap = await db.collection('studyContactRequests')
      .where('familyId', '==', callerFamilyId)
      .get();
    const latestRequest = new Map<string, { status: string; createdAtMs: number }>();
    requestsSnap.docs.forEach((d) => {
      const data = d.data();
      const tutorId = data.tutorUserId as string | undefined;
      if (!tutorId) return;
      const createdAtMs = data.createdAt?.toMillis
        ? data.createdAt.toMillis()
        : data.createdAt?.toDate
          ? data.createdAt.toDate().getTime()
          : 0;
      const prev = latestRequest.get(tutorId);
      if (!prev || createdAtMs >= prev.createdAtMs) {
        latestRequest.set(tutorId, { status: data.status as string, createdAtMs });
      }
    });

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

      // Filter: session location preference.
      if (params.filters?.locationPref && !tutor.locationPrefs?.includes(params.filters.locationPref)) {
        continue;
      }

      // Filter: max rate (against the MATCHED subject's rate).
      if (params.filters?.maxRate !== undefined && offering.rate > params.filters.maxRate) {
        continue;
      }

      // Contact fields only for families the tutor has approved. Computed BEFORE
      // the distance gate because an existing consent relationship overrides
      // geography: an approved family reaching this tutor (e.g. via the
      // accepted-request deep-link, which replays the family's saved latLng) must
      // never be filtered out by the tutor's radius or the maxDistanceKm filter.
      const contactApproved = (tutor.approvedFamilies ?? []).includes(callerFamilyId);

      // Distance + range gate.
      let distance: number | null = null;
      if (tutor.areaMode === 'distance' && tutor.areaLatLng && params.latLng) {
        distance = haversineDistance(tutor.areaLatLng, params.latLng);
        const cap = Math.min(
          tutor.areaRadiusKm ?? 5,
          params.filters?.maxDistanceKm ?? Infinity,
        );
        // Skip the cap entirely for approved families — relationship over
        // geography — but still compute+round the distance for display.
        if (!contactApproved && distance > cap) continue;
        distance = Math.round(distance * 10) / 10;
      } else if (tutor.areaMode === 'arrondissement') {
        // For now, include all arrondissement-based tutors — we still surface a
        // distance for sorting when both points are known.
        // TODO: reverse-geocode the search address to match arrondissements.
        if (tutor.areaLatLng && params.latLng) {
          distance = Math.round(haversineDistance(tutor.areaLatLng, params.latLng) * 10) / 10;
        }
      }

      // Whitelist the ACTIONABLE lifecycle statuses; anything else falls back to
      // 'none'. 'cancelled' is deliberately excluded here: a family that
      // withdrew its request is free to re-send, so search must surface the
      // tutor as 'none' (fresh) rather than echoing the withdrawn state. Any
      // other unrecognized stored value likewise can't leak into the payload.
      const KNOWN_REQUEST_STATUSES = ['pending', 'accepted', 'declined'] as const;
      const latest = latestRequest.get(uid);
      const requestStatus: TutorSearchResult['requestStatus'] =
        latest && (KNOWN_REQUEST_STATUSES as readonly string[]).includes(latest.status)
          ? (latest.status as TutorSearchResult['requestStatus'])
          : 'none';

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
        locationPrefs: tutor.locationPrefs || [],
        distance,
        endorsementCount: tutor.endorsementCount ?? 0,
        cancellationNoticeHours: tutor.cancellationNoticeHours ?? 0,
        requestStatus,
      };
      if (contactApproved) {
        result.contactEmail = tutor.contactEmail;
        result.contactPhone = tutor.contactPhone;
        result.whatsapp = tutor.whatsapp;
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
