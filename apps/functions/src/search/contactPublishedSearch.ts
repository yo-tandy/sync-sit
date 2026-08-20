import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { escapeHtml } from '../config/email.js';
import { getBabysitterView } from '@ejm/sit-core';
import type { User } from '@ejm/sit-core';
import { isActivePublishedSearch } from '@ejm/shared-core';
import { passesAgeBackstop } from './ageBackstop.js';

interface ContactPublishedSearchData {
  publishedSearchId: string;
  message?: string;
}

/**
 * contactPublishedSearch (issue #207 PR3, sit side): the CONTACT INVERSION.
 * An active babysitter answers a family's published search, minting an
 * appointment in exactly the shape `sendContactRequest` produces
 * (sendContactRequest.ts:97-124) so the whole downstream machinery -- the
 * family dashboard, respondToRequest, cancel/modify -- keeps working with the
 * roles flipped. Two fields mark the inversion: `initiatedBy: 'babysitter'`
 * and `publishedSearchId`.
 *
 * ADDRESS WITHHELD UNTIL CONSENT: any active babysitter may initiate here
 * (that widened audience is the feature), so the family's address, latLng,
 * photo, pets and private note are NOT copied onto the pending appointment.
 * They are filled in by respondToRequest's family-accept branch -- disclosure
 * follows the family's yes, never precedes it.
 *
 * AGE BACKSTOP: sit's only operative age gate lives in the search path
 * (searchBabysitters.ts:184-194 after the extraction, formerly the inline
 * block at :197-227). A published search must not be a route around it, so the
 * SAME function runs here -- see ./ageBackstop.ts.
 *
 * Liveness is re-checked server-side at contact time: withdraw is a client
 * delete and expiry is a field + daily sweep, so the board a sitter is looking
 * at may be stale by seconds or by a day.
 */
export const contactPublishedSearch = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as ContactPublishedSearchData;

    if (!data?.publishedSearchId || typeof data.publishedSearchId !== 'string') {
      throw new HttpsError('invalid-argument', 'publishedSearchId is required');
    }
    if (data.message !== undefined && (typeof data.message !== 'string' || data.message.length > 1000)) {
      throw new HttpsError('invalid-argument', 'message too long');
    }

    // ── Caller gate: an ACTIVE babysitter. `status` is the hard ban gate;
    // `searchable` is deliberately NOT consulted -- a sitter hidden from
    // search may still answer a published search (that is the point of the
    // board), they just cannot be found by a family's own search. ──
    const callerSnap = await db.collection('users').doc(uid).get();
    const callerRaw = callerSnap.data() as (User & { governedBy?: unknown }) | undefined;
    if (!callerSnap.exists || callerRaw?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Your account is not active');
    }
    const sitter = getBabysitterView(callerRaw);
    if (!sitter) {
      throw new HttpsError('permission-denied', 'Only babysitters can contact published searches');
    }
    // enrollmentComplete is required here, matching the board's READ rule
    // (firestore.rules) and searchTutors' equivalent. Callables are reachable
    // regardless of rules, and an account that stopped mid-enrollment has no
    // DOB yet (it is collected in the wizard) -- which would land in the age
    // backstop's legacy missing-DOB tolerance and pass unconditionally, i.e.
    // exactly the route around the age gate this callable exists to close
    // (PR #212 review).
    if (!sitter.enrollmentComplete) {
      throw new HttpsError('permission-denied', 'Finish your babysitter enrollment first');
    }
    if (!(await passesAgeBackstop({
      governed: !!callerRaw.governedBy,
      // Root identity field, read off the RAW doc like governedBy above.
      // Sourcing it from the flattened view is fail-OPEN: passesAgeBackstop
      // deliberately tolerates a falsy DOB (legacy profiles), so a view that
      // ever stops carrying it would silently pass every caller — the exact
      // hole the enrollmentComplete gate closes (PR #212 review).
      dateOfBirth: (callerRaw.dateOfBirth ?? sitter.dateOfBirth) as typeof sitter.dateOfBirth,
      // Read off the nested profile rather than the flattened view: PR #206
      // narrows BabysitterView to drop the root shared-identity quartet, and
      // ejemEmail is immutable + dual-written, so this resolves the same
      // value in both worlds. Post-#206 this becomes getEjemEmail(callerRaw).
      ejemEmail: ((callerRaw.profiles as Record<string, { ejemEmail?: string }> | undefined)
        ?.babysitter?.ejemEmail) ?? sitter.ejemEmail,
    }))) {
      throw new HttpsError('permission-denied', 'Your profile does not meet the minimum age requirements');
    }

    // ── The search itself: exists (withdraw is a delete), sit, unexpired. ──
    const searchRef = db.collection('publishedSearches').doc(data.publishedSearchId);
    const searchSnap = await searchRef.get();
    const now = new Date();
    if (!searchSnap.exists) {
      throw new HttpsError('failed-precondition', 'This published search is no longer available');
    }
    const search = searchSnap.data()!;
    if (search.app !== 'sit') {
      throw new HttpsError('failed-precondition', 'This published search is not a babysitting search');
    }
    if (!isActivePublishedSearch(search, now.getTime())) {
      throw new HttpsError('failed-precondition', 'This published search has expired');
    }

    const familyId = search.familyId as string;
    const familySnap = await db.collection('families').doc(familyId).get();
    const familyData = familySnap.data();
    if (!familyData) {
      throw new HttpsError('failed-precondition', 'This published search is no longer available');
    }
    // Re-check verification at CONTACT time, matching publishSearch and
    // sendContactRequest: a family can lose verification between publishing
    // and being answered, and this is the analogous match-making step
    // (PR #212 review). Stale board entries are swept by expiry, not by
    // verification changes, so the check has to be here.
    if (!familyData.verification?.isFullyVerified) {
      throw new HttpsError('failed-precondition', 'This published search is no longer available');
    }

    // ── Kid details rebuilt server-side from the search's kidIds: ages and
    // languages only, never names (the published doc carries no names either).
    const kids: { age: number; languages: string[] }[] = [];
    for (const kidId of (search.kidIds as string[]) || []) {
      const kidSnap = await db.collection('families').doc(familyId).collection('kids').doc(kidId).get();
      if (kidSnap.exists) {
        const k = kidSnap.data()!;
        kids.push({ age: k.age, languages: k.languages || [] });
      }
    }

    const appointmentRef = db.collection('appointments').doc();
    const appointment = {
      appointmentId: appointmentRef.id,
      // No `searches` doc is minted: the published search IS the search.
      // resubmitAppointment already tolerates a null searchId (:90).
      searchId: null,
      publishedSearchId: data.publishedSearchId,
      initiatedBy: 'babysitter',
      familyId,
      familyName: (familyData.familyName as string) || (search.familyName as string) || '',
      // Withheld until the family accepts (see the header note).
      familyPhotoUrl: null,
      babysitterUserId: uid,
      createdByUserId: uid,
      type: search.type,
      status: 'pending',
      date: search.date ?? null,
      startTime: search.startTime ?? null,
      endTime: search.endTime ?? null,
      recurringSlots: search.recurringSlots ?? null,
      schoolWeeksOnly: search.schoolWeeksOnly ?? false,
      kidIds: (search.kidIds as string[]) ?? [],
      kids,
      // Withheld until the family accepts (see the header note).
      address: null,
      latLng: null,
      offeredRate: search.offeredRate ?? null,
      message: data.message?.trim() || null,
      additionalInfo: search.additionalInfo ?? null,
      // Withheld until the family accepts (see the header note).
      pets: null,
      familyNote: null,
      createdAt: now,
      updatedAt: now,
    };

    // ── Dedupe + create in ONE transaction so two concurrent taps cannot both
    // pass the check (same reasoning as publishSearch's cap, PR #210 review).
    // Equality-only query -> no composite index needed. A rejected/cancelled
    // prior contact does NOT block a retry; a live one does. ──
    await db.runTransaction(async (tx) => {
      const priorSnap = await tx.get(
        db.collection('appointments')
          .where('babysitterUserId', '==', uid)
          .where('publishedSearchId', '==', data.publishedSearchId),
      );
      const live = priorSnap.docs.some((d) => {
        const status = d.data().status;
        return status === 'pending' || status === 'confirmed';
      });
      if (live) {
        throw new HttpsError('already-exists', 'You have already contacted this family about this search');
      }
      tx.set(appointmentRef, appointment);
    });

    // ── Notify the family (all parents), mirroring sendContactRequest's
    // sitter-side notification for the inverted direction. ──
    const sitterName = `${callerRaw.firstName ?? ''} ${callerRaw.lastName ?? ''}`.trim();
    const dateInfo = search.date
      ? `<p><strong>Date:</strong> ${escapeHtml(String(search.date))}${search.startTime ? `, ${escapeHtml(String(search.startTime))}` : ''}${search.endTime ? `–${escapeHtml(String(search.endTime))}` : ''}</p>`
      : '<p><strong>Schedule:</strong> Recurring</p>';
    const messageInfo = appointment.message
      ? `<p><strong>Message:</strong> ${escapeHtml(appointment.message)}</p>`
      : '';

    await notifyAllParents({
      familyId,
      prefCategory: 'newRequest',
      type: 'published_search_contact',
      title: 'A babysitter answered your published search',
      body: `${sitterName} is available for your published search.`,
      emailSubject: `${sitterName} answered your published search`,
      emailBody: `
      <p><strong>${escapeHtml(sitterName)}</strong> has answered your published babysitting search.</p>
      ${dateInfo}
      ${messageInfo}
      <p>Your address stays private until you accept.</p>
      <p style="margin-top: 16px;"><a href="https://sync-sit.com/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View request</a></p>
    `,
      data: { appointmentId: appointmentRef.id, publishedSearchId: data.publishedSearchId },
    });

    await writeUserActivity(uid, 'published_search_contacted', {
      publishedSearchId: data.publishedSearchId,
      appointmentId: appointmentRef.id,
    });

    return { appointmentId: appointmentRef.id };
  }
);
