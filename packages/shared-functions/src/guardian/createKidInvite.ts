import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '../config/adminConfig.js';
import {
  ageFromDob,
  kidIdentitySchema,
  KID_INVITE_VALIDITY_DAYS,
  validateEjmEmail,
} from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { sendPushNotification } from '../config/push.js';
import {
  GUARDIAN_SUCCESS,
  hashInviteToken,
  newInviteToken,
  requireCurrentConsent,
  requireFamilyParent,
  sendKidInviteEmail,
} from './shared.js';

interface CreateKidInviteData {
  kidEmail: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  consent: {
    tosVersion: string;
    privacyVersion: string;
    supervisionAgreementVersion: string;
  };
}

/**
 * Parent-created kid invitation (governance design ruling 6).
 *
 * ANTI-ENUMERATION INVARIANT: every branch below returns the shared
 * GUARDIAN_SUCCESS constant. The parent must not be able to distinguish
 * no-account / unsupervised-account / supervised-elsewhere from the response.
 * The only user-visible rejections (auth, input, consent versions) are
 * independent of the kid's account state. The audit log MAY record the branch
 * — admins are allowed to know what the parent must not.
 */
export const createKidInvite = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const callerUid = request.auth.uid;
    const data = request.data as CreateKidInviteData;
    const now = new Date();

    // 1. Caller must be a family parent.
    const { familyId } = await requireFamilyParent(callerUid);

    // 2. Validate the parent-entered identity + consent versions.
    const identityResult = kidIdentitySchema.safeParse(data);
    if (!identityResult.success) {
      throw new HttpsError(
        'invalid-argument',
        identityResult.error.issues[0]?.message || 'Invalid kid details',
      );
    }
    const identity = identityResult.data;
    const consent = requireCurrentConsent(data.consent, callerUid, now);

    // 3. EJM email format + graduation year (safe to reject — says nothing
    // about whether an account exists).
    const emailCheck = validateEjmEmail(data.kidEmail || '');
    if (!emailCheck.valid) {
      throw new HttpsError('invalid-argument', emailCheck.error || 'Invalid EJM email');
    }
    const kidEmailLower = data.kidEmail.trim().toLowerCase();

    const familyNameRaw: string | undefined = (
      await db.collection('families').doc(familyId).get()
    ).data()?.familyName;
    const familyName: string = familyNameRaw || 'your';

    const audit = (branch: string, details: Record<string, unknown> = {}) =>
      writeUserActivity(callerUid, 'guardian.create_kid_invite', {
        kidEmailLower,
        familyId,
        branch,
        ...details,
      });

    // 4. Branch on account state. All outcomes return GUARDIAN_SUCCESS.
    const accountSnap = await db
      .collection('users')
      .where('email', '==', kidEmailLower)
      .limit(1)
      .get();

    if (accountSnap.empty) {
      // ── No account → kid-account invite (dedup: same email+family pending
      // invite is treated as a resend — token rotates, clock resets). ──
      const existing = await db
        .collection('kidInvites')
        .where('kidEmailLower', '==', kidEmailLower)
        .where('familyId', '==', familyId)
        .get();
      const pending = existing.docs.find((d) => d.data().status === 'pending');

      const rawToken = newInviteToken();
      const expiresAt = new Date(now.getTime() + (await getConfigValue('kidInviteValidityDays')) * 86400_000);

      if (pending) {
        await pending.ref.update({
          tokenHash: hashInviteToken(rawToken),
          expiresAt,
          resentAt: now,
        });
        await sendKidInviteEmail(kidEmailLower, pending.data().firstName, familyName, rawToken);
        await audit('invite_resent', { inviteId: pending.id });
        return GUARDIAN_SUCCESS;
      }

      const inviteRef = await db.collection('kidInvites').add({
        kidEmailLower,
        firstName: identity.firstName,
        lastName: identity.lastName,
        dateOfBirth: identity.dateOfBirth,
        familyId,
        createdByParentUid: callerUid,
        tokenHash: hashInviteToken(rawToken),
        status: 'pending',
        createdAt: now,
        expiresAt,
        consent,
      });
      await sendKidInviteEmail(kidEmailLower, identity.firstName, familyName, rawToken);
      await audit('invite_created', { inviteId: inviteRef.id });
      return GUARDIAN_SUCCESS;
    }

    const childDoc = accountSnap.docs[0];
    const childUid = childDoc.id;
    const child = childDoc.data();
    const linkRef = db.collection('guardianLinks').doc(childUid);
    const link = (await linkRef.get()).data();

    if (link && link.familyId !== familyId && link.status !== 'revoked') {
      // ── Supervised (or claimed) by ANOTHER family → alert admin, create
      // nothing, tell the parent nothing (custody conflict / probing). ──
      await db.collection('adminAlerts').add({
        type: 'guardian_conflicting_claim',
        createdAt: now,
        data: {
          attemptedByUid: callerUid,
          familyId,
          kidEmailLower,
          existingLinkFamilyId: link.familyId,
        },
      });
      await audit('conflict_alerted', { childUid });
      return GUARDIAN_SUCCESS;
    }

    if (link && link.familyId === familyId && link.status === 'active') {
      // ── Same family already supervising → nothing to do. ──
      await audit('already_active', { childUid });
      return GUARDIAN_SUCCESS;
    }

    if (link && link.familyId === familyId && link.status === 'pending') {
      // ── Same-family claim already pending → idempotent refresh. ──
      await linkRef.update({ requestedAt: now });
      await audit('claim_refreshed', { childUid });
      return GUARDIAN_SUCCESS;
    }

    // ── Account exists, unsupervised (no link, or revoked) → silently becomes
    // an ask-to-supervise request. Parent-entered name/DOB are NOT applied;
    // existing accounts never get identityLocked. The kid confirms in-app. ──
    await linkRef.set({
      childUid,
      familyId,
      createdByParentUid: callerUid,
      status: 'pending',
      origin: 'claim',
      requestedAt: now,
      consent,
      // Denormalized so the kid-side card can name the asking family without
      // a families read (families are not child-readable).
      ...(familyNameRaw ? { familyName: familyNameRaw } : {}),
    });

    const title = 'Supervision request';
    const body = `A parent from the ${familyName} family asked to supervise your account`;
    await db.collection('notifications').add({
      recipientUserId: childUid,
      type: 'supervision_request',
      title,
      body,
      data: { familyId },
      read: false,
      channels: ['push'],
      emailSent: false,
      pushSent: false,
      createdAt: now,
    });
    await sendPushNotification(childUid, title, body, { type: 'supervision_request' }, 'auto');

    // Parent-entered identity materially differing from the account's stored
    // identity is a quiet admin signal (possible wrong kid / probing); the
    // parent-visible outcome is unchanged.
    const namesMatch =
      identity.firstName.trim().toLowerCase() === String(child.firstName || '').trim().toLowerCase() &&
      identity.lastName.trim().toLowerCase() === String(child.lastName || '').trim().toLowerCase();
    let dobMatches = true;
    if (child.dateOfBirth) {
      const storedDob: Date =
        typeof child.dateOfBirth.toDate === 'function'
          ? child.dateOfBirth.toDate()
          : new Date(child.dateOfBirth);
      dobMatches =
        Math.abs(ageFromDob(new Date(identity.dateOfBirth), now) - ageFromDob(storedDob, now)) <= 1;
    }
    if (!namesMatch || !dobMatches) {
      await db.collection('adminAlerts').add({
        type: 'guardian_claim_identity_mismatch',
        createdAt: now,
        data: { attemptedByUid: callerUid, familyId, kidEmailLower, childUid },
      });
    }

    await audit('claim_requested', { childUid });
    return GUARDIAN_SUCCESS;
  },
);
