import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { haversineDistance, getParentProfile, getBabysitterView } from '@ejm/sit-core';
import type { LatLng, User, FirestoreTimestamp } from '@ejm/sit-core';
import { validateEjmEmail, checkEnrollmentAge, getEjemEmail, getContact } from '@ejm/shared-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';

interface SearchParams {
  type: 'one_time' | 'recurring';
  // One-time
  date?: string;
  startTime?: string;
  endTime?: string;
  // Recurring
  recurringSlots?: { day: string; startTime: string; endTime: string }[];
  // Common
  kidAges: number[];
  numberOfKids: number;
  latLng: LatLng;
  offeredRate?: number;
  filters: {
    minAge?: number;
    gender?: string;
    requireReferences?: boolean;
  };
}

interface BabysitterResult {
  uid: string;
  firstName: string;
  lastName: string;
  age: number;
  classLevel: string;
  languages: string[];
  photoUrl: string | null;
  aboutMe: string | null;
  kidAgeRange: { min: number; max: number };
  maxKids: number;
  hourlyRate: number;
  distance: number; // km
  referenceCount: number;
  contactEmail?: string;
  contactPhone?: string;
  isPreferred?: boolean;
}

function toDate(dob: string | Date | FirestoreTimestamp): Date {
  return typeof dob === 'string' ? new Date(dob) : dob instanceof Date ? dob : (dob as FirestoreTimestamp).toDate();
}

function calculateAge(dob: string | Date | FirestoreTimestamp): number {
  const birthDate = toDate(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return Math.floor((h * 60 + m) / 15);
}

const DAYS_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

export const searchBabysitters = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const params = request.data as SearchParams;

    // Verify the calling parent's family is fully verified
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    let preferredSet = new Set<string>();
    let callerFamilyId: string | undefined;
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (callerParent) {
      callerFamilyId = callerParent.familyId;
      if (callerFamilyId) {
        const callerFamilyDoc = await db.collection('families').doc(callerFamilyId).get();
        if (!callerFamilyDoc.data()?.verification?.isFullyVerified) {
          throw new HttpsError('permission-denied', 'Family verification required before searching for babysitters');
        }
        const preferred: string[] = callerFamilyDoc.data()?.preferredBabysitters || [];
        preferredSet = new Set(preferred);
      }
    }

    // 1. Get all searchable, active babysitters.
    // Filters on the Plan D profiles.babysitter shape: a doc with
    // profiles.babysitter.searchable == true necessarily has a babysitter
    // profile, so this subsumes the old role == 'babysitter' predicate.
    const usersSnap = await db.collection('users')
      .where('status', '==', 'active')
      .where('profiles.babysitter.searchable', '==', true)
      .get();

    console.log(`Found ${usersSnap.size} searchable babysitters`);
    if (usersSnap.empty) return { results: [] };

    // 2. Get reference counts (only published references are visible)
    const refsSnap = await db.collection('references')
      .where('status', 'in', ['approved', 'published'])
      .get();

    const refCounts = new Map<string, number>();
    refsSnap.docs.forEach((d) => {
      const babysitterId = d.data().babysitterUserId;
      refCounts.set(babysitterId, (refCounts.get(babysitterId) || 0) + 1);
    });

    // 3. Filter and score babysitters
    const results: BabysitterResult[] = [];

    for (const userDoc of usersSnap.docs) {
      // Flattened babysitter view (User + babysitter profile), tolerant of
      // both legacy flat docs and new profiles.babysitter docs.
      // Decode ONCE per candidate: the Node SDK rebuilds the object from the
      // proto on every data() call, and this loop reads it four times.
      const raw = userDoc.data() as User;
      const b = getBabysitterView(raw);
      if (!b) continue;
      const uid = userDoc.id;

      // Rate filter
      if (params.offeredRate && b.hourlyRate > params.offeredRate) continue;

      // Kid age range: babysitter must cover all kid ages
      const bMin = b.kidAgeRange?.min ?? 0;
      const bMax = b.kidAgeRange?.max ?? 18;
      const allKidsCovered = params.kidAges.every((age) => age >= bMin && age <= bMax);
      if (!allKidsCovered) continue;

      // Max kids
      if ((b.maxKids || 1) < params.numberOfKids) continue;

      // Area / distance
      let distance = 0;
      if (b.areaMode === 'distance' && b.areaLatLng && params.latLng) {
        distance = haversineDistance(b.areaLatLng, params.latLng);
        if (distance > (b.areaRadiusKm || 5)) continue;
      } else if (b.areaMode === 'arrondissement') {
        // For now, skip arrondissement matching — include all arrondissement-based babysitters
        // TODO: reverse-geocode the search address to get arrondissement
        if (b.areaLatLng && params.latLng) {
          distance = haversineDistance(b.areaLatLng, params.latLng);
        }
      }

      // Schedule availability check
      if (params.type === 'one_time' && params.date && params.startTime && params.endTime) {
        const scheduleSnap = await db.collection('schedules').doc(uid).get();
        if (scheduleSnap.exists) {
          const schedule = scheduleSnap.data()!;
          const dateObj = new Date(params.date + 'T00:00:00');
          const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const dayKey = dayNames[dateObj.getDay()];
          const daySlots: boolean[] = schedule.weekly?.[dayKey];

          if (daySlots) {
            const startIdx = timeToSlotIndex(params.startTime);
            const endIdx = timeToSlotIndex(params.endTime);
            let available = true;
            for (let i = startIdx; i < endIdx && i < 96; i++) {
              if (!daySlots[i]) { available = false; break; }
            }
            if (!available) continue;
          }

          // Check overrides for the specific date
          const overrideSnap = await db.collection('schedules').doc(uid)
            .collection('overrides').doc(params.date).get();
          if (overrideSnap.exists) {
            const override = overrideSnap.data()!;
            if (override.type === 'unavailable') continue;
            if (override.type === 'custom' && override.slots) {
              const startIdx = timeToSlotIndex(params.startTime);
              const endIdx = timeToSlotIndex(params.endTime);
              let available = true;
              for (let i = startIdx; i < endIdx && i < 96; i++) {
                if (!override.slots[i]) { available = false; break; }
              }
              if (!available) continue;
            }
          }
        }
      }

      // Filter: minimum age
      const babysitterAge = b.dateOfBirth ? calculateAge(b.dateOfBirth) : 0;
      if (params.filters.minAge && babysitterAge < params.filters.minAge) continue;

      // Age backstop (governance PR 1): sit has no server-side DOB at
      // enrollment, so search is the operative gate. A provider whose DOB says
      // under-15 is excluded outright; one whose DOB contradicts the EJM
      // email's graduation year beyond one class is excluded unless an admin
      // exemption exists (exemption doc read only on failure — rare path).
      // Missing DOB or unparseable stored email (legacy profiles) are NOT
      // excluded — the count script measures those first.
      // GOVERNED bypass (governance PR 2): a supervised account (server-owned
      // governedBy mirror, present iff its guardian link is ACTIVE) is
      // deliberately searchable at any age — supervision is its protection.
      // Read off the raw doc: the flattened view need not carry the mirror.
      const isGoverned = !!raw.governedBy;
      if (!isGoverned && b.dateOfBirth) {
        if (babysitterAge < 15) continue;
        // Canonical root ?? nested resolution (issue #203 shared identity).
        const babysitterEjemEmail = getEjemEmail(raw) || '';
        const emailCheck = validateEjmEmail(babysitterEjemEmail);
        if (emailCheck.valid && emailCheck.graduationYear !== undefined) {
          const verdict = checkEnrollmentAge({
            dateOfBirth: toDate(b.dateOfBirth),
            graduationYear: emailCheck.graduationYear,
          });
          // The floor is never waivable; only a mismatch consults exemptions.
          if (verdict === 'under_15') continue;
          if (verdict === 'age_mismatch') {
            const exemption = await db
              .collection('enrollmentExemptions')
              .doc(babysitterEjemEmail.toLowerCase())
              .get();
            if (!exemption.exists) continue;
          }
        }
      }

      // Filter: gender
      if (params.filters.gender && params.filters.gender !== 'any' && b.gender !== params.filters.gender) continue;

      // Filter: references
      const refCount = refCounts.get(uid) || 0;
      if (params.filters.requireReferences && refCount === 0) continue;

      // Only share contact info if babysitter has approved this family
      const approvedFamilies: string[] = b.approvedFamilies || [];
      const contactApproved = callerFamilyId ? approvedFamilies.includes(callerFamilyId) : false;
      const contact = getContact(raw);

      results.push({
        uid,
        firstName: b.firstName,
        lastName: b.lastName || '',
        age: babysitterAge,
        classLevel: b.classLevel,
        languages: b.languages || [],
        photoUrl: b.photoUrl || null,
        aboutMe: b.aboutMe || null,
        kidAgeRange: b.kidAgeRange || { min: 0, max: 18 },
        maxKids: b.maxKids || 1,
        hourlyRate: b.hourlyRate,
        distance: Math.round(distance * 10) / 10,
        referenceCount: refCount,
        // Contact projects from the canonical root ?? nested resolution so a
        // root-only Account edit (issue #203) reaches families immediately.
        contactEmail: contactApproved ? contact.contactEmail ?? undefined : undefined,
        contactPhone: contactApproved ? contact.contactPhone ?? undefined : undefined,
        isPreferred: preferredSet.has(uid),
      });
    }

    // Sort by distance (closest first), then by reference count (most first)
    results.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.referenceCount - a.referenceCount;
    });

    console.log(`Returning ${results.length} matching babysitters`);
    await writeUserActivity(request.auth!.uid, 'search_babysitters', { type: params.type, resultsCount: results.length });

    return { results };
  }
);
