import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { escapeHtml, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import type { StudyUser, TutorProfile, SubjectOffering } from '@ejm/study-core';
import { sendFamilyContactRequestSchema } from '../validation/contact.js';
import { DECLINE_COOLDOWN_MS, latestDeclineMs } from './declineCooldown.js';

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
      throw new HttpsError('failed-precondition', 'You no longer offer this subject and level');
    }

    const familyId = search.familyId as string;

    // ── Already approved: contact is unlocked, there is nothing to request ──
    if ((tutor.approvedFamilies || []).includes(familyId)) {
      throw new HttpsError('failed-precondition', 'This family already has access to your contact details');
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
      throw new HttpsError('invalid-argument', 'This is your own family\'s search');
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
    // either direction is the same conversation.
    if (existingSnap.docs.some((d) => d.data().status === 'pending')) {
      throw new HttpsError('already-exists', 'You already have a pending request with this family');
    }

    // Cooldown on the FAMILY's decline of a tutor-initiated request: a "no"
    // holds for a week. Without it a tutor could re-mint on every tap and each
    // one notifies every parent of that family (sit's PR #212 review, same
    // rule, same window). A decline of a FAMILY-initiated request is the
    // tutor's own "no" and does not silence the tutor here.
    const declinedMs = latestDeclineMs(existingSnap.docs.map((d) => d.data()), 'tutor');
    if (declinedMs !== null && Date.now() - declinedMs < DECLINE_COOLDOWN_MS) {
      throw new HttpsError(
        'failed-precondition',
        'This family declined your last request. You can try again in a week.',
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
    await requestRef.set(doc);

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
