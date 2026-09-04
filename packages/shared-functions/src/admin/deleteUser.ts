import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { ageFromDob, getUserRole, getParentProfile, type User } from '@ejm/shared-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { escapeHtml, sendAdminNotification } from '../config/email.js';
import { REFERENCE_PROVIDER_KEYS } from './referenceKeys.js';
import { eraseDoUserData } from './doGdpr.js';
import { raisePartialErasureAlert } from './partialErasureAlert.js';
import { eraseStudyUserData } from './studyGdpr.js';
import { createClaimReleaser, SIT_PROVENANCE } from '../schedule/claimRelease.js';
import type { SessionBlockEntry } from '../schedule/sessionOverride.js';

interface DeleteUserInput {
  targetUserId: string;
}

/** One queued write. Collected first, committed in chunks below. */
type BatchOp = (batch: FirebaseFirestore.WriteBatch) => void;

/**
 * Commit queued writes in chunks of 400, the way `doGdpr`'s `deleteAll` does.
 *
 * A single `db.batch()` rejects past 500 operations, and three of this
 * erasure's steps queue one op per matching document with no bound:
 * appointments, notifications, and `schedules/{uid}/overrides` — which is one
 * doc per DATE, so an active sitter clears 500 in about two years of marked
 * availability.
 *
 * The failure that guard prevents is not "the delete is slow": step 1 has
 * already committed by then, so a rejected step 3 leaves appointments
 * cancelled, no user document deleted, no audit entry, no
 * `partial_user_erasure` alert, and an `INTERNAL` to the caller — and every
 * retry fails at exactly the same place. Inherited from the admin path, where
 * it was rare and supervised; `deleteMyAccount` (#368) puts it behind a row in
 * front of every member, which is the same argument this PR makes about the
 * #420 notification gap.
 */
async function commitInChunks(ops: BatchOp[]): Promise<void> {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + 400)) op(batch);
    await batch.commit();
  }
}

/**
 * What deleting a member actually removes — the erasure itself, with no view
 * on WHO asked for it.
 *
 * A GDPR-compliant hard delete: it removes the user's personal data from
 * Firestore, anonymizes appointment references, anonymizes their study
 * sessions and releases the schedule claims a cancel leaves behind, deletes
 * their schedule and overrides, deletes their references and endorsements
 * (both as provider and as submitter), erases their sync-do tasks/offers and
 * both the `do-photos` and `do-uploads` object prefixes (scrubbing the
 * dangling `{uid, photoId}` entries off a co-parent's surviving tasks and
 * cancelling any surviving task assigned to them), and deletes the Firebase
 * Auth account.
 *
 * Extracted so the admin callable and the member's own
 * `deleteMyAccount` (issue #368) run the SAME code. The alternative was a
 * second delete path, and then two answers to "what does deleting a member
 * remove" — which is how orphaned data gets left behind. The caller is
 * responsible for authorising the delete and for the audit trail; this
 * function assumes that has already happened.
 *
 * `actorUid` is recorded on the guardian links this revokes -- for an admin
 * delete that is the admin, for a self-delete it is the member themselves,
 * which is the honest value in both cases.
 *
 * Throws `not-found` if the user document is gone.
 */
export async function eraseUserAccount(targetUserId: string, actorUid: string) {
  const userRef = db.collection('users').doc(targetUserId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new HttpsError('not-found', 'User not found');
  }

  const userData = userDoc.data()!;
  const role = getUserRole(userData as User);
  const familyId = getParentProfile(userData as User)?.familyId || null;
  const email = userData.email || '';

  // 1. Cancel active/pending appointments and anonymize user references
  const babysitterAppts = await db
    .collection('appointments')
    .where('babysitterUserId', '==', targetUserId)
    .get();

  const familyAppts = familyId
    ? await db
        .collection('appointments')
        .where('familyId', '==', familyId)
        .get()
    : { docs: [] as any[] };

  const batch1Ops: BatchOp[] = [];
  let cancelledCount = 0;
  /**
   * Appointments cancelled on the FAMILY side, whose babysitter SURVIVES —
   * their schedule claim has to come back to them (step 1-bis). The
   * babysitter-side cancels below need no entry: those claims live on the
   * erased user's own `schedules/{uid}`, which step 3 deletes wholesale.
   */
  const sitClaimsToRelease: { appointmentId: string; babysitterUserId: string; date: string }[] =
    [];

  for (const appt of babysitterAppts.docs) {
    const data = appt.data();
    const updates: Record<string, any> = {
      babysitterUserId: 'deleted',
      // The deleted sitter AUTHORED the post-appointment note (issue
      // #238); the hard delete erases it immediately rather than leaving
      // their free text to the redaction cron's 7-day trail (or forever,
      // on a dateless recurring doc).
      postAppointmentNote: FieldValue.delete(),
    };
    if (data.status === 'pending' || data.status === 'confirmed') {
      updates.status = 'cancelled';
      updates.statusReason = 'account_deleted';
      cancelledCount++;
    }
    batch1Ops.push((b) => b.update(appt.ref, updates));
  }

  // For family appointments, only anonymize if this is the last parent
  let isLastParent = false;
  if (familyId && role === 'parent') {
    const familyDoc = await db.collection('families').doc(familyId).get();
    const parentIds: string[] = familyDoc.data()?.parentIds || [];
    isLastParent = parentIds.length <= 1;

    // Walk every family appointment.
    //   - Always anonymize `createdByUserId` if the deleted user was the
    //     creator, regardless of whether they are the last parent. Without
    //     this, a deleted co-parent's UID lingers on appointments the
    //     remaining co-parent still owns. (GDPR leak.)
    //   - Only cancel active appointments if this is the last parent —
    //     otherwise the family still exists and can honor them.
    for (const appt of (familyAppts as any).docs) {
      const data = appt.data();
      const updates: Record<string, any> = {};
      if (data.createdByUserId === targetUserId) {
        updates.createdByUserId = 'deleted';
      }
      if (isLastParent && (data.status === 'pending' || data.status === 'confirmed')) {
        updates.status = 'cancelled';
        updates.statusReason = 'account_deleted';
        cancelledCount++;
        if (
          data.status === 'confirmed' &&
          typeof data.date === 'string' &&
          typeof data.babysitterUserId === 'string' &&
          data.babysitterUserId !== targetUserId
        ) {
          sitClaimsToRelease.push({
            appointmentId: appt.id,
            babysitterUserId: data.babysitterUserId,
            date: data.date,
          });
        }
      }
      if (isLastParent && data.preAppointmentNote !== undefined) {
        // The FAMILY authored the pre-appointment note (issue #238; it is
        // family-level data, not per-parent — any parent may write it).
        // While a co-parent survives, the note stays theirs to manage;
        // when the LAST parent goes, the family's free text goes with it.
        updates.preAppointmentNote = FieldValue.delete();
      }
      if (Object.keys(updates).length > 0) {
        batch1Ops.push((b) => b.update(appt.ref, updates));
      }
    }
  }

  await commitInChunks(batch1Ops);

  // 1-bis. Give the SURVIVING babysitter back the slots the appointments
  // just cancelled above were holding (issue #408). `respondToRequest`
  // AND-blocks `schedules/{sitter}/overrides/{date}` and appends a
  // `sessionBlocks` ledger entry naming the appointment; `cancelAppointment`
  // gives them back, but this path never did — so erasing a family's last
  // parent left their babysitters with slots blocked forever by appointments
  // marked cancelled. Same defect class as item 4 (`admin/deleteAppointment`),
  // and the study half below would mint it fresh in the sibling app if it
  // were not fixed here too.
  //
  // `createClaimReleaser` is the ONE shared wrapper over `buildRestoredOverride`
  // — the lossless inverse every cancel path and both retention sweeps use —
  // so a cross-app STUDY claim on the same date is conserved and only this
  // appointment's slots reopen. Released AFTER the cancel commits, matching
  // `cancelAppointment`'s own order: a failed release leaves a blocked slot on
  // an already-cancelled appointment (benign, and exactly today's behaviour),
  // whereas releasing first and failing to cancel would reopen a slot on a
  // still-confirmed appointment — a double-booking.
  const now = new Date();
  const releaseClaim = createClaimReleaser(db, now);
  let sitClaimsReleased = 0;
  let claimReleaseErrors = 0;
  for (const claim of sitClaimsToRelease) {
    // Per-appointment isolation: one poisoned override must not abort an
    // erasure whose earlier steps have already committed.
    try {
      const released = await releaseClaim(
        claim.babysitterUserId,
        claim.date,
        (b: SessionBlockEntry) => b.appointmentId === claim.appointmentId,
        SIT_PROVENANCE,
      );
      if (released) sitClaimsReleased++;
    } catch (err) {
      claimReleaseErrors++;
      console.error(
        `deleteUser: failed to release the sit claim for ${claim.appointmentId}:`,
        err,
      );
    }
  }

  // 2. Delete all notifications for this user
  const notifications = await db
    .collection('notifications')
    .where('recipientUserId', '==', targetUserId)
    .get();

  await commitInChunks(notifications.docs.map((doc) => (b) => b.delete(doc.ref)));

  // 3. Delete the schedule document and its overrides subcollection.
  //
  // This used to be gated on `role === 'babysitter'` — issue #408 item 1, and
  // the most serious of the four. `getUserRole` returns the FIRST profile it
  // finds (babysitter → tutor → parent), so a tutor-only account never
  // entered this branch and kept `schedules/{uid}` plus every override doc
  // through a GDPR hard delete: their weekly availability grid, every date
  // they marked unavailable, and the `sessionBlocks` ledger naming the
  // sessions that claimed their slots. A dual-role student (tutor AND
  // babysitter) was covered only by the accident of the lookup order.
  //
  // The gate is gone rather than widened to `|| role === 'tutor'`, because
  // the role was never the right predicate: `schedules/{uid}` is ONE
  // per-user document shared by both apps (`ensureScheduleDoc`'s own
  // docblock says so), keyed by the subject's own uid, holding nothing but
  // their availability. There is no app split to gate on. A user who holds
  // no provider profile simply has no document and the delete is a no-op —
  // Firestore's delete on a missing document succeeds.
  const scheduleRef = db.collection('schedules').doc(targetUserId);
  const overrides = await scheduleRef.collection('overrides').get();
  await commitInChunks(overrides.docs.map((doc) => (b) => b.delete(doc.ref)));
  await scheduleRef.delete();
  const scheduleOverridesDeleted = overrides.docs.length;

  // 4. If parent and last parent: delete family doc + kids subcollection
  if (familyId && role === 'parent') {
    const familyRef = db.collection('families').doc(familyId);

    if (isLastParent) {
      // Delete kids subcollection
      const kids = await familyRef.collection('kids').get();
      await commitInChunks(kids.docs.map((doc) => (b) => b.delete(doc.ref)));

      // Delete family document
      await familyRef.delete();
    } else {
      // Remove this parent from the family's parentIds array
      const familyDoc = await familyRef.get();
      const parentIds: string[] = familyDoc.data()?.parentIds || [];
      await familyRef.update({
        parentIds: parentIds.filter((id) => id !== targetUserId),
      });
    }
  }

  // 4-bis. Guardian cleanup (governance PR 2).
  // As a CHILD: their link and the invites addressed to them are personal
  // data — remove both.
  // The link is READ BACK before it is deleted, and the supervising family
  // returned to the caller. Callers need it AFTER the erasure (the self-delete
  // path tells the guardian their supervised member is gone, #368) and by then
  // there is nothing left to look up. Capturing it here rather than asking
  // callers to read it first makes the ordering structural: a caller cannot
  // get it wrong, because the value only exists as a result of the erasure.
  const ownLink = (await db.collection('guardianLinks').doc(targetUserId).get()).data();
  const supervisingFamilyId =
    ownLink?.status === 'active' ? ((ownLink.familyId as string) ?? null) : null;
  await db.collection('guardianLinks').doc(targetUserId).delete();
  if (email) {
    const ownInvites = await db
      .collection('kidInvites')
      .where('kidEmailLower', '==', email.toLowerCase())
      .get();
    for (const doc of ownInvites.docs) {
      await doc.ref.delete();
    }
  }

  // As a PARENT: supervision is family-level, so a remaining co-parent
  // keeps every link untouched — only the deleted parent's uid is
  // anonymized off the invites they created (mirroring the appointment
  // createdByUserId anonymization above). When the LAST parent goes, the
  // family's supervision ends: every ACTIVE link is revoked and the
  // governedBy mirror removed; an under-15 child must not keep operating
  // unsupervised, so their account is hard-blocked (status is the ban
  // gate, matching blockUser semantics) and admin is alerted to resolve.
  // The dead family's pending invites are cancelled — redeeming one would
  // mint a link to a family that no longer exists.
  if (familyId && role === 'parent') {
    if (!isLastParent) {
      const createdInvites = await db
        .collection('kidInvites')
        .where('createdByParentUid', '==', targetUserId)
        .get();
      for (const doc of createdInvites.docs) {
        await doc.ref.update({ createdByParentUid: 'deleted' });
      }
    } else {
      const familyLinks = await db
        .collection('guardianLinks')
        .where('familyId', '==', familyId)
        .get();
      // `now` is the single deletion instant declared at step 1-bis: every
      // timestamp this erasure writes names the same moment.
      for (const linkDoc of familyLinks.docs) {
        if (linkDoc.data().status !== 'active') continue;
        const childUid = linkDoc.data().childUid;
        await linkDoc.ref.update({
          status: 'revoked',
          revokedAt: now,
          revokedByUid: actorUid,
        });
        const childRef = db.collection('users').doc(childUid);
        const child = (await childRef.get()).data();
        if (!child) continue;
        const dob = child.dateOfBirth?.toDate?.() ?? null;
        // A missing DOB cannot prove 15+, so it is treated as a minor.
        const isMinor = !dob || ageFromDob(dob) < 15;
        const childUpdates: Record<string, unknown> = {
          governedBy: FieldValue.delete(),
          updatedAt: now,
        };
        if (isMinor) {
          childUpdates.status = 'blocked';
        }
        await childRef.update(childUpdates);
        if (isMinor) {
          try {
            await adminAuth.updateUser(childUid, { disabled: true });
          } catch (err: any) {
            if (err.code !== 'auth/user-not-found') throw err;
          }
          await db.collection('adminAlerts').add({
            type: 'guardian_orphaned_minor',
            createdAt: now,
            data: { childUid, familyId, deletedParentUid: targetUserId },
          });
        }
      }
      const familyInvites = await db
        .collection('kidInvites')
        .where('familyId', '==', familyId)
        .get();
      for (const doc of familyInvites.docs) {
        const updates: Record<string, unknown> = {};
        if (doc.data().status === 'pending') updates.status = 'cancelled';
        if (doc.data().createdByParentUid === targetUserId) {
          updates.createdByParentUid = 'deleted';
        }
        if (Object.keys(updates).length > 0) {
          await doc.ref.update(updates);
        }
      }
    }
  }

  // 4-ter. References / endorsements (issue #295). A doc in the shared
  // `references` collection is personal data of BOTH parties, and erasure
  // deletes the WHOLE doc from either side:
  //   - PROVIDER erased (babysitterUserId / tutorUserId / future doerUserId
  //     == uid): the doc is ABOUT them — their name is its subject, and sit
  //     manual docs additionally hold third-party contact details the
  //     provider entered. Nothing in it survives their erasure.
  //   - SUBMITTER erased (submittedByUserId == uid): every substantive field
  //     is submitter-side personal data — submittedByName, refName, the
  //     refPhone/refWhatsapp/refEmail contacts, kid counts/ages, and the
  //     free-form family-authored referenceText. Stripping them (the
  //     appointment-style anonymization) would leave only type/status/
  //     timestamps: a contentless ghost endorsement with no operational or
  //     display value, unlike an anonymized appointment which still carries
  //     scheduling history the surviving party needs. So: full deletion.
  //   - LAST PARENT erased: the family's endorsements go with the family
  //     (submittedByFamilyId == familyId), mirroring how the family doc,
  //     kids and preAppointmentNote are erased — the endorsement text is
  //     family-authored, and the submitting family no longer exists to
  //     stand behind it. While a co-parent survives, only the docs the
  //     deleted parent personally submitted are removed.
  const refSnaps = await Promise.all([
    ...REFERENCE_PROVIDER_KEYS.map((key) =>
      db.collection('references').where(key, '==', targetUserId).get(),
    ),
    db.collection('references').where('submittedByUserId', '==', targetUserId).get(),
    familyId && isLastParent
      ? db.collection('references').where('submittedByFamilyId', '==', familyId).get()
      : Promise.resolve({ docs: [] as any[] } as any),
  ]);

  // Dedupe: a doc can match several keys (e.g. submitter erased as last
  // parent, so both submittedByUserId and submittedByFamilyId hit).
  const refDocsToDelete = Array.from(
    new Map(
      refSnaps.flatMap((snap: any) => snap.docs).map((doc: any) => [doc.ref.path, doc]),
    ).values(),
  ) as FirebaseFirestore.QueryDocumentSnapshot[];

  // Deleting an APPROVED study endorsement must decrement the surviving
  // tutor's denormalized profiles.tutor.endorsementCount — the counter is
  // otherwise only moved inside respondToTutorEndorsement's transaction,
  // whose comment assigns any removal flow the matching decrement. Sit has
  // no counter (searchBabysitters counts references live). Skip tutors who
  // are themselves the deletion target: their user doc dies in step 5.
  const tutorDecrements = new Map<string, number>();
  for (const doc of refDocsToDelete) {
    const data = doc.data();
    if (
      data.appSource === 'study' &&
      data.status === 'approved' &&
      typeof data.tutorUserId === 'string' &&
      data.tutorUserId !== targetUserId
    ) {
      tutorDecrements.set(data.tutorUserId, (tutorDecrements.get(data.tutorUserId) || 0) + 1);
    }
  }

  // Chunked like the other four batches (review round 6): a member with
  // 500+ reference/endorsement docs is far less reachable than the
  // schedule-overrides case, but it's the same defect class this file just
  // fixed, and the argument applies verbatim.
  await commitInChunks(refDocsToDelete.map((doc) => (b) => b.delete(doc.ref)));

  for (const [tutorUid, count] of tutorDecrements) {
    const tutorRef = db.collection('users').doc(tutorUid);
    const tutorSnap = await tutorRef.get();
    const current = tutorSnap.data()?.profiles?.tutor?.endorsementCount;
    // Guard against a missing tutor doc/profile (increment on update would
    // otherwise mint a stray negative counter) and clamp at zero.
    if (tutorSnap.exists && tutorSnap.data()?.profiles?.tutor) {
      await tutorRef.update({
        'profiles.tutor.endorsementCount': Math.max(0, (current ?? 0) - count),
      });
    }
  }

  // 4-quater. sync-do (plan §11.4): `doTasks` + `taskOffers` on BOTH sides,
  // the two uid-keyed Storage prefixes, and the dangling-reference scrub
  // that keeps a co-parent's surviving task from pointing at objects this
  // erasure just removed. Runs BEFORE the user doc is deleted so the
  // familyId/isLastParent decisions above still hold, and it takes the same
  // last-parent rule the family and endorsement steps take. See
  // `doGdpr.eraseDoUserData` for the four halves and their reasoning.
  const doErasure = await eraseDoUserData(targetUserId, familyId, isLastParent);

  // 4-quinquies. sync-study (issue #408 item 1). `deleteUser` never touched
  // `study-sessions` at all — not to delete, not to anonymize — so an erased
  // tutor's sessions kept their `tutorName` and an erased family's kept
  // `familyName`, `parentName`, the `students[]` roster (each child's first
  // name and age) and the family's home `address`/`latLng`. sit's appointments
  // have had the anonymize-and-cancel treatment since the first version of
  // this callable; this is the sibling app's half of the SAME engagement
  // record, with the fields study denormalizes that sit does not.
  //
  // Runs BEFORE the user doc is deleted so the familyId/isLastParent
  // decisions above still hold, and takes the same last-parent rule the
  // family, endorsement and sync-do steps take. See
  // `studyGdpr.eraseStudyUserData` for the per-field reasoning (and for why
  // the field-by-field pass lands on ANONYMIZE here where the identical pass
  // landed on DELETE for `references`).
  const studyErasure = await eraseStudyUserData(targetUserId, familyId, isLastParent, now);

  // 5. Delete the user document from Firestore
  await userRef.delete();

  // 6. Delete the Firebase Auth account entirely
  try {
    await adminAuth.deleteUser(targetUserId);
  } catch (err: any) {
    // Auth account may not exist (e.g. already deleted)
    if (err.code !== 'auth/user-not-found') {
      throw err;
    }
  }


  return {
    role,
    email,
    firstName: userData.firstName || '',
    lastName: userData.lastName || '',
    familyId,
    cancelledCount,
    isLastParent,
    refDocsDeleted: refDocsToDelete.length,
    doErasure,
    /** The family that supervised this member, captured before the link was deleted. */
    supervisingFamilyId,
    // issue #408 item 1 -- the study/schedule half of the erasure. Returned
    // rather than logged here so the CALLER owns the audit trail, which is the
    // whole point of the extraction.
    scheduleOverridesDeleted,
    sitClaimsReleased,
    studyErasure,
    claimReleaseErrors,
    now,
  };
}

/**
 * An ADMIN deletes another member's account.
 *
 * Everything this callable owns is authorisation and the trail: it checks for
 * an admin, names the target, and — after `eraseUserAccount` has run — writes
 * the audit entry, raises the partial-erasure alert and mails the admins. The
 * erasure itself is shared with `deleteMyAccount` (#368), which is the point
 * of the extraction: one answer to "what does deleting a member remove".
 */
export const deleteUser = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { targetUserId } = request.data as DeleteUserInput;

    if (!targetUserId) {
      throw new HttpsError('invalid-argument', 'targetUserId is required');
    }

    const erased = await eraseUserAccount(targetUserId, request.auth.uid);
    const {
      role,
      email,
      familyId,
      cancelledCount,
      isLastParent,
      refDocsDeleted,
      doErasure,
      scheduleOverridesDeleted,
      sitClaimsReleased,
      studyErasure,
      now,
    } = erased;

    // 7. Alert first, then log. The alert is what an operator acts on, and it
    // returns the same total the audit entry records — so the number in the
    // trail and the condition that raised the alarm cannot disagree.
    const erasureFailures = await raisePartialErasureAlert(targetUserId, erased, false);

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'delete_user',
      targetUserId,
      details: {
        // A user may hold no profile at all (e.g. a governed kid deleted
        // before enrolling) — undefined is not a Firestore value.
        role: role ?? null,
        email,
        cancelledAppointments: cancelledCount,
        familyDeleted: isLastParent && !!familyId,
        deletedReferences: refDocsDeleted,
        deletedDoTasks: doErasure.tasksDeleted,
        deletedDoOffers: doErasure.offersDeleted,
        deletedDoPhotoObjects: doErasure.photoObjectsDeleted,
        scrubbedDoTaskPhotos: doErasure.tasksScrubbed,
        clearedDoAssignments: doErasure.assignmentsCleared,
        releasedDoOfferSlots: doErasure.offerSlotsReleased,
        // issue #408 item 1 — counts only, no personal data (the
        // `deletedReferences` convention).
        deletedScheduleOverrides: scheduleOverridesDeleted,
        releasedAppointmentClaims: sitClaimsReleased,
        anonymizedStudySessions: studyErasure.sessionsAnonymized,
        cancelledStudySessions: studyErasure.sessionsCancelled,
        cancelledStudyInstances: studyErasure.instancesCancelled,
        scrubbedStudyInstances: studyErasure.instancesScrubbed,
        releasedStudyClaims: studyErasure.claimsReleased,
        // A non-zero value means the erasure was PARTIAL. It is recorded here,
        // shown in the admin email, and raised as an adminAlert — the user
        // document is gone by now, so `deleteUser` cannot simply be re-run and
        // a silent skip would leave un-anonymized personal data with nobody
        // aware of it.
        erasureFailures,
      },
    });

    await sendAdminNotification(
      `User deleted: ${email}`,
      `<p>Admin deleted a user account.</p>
       <p><strong>Name:</strong> ${escapeHtml(erased.firstName)} ${escapeHtml(erased.lastName)}</p>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Role:</strong> ${role}</p>
       <p><strong>Cancelled appointments:</strong> ${cancelledCount}</p>
       <p><strong>Cancelled study sessions:</strong> ${studyErasure.sessionsCancelled}</p>
       <p><strong>Family deleted:</strong> ${isLastParent && !!familyId ? 'Yes' : 'No'}</p>
       ${
         erasureFailures > 0
           ? `<p><strong>⚠ PARTIAL ERASURE:</strong> ${erasureFailures} cascade(s) failed — personal data may remain. See adminAlerts.</p>`
           : ''
       }`
    );

    return { success: true, cancelledAppointments: cancelledCount };
  }
);
