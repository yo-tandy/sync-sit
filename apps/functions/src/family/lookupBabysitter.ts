import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { haversineDistance, getParentProfile, getBabysitterView } from '@ejm/sit-core';
import type { User, BabysitterSummary } from '@ejm/sit-core';
import { getEjemEmail, getContact, matchesProviderIdentity } from '@ejm/shared-core';
import { lookupBabysitterSchema } from '../validation/lookup.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { passesAgeBackstop } from '../search/ageBackstop.js';

/**
 * lookupBabysitter (issue #437): find a babysitter directly by name, email,
 * or phone — for a family who already knows who they're looking for and
 * doesn't want to hunt through search filters. The study twin, lookupTutor,
 * resolves the same way (name/email/phone, not study's retired personal
 * code) so both apps share one lookup pattern and one security bar.
 *
 * Caller gate matches searchBabysitters: a parent with a FULLY VERIFIED
 * family. Previously this callable only required an authenticated parent
 * with a familyId — an unverified family could look up any searchable
 * babysitter by name/email with none of search's guardrails. This closes
 * that gap rather than leaving direct lookup as the softer path in.
 */
export const lookupBabysitter = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = lookupBabysitterSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid search query',
      );
    }
    const { query } = parsed.data;

    // Verify caller is a parent with a fully-verified family.
    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can search babysitters');
    }
    const familyId = caller.familyId;
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before looking up babysitters');
    }
    const familyLatLng = familyData.latLng;

    const results: BabysitterSummary[] = [];

    // Search all babysitters — same effective-searchability predicate as
    // searchBabysitters.ts (issue #435 PR2): `effectiveSearchable` folds in
    // status === 'active' + the searchable toggle + enrollmentComplete. This
    // ALSO closes a pre-existing gap here specifically: unlike
    // searchBabysitters, this callable never checked enrollmentComplete
    // before, so a mid-enrollment babysitter with searchable somehow true
    // could previously surface in a direct-lookup match; effectiveSearchable
    // cannot be true until enrollment is complete, closing that hole too.
    const snap = await db.collection('users')
      .where('profiles.babysitter.effectiveSearchable', '==', true)
      .get();

    for (const doc of snap.docs) {
      // Decode once; the flattened view is for the display fields, but
      // getEjemEmail/getContact MUST see the RAW doc — the view spreads the
      // nested profile over the root, which would invert root-first precedence.
      const raw = doc.data() as User;
      const data = getBabysitterView(raw);
      if (!data) continue;
      // Canonical root ?? nested resolution (issue #203 shared identity).
      const ejemEmail = getEjemEmail(raw) || '';
      const contact = getContact(raw);

      if (!matchesProviderIdentity(query, {
        fullName: `${data.firstName || ''} ${data.lastName || ''}`,
        email: data.email || '',
        ejemEmail,
        contactPhone: contact.contactPhone,
        whatsapp: contact.whatsapp,
      })) continue;

      // Age backstop (searchBabysitters.ts / contactPublishedSearch.ts,
      // ./ageBackstop.ts): the only operative provider-side age gate, and
      // this lookup is a THIRD path to the same babysitter data — one that
      // now also matches by phone/WhatsApp, widening the discovery surface
      // further. Skipping it here would let a family reach an under-15 or
      // grad-year-mismatched profile that searchBabysitters would exclude.
      if (!(await passesAgeBackstop({
        governed: !!raw.governedBy,
        dateOfBirth: data.dateOfBirth,
        ejemEmail,
      }))) continue;

      // Check if babysitter works in the family's area
      let worksInYourArea = false;
      if (data.areaMode === 'distance' && data.areaLatLng && familyLatLng) {
        const dist = haversineDistance(data.areaLatLng, familyLatLng);
        worksInYourArea = dist <= (data.areaRadiusKm || 5);
      } else if (data.areaMode === 'arrondissement') {
        // Arrondissement-based babysitters are considered available in general
        worksInYourArea = true;
      }

      // Only share contact info if this family is already approved — same
      // rule as searchBabysitters; contact projects from the canonical
      // root ?? nested resolution above.
      const approvedFamilies: string[] = data.approvedFamilies || [];
      const contactApproved = approvedFamilies.includes(familyId);

      results.push({
        uid: doc.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        photoUrl: data.photoUrl || null,
        classLevel: data.classLevel || '',
        languages: data.languages || [],
        aboutMe: data.aboutMe || null,
        // Defaults match searchBabysitters.ts exactly, for consistency
        // between the two "same bar" surfaces.
        kidAgeRange: data.kidAgeRange || { min: 0, max: 18 },
        maxKids: data.maxKids || 1,
        worksInYourArea,
        // Keys are omitted (not set to undefined) because the callable
        // encoder serialises undefined as null, which would leak a
        // `contactEmail: null` key to unapproved families.
        ...(contactApproved
          ? {
              contactEmail: contact.contactEmail ?? undefined,
              contactPhone: contact.contactPhone ?? undefined,
              whatsapp: contact.whatsapp ?? undefined,
            }
          : {}),
      });

      if (results.length >= 10) break;
    }

    await writeUserActivity(uid, 'babysitter_identity_lookup', { query, matchCount: results.length });

    return { results };
  }
);
