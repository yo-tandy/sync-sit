import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { haversineDistance } from '@ejm/shared';

interface LookupResult {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  classLevel: string;
  languages: string[];
  aboutMe: string | null;
  kidAgeRange: { min: number; max: number } | null;
  maxKids: number | null;
  worksInYourArea: boolean;
}

export const lookupBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { query } = request.data as { query: string };

    if (!query || query.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'Search query must be at least 2 characters');
    }

    // Verify caller is a parent and load family location
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = callerDoc.data();
    if (!caller || caller.role !== 'parent' || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can search babysitters');
    }

    const familyDoc = await db.collection('families').doc(caller.familyId).get();
    const familyLatLng = familyDoc.data()?.latLng;

    const q = query.trim().toLowerCase();
    const results: LookupResult[] = [];

    // Search all babysitters
    const snap = await db.collection('users')
      .where('role', '==', 'babysitter')
      .where('status', '==', 'active')
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      const fullName = `${data.firstName || ''} ${data.lastName || ''}`.toLowerCase();
      const email = (data.email || '').toLowerCase();
      const ejemEmail = (data.ejemEmail || '').toLowerCase();

      if (fullName.includes(q) || email === q || ejemEmail === q) {
        // Check if babysitter works in the family's area
        let worksInYourArea = false;
        if (data.areaMode === 'distance' && data.areaLatLng && familyLatLng) {
          const dist = haversineDistance(data.areaLatLng, familyLatLng);
          worksInYourArea = dist <= (data.areaRadiusKm || 5);
        } else if (data.areaMode === 'arrondissement') {
          // Arrondissement-based babysitters are considered available in general
          worksInYourArea = true;
        }

        results.push({
          uid: doc.id,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          photoUrl: data.photoUrl || null,
          classLevel: data.classLevel || '',
          languages: data.languages || [],
          aboutMe: data.aboutMe || null,
          kidAgeRange: data.kidAgeRange || null,
          maxKids: data.maxKids || null,
          worksInYourArea,
        });
      }

      if (results.length >= 10) break;
    }

    return { results };
  }
);
