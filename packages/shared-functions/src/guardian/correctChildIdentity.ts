import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { kidIdentitySchema } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { fanOutNameCorrections, type NameFanOutSummary } from '../identity/nameFanOut.js';
import { GUARDIAN_SUCCESS, resolveGuardianCaller } from './shared.js';

interface CorrectData {
  childUid: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

/**
 * Fix parent-attested identity on an identityLocked account — the rules pin
 * firstName/lastName/dateOfBirth client-side, so this callable (or admin) is
 * the only correction path. Caller must be a parent of the ACTIVE supervising
 * family; admin may correct regardless of link state (e.g. after revocation,
 * when the lock persists but no family holds supervision).
 */
export const correctChildIdentity = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const callerUid = request.auth.uid;
    const data = request.data as CorrectData;
    if (!data.childUid || typeof data.childUid !== 'string') {
      throw new HttpsError('invalid-argument', 'childUid is required');
    }

    const fieldsResult = kidIdentitySchema.partial().safeParse({
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
    });
    if (!fieldsResult.success) {
      throw new HttpsError(
        'invalid-argument',
        fieldsResult.error.issues[0]?.message || 'Invalid identity fields',
      );
    }
    const fields = fieldsResult.data;
    if (!fields.firstName && !fields.lastName && !fields.dateOfBirth) {
      throw new HttpsError('invalid-argument', 'At least one field to correct is required');
    }

    const { isAdminCaller, familyId } = await resolveGuardianCaller(callerUid);
    if (!isAdminCaller && !familyId) {
      throw new HttpsError(
        'permission-denied',
        'Only a parent with a family profile can manage supervision.',
        { code: 'guardian/not-a-family-parent' },
      );
    }
    if (!isAdminCaller) {
      const link = (await db.collection('guardianLinks').doc(data.childUid).get()).data();
      if (!link || link.status !== 'active' || link.familyId !== familyId) {
        throw new HttpsError(
          'failed-precondition',
          'This account is not under your supervision.',
          { code: 'guardian/not-supervised' },
        );
      }
    }

    const childRef = db.collection('users').doc(data.childUid);
    const child = (await childRef.get()).data();
    if (!child) {
      throw new HttpsError('not-found', 'User not found');
    }
    if (child.identityLocked !== true) {
      // Since issue #144 root identity is set-once for EVERY account, so
      // "manages its own identity" would be false — self-managed accounts
      // simply have no self-service correction path; admins intervene
      // directly when a real correction is needed.
      throw new HttpsError(
        'failed-precondition',
        'Identity corrections for this account require an administrator.',
        { code: 'guardian/not-identity-locked' },
      );
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (fields.firstName) {
      before.firstName = child.firstName;
      after.firstName = fields.firstName;
      updates.firstName = fields.firstName;
    }
    if (fields.lastName) {
      before.lastName = child.lastName;
      after.lastName = fields.lastName;
      updates.lastName = fields.lastName;
    }
    if (fields.dateOfBirth) {
      before.dateOfBirth = child.dateOfBirth?.toDate?.()?.toISOString()?.slice(0, 10) ?? null;
      after.dateOfBirth = fields.dateOfBirth;
      updates.dateOfBirth = Timestamp.fromDate(new Date(`${fields.dateOfBirth}T00:00:00Z`));
    }
    await childRef.update(updates);

    // Fan the corrected name out into the denormalized copies (issue #273) —
    // for a governed kid that is chiefly `tutorName` on their study docs.
    // AFTER the root update commits; a failed sweep is recorded in the audit
    // entry, never thrown. Same helper as admin correctUserIdentity.
    let fanOut: NameFanOutSummary | undefined;
    if (fields.firstName || fields.lastName) {
      fanOut = await fanOutNameCorrections(
        data.childUid,
        fields.firstName ?? (child.firstName as string) ?? '',
        fields.lastName ?? (child.lastName as string) ?? '',
      );
    }

    await writeAuditLog({
      adminUserId: callerUid,
      action: 'guardian.correct_child_identity',
      targetUserId: data.childUid,
      details: { before, after, byAdmin: isAdminCaller, ...(fanOut ? { fanOut } : {}) },
    });
    return GUARDIAN_SUCCESS;
  },
);
