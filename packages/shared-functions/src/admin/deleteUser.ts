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

interface DeleteUserInput {
  targetUserId: string;
}

/**
 * GDPR-compliant hard delete: removes all user personal data from Firestore,
 * anonymizes appointment references, deletes their references/endorsements
 * (both as provider and as submitter), erases their sync-do tasks/offers and
 * both `do-photos`/`do-uploads` object prefixes (scrubbing the dangling
 * `{uid, photoId}` entries off a co-parent's surviving tasks and cancelling
 * any surviving task assigned to them), and deletes the Firebase Auth
 * account.
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

    const batch1 = db.batch();
    let batch1Ops = 0;
    let cancelledCount = 0;

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
      batch1.update(appt.ref, updates);
      batch1Ops++;
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
        }
        if (isLastParent && data.preAppointmentNote !== undefined) {
          // The FAMILY authored the pre-appointment note (issue #238; it is
          // family-level data, not per-parent — any parent may write it).
          // While a co-parent survives, the note stays theirs to manage;
          // when the LAST parent goes, the family's free text goes with it.
          updates.preAppointmentNote = FieldValue.delete();
        }
        if (Object.keys(updates).length > 0) {
          batch1.update(appt.ref, updates);
          batch1Ops++;
        }
      }
    }

    if (batch1Ops > 0) {
      await batch1.commit();
    }

    // 2. Delete all notifications for this user
    const notifications = await db
      .collection('notifications')
      .where('recipientUserId', '==', targetUserId)
      .get();

    if (notifications.docs.length > 0) {
      const batch2 = db.batch();
      for (const doc of notifications.docs) {
        batch2.delete(doc.ref);
      }
      await batch2.commit();
    }

    // 3. If babysitter: delete schedule and overrides
    if (role === 'babysitter') {
      const scheduleRef = db.collection('schedules').doc(targetUserId);

      // Delete overrides subcollection
      const overrides = await scheduleRef.collection('overrides').get();
      if (overrides.docs.length > 0) {
        const batch3 = db.batch();
        for (const doc of overrides.docs) {
          batch3.delete(doc.ref);
        }
        await batch3.commit();
      }

      // Delete schedule doc
      await scheduleRef.delete();
    }

    // 4. If parent and last parent: delete family doc + kids subcollection
    if (familyId && role === 'parent') {
      const familyRef = db.collection('families').doc(familyId);

      if (isLastParent) {
        // Delete kids subcollection
        const kids = await familyRef.collection('kids').get();
        if (kids.docs.length > 0) {
          const batch4 = db.batch();
          for (const doc of kids.docs) {
            batch4.delete(doc.ref);
          }
          await batch4.commit();
        }

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
        const now = new Date();
        for (const linkDoc of familyLinks.docs) {
          if (linkDoc.data().status !== 'active') continue;
          const childUid = linkDoc.data().childUid;
          await linkDoc.ref.update({
            status: 'revoked',
            revokedAt: now,
            revokedByUid: request.auth.uid,
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

    if (refDocsToDelete.length > 0) {
      const refBatch = db.batch();
      for (const doc of refDocsToDelete) {
        refBatch.delete(doc.ref);
      }
      await refBatch.commit();
    }

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

    // 7. Write audit log (only stores uid, not personal data)
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
        deletedReferences: refDocsToDelete.length,
        deletedDoTasks: doErasure.tasksDeleted,
        deletedDoOffers: doErasure.offersDeleted,
        deletedDoPhotoObjects: doErasure.photoObjectsDeleted,
        scrubbedDoTaskPhotos: doErasure.tasksScrubbed,
        clearedDoAssignments: doErasure.assignmentsCleared,
      },
    });

    await sendAdminNotification(
      `User deleted: ${email}`,
      `<p>Admin deleted a user account.</p>
       <p><strong>Name:</strong> ${escapeHtml(userData.firstName || '')} ${escapeHtml(userData.lastName || '')}</p>
       <p><strong>Email:</strong> ${escapeHtml(email)}</p>
       <p><strong>Role:</strong> ${role}</p>
       <p><strong>Cancelled appointments:</strong> ${cancelledCount}</p>
       <p><strong>Family deleted:</strong> ${isLastParent && !!familyId ? 'Yes' : 'No'}</p>`
    );

    return { success: true, cancelledAppointments: cancelledCount };
  }
);
