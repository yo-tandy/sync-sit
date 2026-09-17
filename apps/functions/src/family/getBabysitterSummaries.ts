import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { getParentProfile, getBabysitterView, haversineDistance } from '@ejm/sit-core';
import type { User } from '@ejm/sit-core';
import { getContact } from '@ejm/shared-core';

/**
 * What a family page may know about a babysitter it already has a
 * relationship with (preferred list, an appointment, a reference it
 * submitted). Deliberately its own shape, not `BabysitterSummary`: the
 * point of this callable (issue #529, PR2) is that the three by-uid pages
 * stop reading `users/{uid}` directly — the rule that allowed that also
 * handed over `dateOfBirth`, the root address, `ejemEmail`,
 * `approvedFamilies` and `fcmTokens`. `age` is derived here so the date
 * of birth never leaves the server.
 */
export interface BabysitterSummaryHit {
  uid: string;
  firstName: string;
  lastName: string;
  age?: number;
  classLevel?: string;
  languages?: string[];
  photoUrl?: string | null;
  aboutMe?: string | null;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
  hourlyRate?: number;
  cancellationNoticeHours?: number;
  worksInYourArea: boolean;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
}

const schema = z.object({
  uids: z.array(z.string().min(1).max(128)).min(1).max(50),
});

function ageFrom(dob: unknown): number | undefined {
  const d =
    typeof dob === 'string'
      ? new Date(dob)
      : (dob as { toDate?: () => Date } | null | undefined)?.toDate?.() ?? null;
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/**
 * getBabysitterSummaries (issue #529, PR2): the by-uid reads of the three
 * family pages — SubmittedEndorsementsPage (names for submitted
 * references), PreferredBabysittersPage (the preferred list's cards),
 * AppointmentsPage (the babysitter card on each appointment) — moved off
 * the client's direct `users/{uid}` reads so PR3 can narrow that rule.
 *
 * Population, unchanged: active babysitters (the rule only ever let
 * clients read those; anyone else is silently skipped, as the pages'
 * catch-and-skip already did). The `searchable` toggle is NOT applied —
 * a family's own preferred / booked babysitter stays visible to them.
 *
 * Contact (email / phone / WhatsApp) is projected only when the family
 * has a relationship the platform recognises: the babysitter approved
 * this family (`approvedFamilies`, the gate searchBabysitters and
 * lookupBabysitter apply) OR there is a CONFIRMED appointment between
 * them (what AppointmentsPage exists to show). Today the direct read
 * returned contact to any signed-in account; this is strictly narrower.
 * PreferredBabysittersPage never rendered contact, so nothing visible
 * changes there.
 *
 * Caller gate: an authenticated parent with a family. Reads only —
 * no audit entry, matching the direct reads it replaces.
 */
export const getBabysitterSummaries = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message || 'Invalid uids');
    }
    const uids = [...new Set(parsed.data.uids)];

    const callerDoc = await db.collection('users').doc(uid).get();
    const caller = getParentProfile(callerDoc.data() as User | undefined);
    if (!caller || !caller.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can look up babysitters');
    }
    const familyId = caller.familyId;
    const familyLatLng = (await db.collection('families').doc(familyId).get()).data()?.latLng;

    // One independent resolution per uid, in parallel (a 50-uid batch is
    // otherwise up to ~100 sequential round-trips), each isolated: a
    // transient read error or an unexpected doc shape drops THAT summary
    // only — the per-uid catch-and-skip the pages used to do client-side,
    // kept server-side (#534 review).
    const resolved = await Promise.all(
      uids.map(async (babysitterUid): Promise<BabysitterSummaryHit | null> => {
        try {
          const snap = await db.collection('users').doc(babysitterUid).get();
          if (!snap.exists) return null;
          const raw = snap.data() as User;
          if (raw.status !== 'active') return null;
          const view = getBabysitterView(raw);
          if (!view) return null;

          let worksInYourArea = false;
          if (view.areaMode === 'distance' && view.areaLatLng && familyLatLng) {
            worksInYourArea = haversineDistance(view.areaLatLng, familyLatLng) <= (view.areaRadiusKm || 5);
          } else if (view.areaMode === 'arrondissement') {
            worksInYourArea = true;
          }

          const approved = ((view.approvedFamilies as string[] | undefined) || []).includes(familyId);
          let related = approved;
          if (!related) {
            const apt = await db.collection('appointments')
              .where('familyId', '==', familyId)
              .where('babysitterUserId', '==', babysitterUid)
              .where('status', '==', 'confirmed')
              .limit(1)
              .get();
            related = !apt.empty;
          }
          // Root-first resolution (issue #203): the Account page writes contact
          // ROOT-ONLY; the nested copy is frozen at enrollment time.
          const contact = getContact(raw);

          return {
            uid: babysitterUid,
            firstName: view.firstName || '',
            lastName: view.lastName || '',
            age: ageFrom(view.dateOfBirth),
            classLevel: view.classLevel || undefined,
            languages: view.languages || undefined,
            photoUrl: view.photoUrl ?? null,
            aboutMe: view.aboutMe ?? undefined,
            kidAgeRange: view.kidAgeRange || undefined,
            maxKids: view.maxKids || undefined,
            hourlyRate: view.hourlyRate || undefined,
            cancellationNoticeHours: view.cancellationNoticeHours || undefined,
            worksInYourArea,
            // Keys omitted (not undefined) for unrelated families: the callable
            // encoder would serialise undefined as null and leak the key.
            ...(related
              ? {
                  contactEmail: contact.contactEmail ?? undefined,
                  contactPhone: contact.contactPhone ?? undefined,
                  whatsapp: contact.whatsapp ?? undefined,
                }
              : {}),
          };
        } catch (err) {
          console.warn('[getBabysitterSummaries] skipped one uid', babysitterUid, err);
          return null;
        }
      }),
    );
    const summaries = resolved.filter((s): s is BabysitterSummaryHit => s !== null);

    return { summaries };
  },
);
