import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { strongPasswordSchema } from '@ejm/sit-core';
import { db, adminAuth } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { notifyAllParents } from '../config/notifyParents.js';
import { hashInviteToken } from './shared.js';

interface RedeemKidInviteData {
  token: string;
  password: string;
}

/**
 * ONE generic error for every way a token can be bad (unknown, expired,
 * cancelled, already redeemed, superseded by self-enrollment). The token is
 * an unauthenticated capability — its failure reason must not disclose
 * invite state.
 */
function invalidInvite(): HttpsError {
  return new HttpsError('not-found', 'This invitation is invalid or has expired.', {
    code: 'guardian/invalid-invite',
  });
}

/**
 * The kid redeems a parent-created invite: chooses a password, gets an
 * account carrying the parent-attested identity (identityLocked) and an
 * ACTIVE guardian link from birth. Unauthenticated by design — the token is
 * the capability. Returns { success, uid } like enrollBabysitter, after which
 * the client signs in with the kid's email + chosen password.
 */
export const redeemKidInvite = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    const data = request.data as RedeemKidInviteData;

    // 1. Resolve the token to a redeemable invite.
    if (!data.token || typeof data.token !== 'string') {
      throw invalidInvite();
    }
    const inviteSnap = await db
      .collection('kidInvites')
      .where('tokenHash', '==', hashInviteToken(data.token))
      .limit(1)
      .get();
    if (inviteSnap.empty) {
      throw invalidInvite();
    }
    const inviteRef = inviteSnap.docs[0].ref;
    const invite = inviteSnap.docs[0].data();
    if (invite.status !== 'pending') {
      throw invalidInvite();
    }
    const now = new Date();
    if (invite.expiresAt.toDate() < now) {
      await inviteRef.update({ status: 'expired' });
      throw invalidInvite();
    }

    // 2. Password.
    const passwordResult = strongPasswordSchema.safeParse(data.password);
    if (!passwordResult.success) {
      throw new HttpsError(
        'invalid-argument',
        passwordResult.error.issues[0]?.message || 'Password does not meet requirements',
      );
    }

    // 3. The kid may have self-enrolled since the invite went out. The invite
    // is then dead; the kid learns nothing they don't already know (it's
    // their own account).
    let accountExists = true;
    try {
      await adminAuth.getUserByEmail(invite.kidEmailLower);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') {
        throw err;
      }
      accountExists = false;
    }
    if (accountExists) {
      await inviteRef.update({ status: 'cancelled' });
      throw invalidInvite();
    }

    // 4. Create the Auth user + supervised account (mirrors the enrollment
    // callables' new-account path).
    let uid: string;
    try {
      const userRecord = await adminAuth.createUser({
        email: invite.kidEmailLower,
        password: data.password,
        displayName: invite.firstName,
      });
      uid = userRecord.uid;
    } catch {
      throw new HttpsError('internal', 'Failed to create account');
    }

    await db.collection('users').doc(uid).set({
      uid,
      email: invite.kidEmailLower,
      firstName: invite.firstName,
      lastName: invite.lastName,
      dateOfBirth: Timestamp.fromDate(new Date(`${invite.dateOfBirth}T00:00:00Z`)),
      status: 'active',
      language: 'en',
      profiles: {},
      notifPrefs: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
        reminders: { push: true, email: false },
      },
      fcmTokens: [],
      createdAt: now,
      updatedAt: now,
      consentAt: now,
      consentVersion: invite.consent.tosVersion,
      // Parent-attested identity is immutable client-side, permanently.
      identityLocked: true,
      // Mirror present iff the link is ACTIVE — which it is from birth here.
      governedBy: { familyId: invite.familyId, linkedAt: now },
    });

    const familyName: string | undefined = (
      await db.collection('families').doc(invite.familyId).get()
    ).data()?.familyName;

    await db.collection('guardianLinks').doc(uid).set({
      childUid: uid,
      familyId: invite.familyId,
      createdByParentUid: invite.createdByParentUid,
      status: 'active',
      origin: 'parent_created',
      requestedAt: invite.createdAt,
      confirmedAt: now,
      consent: invite.consent, // the GDPR consent record, copied verbatim
      // Denormalized so kid-side surfaces can name the supervising family
      // without a families read (families are not child-readable).
      ...(familyName ? { familyName } : {}),
    });

    await inviteRef.update({ status: 'accepted' });

    await notifyAllParents({
      familyId: invite.familyId,
      prefCategory: 'confirmed',
      type: 'guardian_invite_accepted',
      title: 'Invitation accepted',
      body: `${invite.firstName} accepted the invitation and created their account`,
      emailSubject: 'Your kid joined Sync/Sit',
      emailBody: `<p>${invite.firstName} accepted your invitation and created their supervised account.</p>`,
      data: { childUid: uid },
    });

    await writeUserActivity(uid, 'guardian.redeem_kid_invite', {
      inviteId: inviteRef.id,
      familyId: invite.familyId,
    });

    return { success: true, uid };
  },
);
