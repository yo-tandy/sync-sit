import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { haversineDistance } from '@ejm/shared';
import type { LatLng } from '@ejm/shared';
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

function calculateAge(dob: string | Date): number {
  const birthDate = typeof dob === 'string' ? new Date(dob) : dob instanceof Date ? dob : (dob as any).toDate();
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
    if (callerDoc.exists && callerDoc.data()?.role === 'parent') {
      const callerFamilyId = callerDoc.data()?.familyId;
      if (callerFamilyId) {
        const callerFamilyDoc = await db.collection('families').doc(callerFamilyId).get();
        if (!callerFamilyDoc.data()?.verification?.isFullyVerified) {
          throw new HttpsError('permission-denied', 'Family verification required before searching for babysitters');
        }
        const preferred: string[] = callerFamilyDoc.data()?.preferredBabysitters || [];
        preferredSet = new Set(preferred);
      }
    }

    // 1. Get all searchable, active babysitters
    const usersSnap = await db.collection('users')
      .where('role', '==', 'babysitter')
      .where('status', '==', 'active')
      .where('searchable', '==', true)
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
      const b = userDoc.data();
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
      const babysitterAge = calculateAge(b.dateOfBirth);
      if (params.filters.minAge && babysitterAge < params.filters.minAge) continue;

      // Filter: gender
      if (params.filters.gender && params.filters.gender !== 'any' && b.gender !== params.filters.gender) continue;

      // Filter: references
      const refCount = refCounts.get(uid) || 0;
      if (params.filters.requireReferences && refCount === 0) continue;

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
        contactEmail: b.contactEmail,
        contactPhone: b.contactPhone,
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
