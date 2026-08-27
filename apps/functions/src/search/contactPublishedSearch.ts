import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { clampNoticeWindow } from '@ejm/shared-functions/schedule/lateCancellation.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { escapeHtml } from '../config/email.js';
import { getBabysitterView } from '@ejm/sit-core';
import type { User } from '@ejm/sit-core';
import { isActivePublishedSearch } from '@ejm/shared-core';
import { getEjemEmail } from '@ejm/shared-core';
import { passesAgeBackstop } from './ageBackstop.js';

interface ContactPublishedSearchData {
  publishedSearchId: string;
  message?: string;
}

/**
 * How long a family's decline of a provider-initiated contact silences new
 * contacts from that provider for the SAME published search (PR #212 review;
 * matches the study side's spec). Not a punishment — a family that declined
 * should not be re-notified on a tap.
 */
// Code defaults; admin-configurable since issue #250 (declineCooldownDays,
// boardContactsPerDay, boardContactWindowHours) -- read per call below.
const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// Cross-search ceiling (issue #225 item 3): per-search dedupe + cooldown bound
// one pair, but nothing bounded one sitter across DIFFERENT searches -- each
// successful contact emails + pushes every parent of that family. The ceiling
// counts board contacts CREATED in a rolling 24h window, REGARDLESS of their
// later status: a pending-only count was sitter-bypassable (withdraw a
// pending -- deliberately cooldown-free -- and the slot came straight back,
// PR #232 review), and it let five never-answering families hold a sitter's
// board access forever. Creation spending the slot closes both: at most
// MAX_BOARD_CONTACTS_PER_DAY families can be notified per day, and slots
// return by clock, not by anyone's action.
const MAX_BOARD_CONTACTS_PER_DAY = 5;
const BOARD_CONTACT_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      // ever stops carrying it would silently pass every caller -- the exact
      // hole the enrollmentComplete gate closes (PR #212 review).
      dateOfBirth: (callerRaw.dateOfBirth ?? sitter.dateOfBirth) as typeof sitter.dateOfBirth,
      // Canonical root ?? nested resolution (issue #203 shared identity) --
      // the shape this line was written to become once #206 landed --
      // same resolution searchBabysitters uses, so the two age-gate call
      // sites cannot disagree about which stored email is judged.
      ejemEmail: getEjemEmail(callerRaw) || '',
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
    // kidIds is rebuilt from the kids that ACTUALLY RESOLVED, not copied from
    // the published doc: publishSearch validates kidIds at publish time, but a
    // kid deleted between publishing and contact would otherwise leave the two
    // fields disagreeing on the same appointment — the dashboard card counts
    // apt.kidIds.length ("2 children") while the detail page renders kids
    // ("1 child, ages 6") (PR #212 review).
    const kids: { age: number; languages: string[] }[] = [];
    const resolvedKidIds: string[] = [];
    for (const kidId of (search.kidIds as string[]) || []) {
      const kidSnap = await db.collection('families').doc(familyId).collection('kids').doc(kidId).get();
      if (kidSnap.exists) {
        const k = kidSnap.data()!;
        kids.push({ age: k.age, languages: k.languages || [] });
        resolvedKidIds.push(kidId);
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
      // Notice-window snapshot (issue #237) -- same as sendContactRequest's.
      cancellationNoticeHours: clampNoticeWindow(sitter.cancellationNoticeHours),
      date: search.date ?? null,
      startTime: search.startTime ?? null,
      endTime: search.endTime ?? null,
      recurringSlots: search.recurringSlots ?? null,
      schoolWeeksOnly: search.schoolWeeksOnly ?? false,
      kidIds: resolvedKidIds,
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
    // Equality-only query -> no composite index needed.
    //
    // Two prior states block a new contact, for different reasons:
    //   - a LIVE one (pending/confirmed) is the plain duplicate;
    //   - a family DECLINE inside the cooldown. This PR's thesis is that
    //     disclosure follows an explicit yes, so letting a sitter re-mint a
    //     pending immediately after a "no" — each one emailing and pushing
    //     every parent of that family, with no cap — would let the sitter
    //     overrule the family's answer for as long as the search is up
    //     (PR #212 review). The window matches the study side's spec
    //     (docs/superpowers/plans/2026-08-19-published-searches.md, PR4 T1),
    //     so the two apps behave identically.
    // A contact the SITTER withdrew (cancelled_by_babysitter) is not a "no"
    // from the family and does not start a cooldown. ──
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
      const cooldownDays = await getConfigValue('declineCooldownDays').catch(() => DECLINE_COOLDOWN_MS / 86400_000);
      const cooldownFrom = Date.now() - cooldownDays * 86400_000;
      const boardCap = await getConfigValue('boardContactsPerDay').catch(() => MAX_BOARD_CONTACTS_PER_DAY);
      const boardWindowHours = await getConfigValue('boardContactWindowHours').catch(() => BOARD_CONTACT_WINDOW_MS / 3600_000);
      const recentlyDeclined = priorSnap.docs.some((d) => {
        const apt = d.data();
        if (apt.statusReason !== 'declined_by_family') return false;
        // A decline with no readable timestamp is treated as recent: the
        // cooldown must fail CLOSED, since the alternative re-notifies a
        // family that already said no.
        const declinedAtMs = apt.updatedAt?.toMillis?.();
        return typeof declinedAtMs !== 'number' || declinedAtMs > cooldownFrom;
      });
      if (recentlyDeclined) {
        throw new HttpsError(
          'failed-precondition',
          'This family declined your last request for this search. You can try again in a week.',
          // The client distinguishes this from the generic "search is gone"
          // failure on the reason, not on the message text.
          { reason: 'decline_cooldown' },
        );
      }
      // Cross-search ceiling -- inside the transaction so concurrent taps on
      // different searches cannot each pass the count, and AFTER the dedupe +
      // cooldown checks so a capped sitter still gets the more specific error
      // for those cases (PR #232 review). The orderBy+limit bounds the read to
      // the newest MAX docs (composite index in firestore.indexes.json);
      // status is deliberately not filtered -- creation spent the slot.
      const recentBoardSnap = await tx.get(
        db.collection('appointments')
          .where('babysitterUserId', '==', uid)
          .where('initiatedBy', '==', 'babysitter')
          .orderBy('createdAt', 'desc')
          .limit(boardCap),
      );
      const windowFrom = Date.now() - boardWindowHours * 3600_000;
      const recentCount = recentBoardSnap.docs.filter((d) => {
        const createdMs = d.data().createdAt?.toMillis?.();
        // A present-but-unreadable createdAt counts as recent (fail closed).
        // A doc MISSING the field entirely never reaches this filter at all:
        // orderBy excludes it from the query, so that case is invisible to
        // the cap -- fail OPEN, acceptable only because this callable is the
        // sole writer of initiatedBy: 'babysitter' and always stamps
        // createdAt (PR #232 review).
        return typeof createdMs !== 'number' || createdMs > windowFrom;
      }).length;
      if (recentCount >= boardCap) {
        throw new HttpsError(
          'resource-exhausted',
          'You have contacted several families in the last 24 hours. You can send more requests tomorrow.',
          { reason: 'board_contact_cap' },
        );
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
