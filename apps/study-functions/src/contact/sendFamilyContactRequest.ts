import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { escapeHtml, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import type { StudyUser, TutorProfile, SubjectOffering } from '@ejm/study-core';
import { sendFamilyContactRequestSchema } from '../validation/contact.js';
import {
  latestDeclineMs,
  repairTimestamplessDeclines,
} from './declineCooldown.js';

// Cross-search ceiling (issue #233), the twin of sit's
// MAX_BOARD_CONTACTS_PER_DAY (contactPublishedSearch.ts). The per-pair guards
// below -- one open request per pair, plus the 7-day decline cooldown -- bound
// ONE (tutor, family) conversation and nothing else: a family may hold three
// live searches (PUBLISHED_SEARCH_MAX_ACTIVE) and the board carries every
// family's, so one tutor could answer all of them, each contact fanning out
// email + push + in-app to every parent of that family via notifyAllParents.
//
// The ceiling counts contacts CREATED in a rolling 24h window, REGARDLESS of
// their later status. A concurrent-pending count (what issue #233's text
// proposed) was tutor-bypassable for the same reason it was on the sit side:
// cancelContactRequest is deliberately cooldown-free, so withdrawing a pending
// returned the slot immediately, and five never-answering families could pin a
// tutor's board access shut forever. Creation spending the slot closes both --
// at most MAX_BOARD_CONTACTS_PER_DAY families can be notified per day, and
// slots return by clock, not by anyone's action (PR #232 review).

/**
 * sendFamilyContactRequest (issue #207 PR4, study side): the CONTACT
 * INVERSION. A tutor answers a family's published search, minting a
 * studyContactRequests doc in exactly the shape sendTutorContactRequest
 * produces (sendTutorContactRequest.ts:124-140) so everything downstream --
 * the family's requests list, the tutor's, cancelContactRequest -- keeps
 * working with the roles flipped. Two fields mark the inversion:
 * `initiatedBy: 'tutor'` and `publishedSearchId`.
 *
 * What the family's ACCEPT means here is the same terminal state as today's
 * tutor accept: familyId lands in the tutor's approvedFamilies, which is what
 * unlocks search, booking and propose. The tutor consented by initiating, so
 * the family's yes is the only missing half.
 *
 * The gates mirror the sit twin (contactPublishedSearch) plus the study-only
 * live-offering rule: a tutor who has since dropped the subject cannot answer
 * its demand.
 */
export const sendFamilyContactRequest = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = sendFamilyContactRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid request parameters',
      );
    }
    const { publishedSearchId, message } = parsed.data;

    // ── Caller gate: an ACTIVE tutor who finished enrollment. Same predicate
    // firestore.rules uses to let a tutor read the board at all, so a caller
    // who could not have seen the post cannot answer it either. ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerUser = callerDoc.data() as StudyUser | undefined;
    if (!callerDoc.exists || callerUser?.status !== 'active') {
      throw new HttpsError('permission-denied', 'Only active tutors can answer a published search');
    }
    const tutor: TutorProfile | undefined = callerUser.profiles?.tutor;
    if (!tutor?.enrollmentComplete) {
      throw new HttpsError('failed-precondition', 'Complete your tutor enrollment first');
    }
    // SEARCHABLE is required, even though the board itself is not gated on it
    // (PR #213 review). The family's only contact-reveal surface is
    // searchTutors -> TutorCard, and that query filters on
    // profiles.tutor.searchable == true. A hidden tutor could therefore be
    // accepted and STILL be unreachable: "View contact details" would land on
    // a search page without them, and "Book a session" would fall back to the
    // same query and error. Since enrollTutor writes searchable: false, that
    // would be the DEFAULT path for a new tutor. Blocking here keeps the
    // family's yes meaningful; the board stays browsable either way.
    if (tutor.searchable !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Turn on your profile visibility before contacting families',
        { reason: 'not_searchable' },
      );
    }

    // ── The published search ──
    const searchRef = db.collection('publishedSearches').doc(publishedSearchId);
    const searchSnap = await searchRef.get();
    const search = searchSnap.data();
    if (!searchSnap.exists || search?.app !== 'study') {
      throw new HttpsError('not-found', 'This published search no longer exists');
    }
    const expiresAtMs = search.expiresAt?.toMillis?.() ?? 0;
    if (expiresAtMs <= Date.now()) {
      throw new HttpsError('failed-precondition', 'This published search is no longer available');
    }

    const subject = search.subject as string;
    const level = search.level as string;

    // ── Live-offering: the tutor must still offer what the family asked for.
    // sendTutorContactRequest enforces this on the family's side; the demand
    // side needs it just as much, or a tutor who dropped a subject could still
    // answer its posts (and the family would book a subject they no longer
    // teach). ──
    const offers = (tutor.subjects || []).some(
      (o: SubjectOffering) => o.subject === subject && o.levels.includes(level),
    );
    if (!offers) {
      // Reachable on the ordinary path, not on stale state: the board is
      // deliberately unfiltered by the tutor's own subjects, so a card for a
      // subject they don't teach still shows its CTA (PR #213 review).
      throw new HttpsError(
        'failed-precondition',
        'You no longer offer this subject and level',
        { reason: 'subject_mismatch' },
      );
    }

    const familyId = search.familyId as string;

    // ── Already approved: contact is unlocked, there is nothing to request ──
    if ((tutor.approvedFamilies || []).includes(familyId)) {
      throw new HttpsError(
        'failed-precondition',
        'This family already has access to your contact details',
        { reason: 'already_approved' },
      );
    }

    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyDoc.exists) {
      throw new HttpsError('not-found', 'This family no longer exists');
    }
    // Not-self, the inverted form of sendTutorContactRequest's check: an
    // account can hold both a parent and a tutor profile, and a parent of the
    // publishing family answering their own post would end up accepting it as
    // a parent -- writing their own familyId into their own approvedFamilies
    // and polluting both requests lists (PR #213 review).
    if (((familyData?.parentIds as string[] | undefined) ?? []).includes(uid)) {
      throw new HttpsError('invalid-argument', 'This is your own family\'s search', {
        reason: 'own_family',
      });
    }
    // A family can lose verification between publishing and being answered,
    // and this is the match-making step -- the same reasoning the sit twin
    // uses (contactPublishedSearch, PR #212 review).
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('failed-precondition', 'This published search is no longer available');
    }

    // ── Existing requests for this (family, tutor) pair. Two equality filters,
    // so Firestore serves it without a composite index. ──
    const existingSnap = await db.collection('studyContactRequests')
      .where('tutorUserId', '==', uid)
      .where('familyId', '==', familyId)
      .get();

    // One open request per pair, whoever opened it: a pending request in
    // either direction is the same conversation. WHICH direction decides what
    // the tutor should do about it, so the reason says (PR #213 review) --
    // a family-initiated pending is one THEY have to answer, on their own
    // requests page, not something to wait on.
    const pending = existingSnap.docs.find((d) => d.data().status === 'pending');
    if (pending) {
      const mine = pending.data().initiatedBy === 'tutor';
      throw new HttpsError(
        'already-exists',
        mine
          ? 'You already have a pending request with this family'
          : 'This family has already contacted you — answer that request instead',
        { reason: mine ? 'pending_sent' : 'pending_incoming' },
      );
    }

    // Cooldown on the FAMILY's decline of a tutor-initiated request: a "no"
    // holds for a week. Without it a tutor could re-mint on every tap and each
    // one notifies every parent of that family (sit's PR #212 review, same
    // rule, same window). A decline of a FAMILY-initiated request is the
    // tutor's own "no" and does not silence the tutor here.
    // Anchor any timestampless decline before reading the window, so failing
    // closed lasts a week rather than forever (issue #214).
    await repairTimestamplessDeclines(existingSnap.docs, 'tutor');
    const declinedMs = latestDeclineMs(existingSnap.docs.map((d) => d.data()), 'tutor');
    const declineCooldownMs = (await getConfigValue('declineCooldownDays')) * 86400_000;
    if (declinedMs !== null && Date.now() - declinedMs < declineCooldownMs) {
      throw new HttpsError(
        'failed-precondition',
        `This family declined your last request. You can try again in ${Math.round(declineCooldownMs / 86400_000)} days.`,
        // The client distinguishes this from the generic "the search is gone"
        // failure on the reason, not on the message text.
        { reason: 'decline_cooldown' },
      );
    }

    // ── Create the request ──
    const now = new Date();
    const tutorName = `${callerUser.firstName || ''} ${callerUser.lastName || ''}`.trim();
    const requestRef = db.collection('studyContactRequests').doc();
    const doc: Record<string, unknown> = {
      requestId: requestRef.id,
      tutorUserId: uid,
      familyId,
      familyName: (familyData.familyName as string) || (search.familyName as string) || '',
      // The responding PARENT is unknown until they answer; the family accept
      // fills it, exactly as the family's own request carries the sender's.
      parentName: '',
      tutorName,
      createdByUserId: uid,
      initiatedBy: 'tutor',
      publishedSearchId,
      subject,
      level,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    if (message !== undefined) doc.message = message;

    // Cross-search ceiling. The count and the create share a transaction so
    // concurrent taps on different searches cannot each pass it -- the same
    // shape sit uses. It runs LAST, after every per-pair and per-search guard,
    // so a capped tutor still gets the more specific error where one applies
    // (PR #232 review). The orderBy+limit bounds the read to the newest MAX
    // docs; `status` is deliberately not filtered, because creation spent the
    // slot.
    //
    // Not moved into this transaction: the pair dedupe and the decline
    // cooldown above. The cooldown's repair pass (issue #214) writes through
    // the doc refs directly, which a transaction cannot carry, and the pair
    // dedupe's non-atomicity is pre-existing and unchanged by this PR.
    await db.runTransaction(async (tx) => {
      const boardCap = await getConfigValue('boardContactsPerDay');
      const boardWindowHours = await getConfigValue('boardContactWindowHours');
      const recentSnap = await tx.get(
        db.collection('studyContactRequests')
          .where('tutorUserId', '==', uid)
          .where('initiatedBy', '==', 'tutor')
          .orderBy('createdAt', 'desc')
          .limit(boardCap),
      );
      const windowFrom = Date.now() - boardWindowHours * 3600_000;
      const recentCount = recentSnap.docs.filter((d) => {
        const createdMs = d.data().createdAt?.toMillis?.();
        // A present-but-unreadable createdAt counts as recent (fail closed).
        // A doc MISSING the field entirely never reaches this filter: orderBy
        // excludes it from the query, so it is invisible to the cap -- fail
        // OPEN, acceptable only because this callable is the sole writer of
        // initiatedBy: 'tutor' and always stamps createdAt (PR #232 review).
        return typeof createdMs !== 'number' || createdMs > windowFrom;
      }).length;
      if (recentCount >= boardCap) {
        throw new HttpsError(
          'resource-exhausted',
          `You have contacted several families in the last ${boardWindowHours} hours. You can send more requests once the window passes.`,
          { reason: 'board_contact_cap' },
        );
      }
      tx.set(requestRef, doc);
    });

    // ── Notify the family (all parents), mirroring the tutor-side
    // notification for the inverted direction. ──
    await notifyAllParents({
      familyId,
      prefCategory: 'newRequest',
      app: 'study',
      type: 'study_published_search_contact',
      title: 'A tutor answered your published search',
      body: `${tutorName || 'A tutor'} is available for ${subject} (${level}).`,
      emailSubject: `${tutorName || 'A tutor'} answered your published search`,
      emailBody: `
        <p><strong>${escapeHtml(tutorName || 'A tutor')}</strong> has answered your published tutoring search.</p>
        <p><strong>Subject:</strong> ${escapeHtml(subject)} (${escapeHtml(level)})</p>
        ${message ? `<p><strong>Message:</strong> ${escapeHtml(message)}</p>` : ''}
        <p>Their contact details stay private until you accept.</p>
        <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View request</a></p>
      `,
      data: { requestId: requestRef.id },
    });

    await writeUserActivity(uid, 'published_search_contacted', {
      publishedSearchId,
      requestId: requestRef.id,
      familyId,
    });

    return { requestId: requestRef.id };
  },
);
