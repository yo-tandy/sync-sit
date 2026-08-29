import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { FieldValue } from 'firebase-admin/firestore';
import { joinFamilySchema } from '@ejm/sit-core';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { addProfileToUser } from './addProfileToUser.js';
import { assertCodeIdentityClass } from '../auth/verificationCodeClass.js';

interface JoinFamilyData {
  token: string;
  email: string;
  verificationCode: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const joinFamily = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as JoinFamilyData;
    const isAddProfile = !!request.auth;

    // 0. Validate inputs. Authed (add-profile) mode skips the schema, which
    // requires email/password/firstName — the caller already has an account.
    if (!isAddProfile) {
      const validationResult = joinFamilySchema.safeParse(data);
      if (!validationResult.success) {
        throw new HttpsError('invalid-argument', validationResult.error.issues[0]?.message || 'Invalid data');
      }
    }
    if (!data.token) {
      throw new HttpsError('invalid-argument', 'Invite token is required');
    }

    // 1. Validate invite token
    const inviteSnap = await db.collection('inviteLinks').doc(data.token).get();
    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'Invalid invite link');
    }

    const invite = inviteSnap.data()!;
    if (invite.used) {
      throw new HttpsError('failed-precondition', 'This invite link has already been used');
    }
    if (invite.expiresAt.toDate() < new Date()) {
      throw new HttpsError('deadline-exceeded', 'This invite link has expired');
    }

    const familyId = invite.familyId;

    // 2. Verify email code — new-account path only.
    let codeRef: FirebaseFirestore.DocumentReference | null = null;
    if (!isAddProfile) {
      const codeDoc = await db
        .collection('verificationCodes')
        .doc(data.email.toLowerCase())
        .get();

      if (!codeDoc.exists) {
        throw new HttpsError('not-found', 'No verification code found');
      }

      const codeData = codeDoc.data()!;

      // Joining a family as a second parent asserts nothing about EJM
      // membership — the invite token is the authorization, the code only
      // proves the joiner owns the mailbox. 'mailbox' (the class every issuer
      // produces) is exactly that. Stated rather than assumed (issue #322).
      // Unstamped legacy docs also read as 'mailbox', so no transitional gap.
      assertCodeIdentityClass(codeData, 'mailbox');

      if (codeData.expiresAt.toDate() < new Date()) {
        throw new HttpsError('deadline-exceeded', 'Verification code expired');
      }

      if ((codeData.attempts || 0) >= 5) {
        throw new HttpsError('resource-exhausted', 'Too many failed attempts. Request a new code.');
      }

      if (codeData.code !== data.verificationCode) {
        await codeDoc.ref.update({ attempts: (codeData.attempts || 0) + 1 });
        throw new HttpsError('invalid-argument', 'Invalid verification code');
      }

      codeRef = codeDoc.ref;
    }

    // 3. Verify family exists
    const familySnap = await db.collection('families').doc(familyId).get();
    if (!familySnap.exists) {
      throw new HttpsError('not-found', 'Family not found');
    }

    // 4. Resolve the uid — either the authed caller (add-profile) or a new
    // Firebase Auth user (new-account path).
    let uid: string;
    if (isAddProfile) {
      uid = request.auth!.uid;
    } else {
      try {
        const userRecord = await adminAuth.createUser({
          email: data.email.toLowerCase(),
          password: data.password,
          displayName: `${data.firstName} ${data.lastName}`,
        });
        uid = userRecord.uid;
      } catch (err: unknown) {
        const fbErr = err as { code?: string };
        if (fbErr.code === 'auth/email-already-exists') {
          // Race backstop only: reaching here requires a valid emailed code,
          // so this is not an enumeration oracle (the caller owns the
          // mailbox). No machine-readable reason — clients surface the
          // message as-is.
          throw new HttpsError('already-exists', 'An account with this email already exists');
        }
        throw new HttpsError('internal', 'Failed to create account');
      }
    }

    const now = new Date();

    // 5. Create / merge the parent user document. This MUST run before the
    // invite is consumed and before parentIds arrayUnion, so a profile-exists
    // rejection leaves the invite valid for a retry.
    if (isAddProfile) {
      await addProfileToUser({
        uid,
        profileKey: 'parent',
        profileData: { enrollmentComplete: true, familyId },
        fillBaseFields: {
          ...(data.firstName ? { firstName: data.firstName } : {}),
          ...(data.lastName ? { lastName: data.lastName } : {}),
          language: 'en',
        },
        auditAction: 'joined_family',
        auditDetails: { familyId },
      });
    } else {
      await db.collection('users').doc(uid).set({
        uid,
        email: data.email.toLowerCase(),
        status: 'active',
        firstName: data.firstName,
        lastName: data.lastName,
        language: 'en',
        profiles: {
          parent: {
            enrollmentComplete: true,
            familyId,
          },
        },
        notifPrefs: {
          newRequest: { push: true, email: true },
          confirmed: { push: true, email: true },
          cancelled: { push: true, email: true },
          reminders: { push: true, email: false },
        },
        fcmTokens: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    // 6. Add to family's parentIds (shared, both modes)
    await db.collection('families').doc(familyId).update({
      parentIds: FieldValue.arrayUnion(uid),
      updatedAt: now,
    });

    // 7. Mark invite as used (shared, both modes)
    await inviteSnap.ref.update({
      used: true,
      usedByUserId: uid,
    });

    // 8. Clean up verification code and audit — new-account path only; the
    // add-profile path audits via addProfileToUser with 'joined_family'.
    if (!isAddProfile) {
      if (codeRef) await codeRef.delete();
      await writeUserActivity(uid, 'joined_family', { familyId });
    }

    return { success: true, uid, familyId };
  }
);
