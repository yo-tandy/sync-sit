import { createHash, randomBytes } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  getParentProfile,
  guardianConsentInputSchema,
  PRIVACY_POLICY_VERSION,
  SUPERVISION_AGREEMENT_VERSION,
  TOS_VERSION,
  type User,
} from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { SIT_APP_URL, escapeHtml, sendNotificationEmail } from '../config/email.js';

/**
 * The ONE success payload every createKidInvite branch returns. Anything a
 * branch would add here becomes an account-enumeration side channel — keep it
 * a single shared constant so the payloads cannot drift apart.
 */
export const GUARDIAN_SUCCESS = { success: true } as const;

export function newInviteToken(): string {
  return randomBytes(32).toString('hex');
}

/** Docs store only this hash; the raw token exists only in the invite email. */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Resolve the caller to their parent familyId, or reject. This is the only
 * caller-side gate of createKidInvite whose failure is user-visible — it does
 * not depend on the kid's account state.
 */
export async function requireFamilyParent(uid: string): Promise<{ familyId: string }> {
  const snap = await db.collection('users').doc(uid).get();
  const familyId = getParentProfile(snap.data() as User | undefined)?.familyId;
  if (!familyId) {
    throw new HttpsError(
      'permission-denied',
      'Only a parent with a family profile can manage supervision.',
      { code: 'guardian/not-a-family-parent' },
    );
  }
  return { familyId };
}

/**
 * Validate the consent payload and require the CURRENT document versions —
 * a stale client must re-present the documents before consenting on behalf
 * of a kid. Returns the full consent record to store.
 */
export function requireCurrentConsent(
  consent: unknown,
  approvedByUid: string,
  now: Date,
): {
  tosVersion: string;
  privacyVersion: string;
  supervisionAgreementVersion: string;
  approvedAt: Date;
  approvedByUid: string;
} {
  const parsed = guardianConsentInputSchema.safeParse(consent);
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      parsed.error.issues[0]?.message || 'Consent is required',
    );
  }
  const c = parsed.data;
  if (
    c.tosVersion !== TOS_VERSION ||
    c.privacyVersion !== PRIVACY_POLICY_VERSION ||
    c.supervisionAgreementVersion !== SUPERVISION_AGREEMENT_VERSION
  ) {
    throw new HttpsError(
      'invalid-argument',
      'The consent documents have been updated — please review and approve the current versions.',
      { code: 'guardian/stale-consent' },
    );
  }
  return { ...c, approvedAt: now, approvedByUid };
}

/**
 * Resolve the caller for guardian authorization: admin flag + parent familyId
 * (either may be absent).
 */
export async function resolveGuardianCaller(
  uid: string,
): Promise<{ isAdminCaller: boolean; familyId?: string }> {
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.data() as (User & { isAdmin?: boolean }) | undefined;
  return {
    isAdminCaller: data?.isAdmin === true,
    familyId: getParentProfile(data)?.familyId,
  };
}

/** Email the kid their invite link. The RAW token appears here and nowhere else. */
export async function sendKidInviteEmail(
  kidEmail: string,
  firstName: string,
  familyName: string,
  rawToken: string,
): Promise<void> {
  const link = `${SIT_APP_URL}/kid-invite?token=${rawToken}`;
  await sendNotificationEmail(
    kidEmail,
    'Your parents invited you to Sync/Sit',
    `<p>Hi ${escapeHtml(firstName)},</p>
     <p>A parent from the ${escapeHtml(familyName)} family created a supervised Sync/Sit account
     for you. Click the link below to choose a password and finish enrolling:</p>
     <p><a href="${link}" style="color: #DC2626;">Accept your invitation</a></p>
     <p style="color: #6B7280; font-size: 14px;">This invitation expires in 7 days.
     If you weren't expecting it, you can safely ignore this email.</p>`,
  );
}
