import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { kidIdentitySchema } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';
import { fanOutNameCorrections, type NameFanOutSummary } from '../identity/nameFanOut.js';

// Root identity (firstName/lastName/dateOfBirth) is SET-ONCE for client
// writes (issue #144; rootIdentitySetOnce in firestore.rules), and the
// guardian correctChildIdentity callable only serves identityLocked accounts
// — claim-origin governed kids and self-managed accounts have no correction
// path (issue #158). This admin-gated, audited callable is the designed
// escape hatch: the rules bind clients, the Admin SDK write here is scoped
// to exactly the three root fields on the users doc, plus the issue #273
// fan-out that refreshes denormalized display-name COPIES of those fields
// (study-sessions / studyContactRequests / contactSharingRequests /
// study references — see identity/nameFanOut.ts for reach and limits).
const inputSchema = z
  .object({ targetUserId: z.string().min(1, 'targetUserId is required') })
  .merge(kidIdentitySchema.partial())
  .strict();

/**
 * Admin-only correction of a user's root identity
 * (firstName / lastName / dateOfBirth). Writes ONLY the provided fields;
 * audited with per-field before/after values.
 */
export const correctUserIdentity = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const parsed = inputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid identity fields',
      );
    }
    const { targetUserId, ...fields } = parsed.data;
    if (!fields.firstName && !fields.lastName && !fields.dateOfBirth) {
      throw new HttpsError('invalid-argument', 'At least one field to correct is required');
    }

    const userRef = db.collection('users').doc(targetUserId);
    const user = (await userRef.get()).data();
    if (!user) {
      throw new HttpsError('not-found', 'User not found');
    }

    // Same field handling as guardian/correctChildIdentity: only the
    // provided fields land in the update, DOB is stored as a Timestamp at
    // UTC midnight, and the audit entry carries before/after per field.
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (fields.firstName) {
      before.firstName = user.firstName ?? null;
      after.firstName = fields.firstName;
      updates.firstName = fields.firstName;
    }
    if (fields.lastName) {
      before.lastName = user.lastName ?? null;
      after.lastName = fields.lastName;
      updates.lastName = fields.lastName;
    }
    if (fields.dateOfBirth) {
      // The stored DOB has two live shapes: a Timestamp (server-written, e.g.
      // redeemKidInvite) or a raw 'YYYY-MM-DD' string (babysitter/tutor
      // enrollment writes it client-side — see StepProfile / ageBackstop's
      // union type). Record the before-value for both; the audit entry is the
      // compensating control for bypassing set-once, so it must not drop it.
      const rawDob = user.dateOfBirth;
      before.dateOfBirth =
        typeof rawDob === 'string'
          ? rawDob.slice(0, 10)
          : rawDob?.toDate?.()?.toISOString()?.slice(0, 10) ?? null;
      after.dateOfBirth = fields.dateOfBirth;
      updates.dateOfBirth = Timestamp.fromDate(new Date(`${fields.dateOfBirth}T00:00:00Z`));
    }
    await userRef.update(updates);

    // Audit BEFORE the fan-out: this entry is the compensating control for
    // bypassing set-once, so it must exist the moment the root update has
    // committed — the fan-out below is many round trips, and a timeout in
    // there must not leave an unaudited correction (PR #291 review).
    const auditRef = await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'user_identity_corrected',
      targetUserId,
      details: { before, after },
    });

    // Fan the corrected name out into the denormalized copies (issue #273).
    // AFTER the root update commits: the users doc is the source of truth and
    // a failed sweep must not fail the correction — partial outcomes land in
    // the audit entry's fanOut summary instead. DOB is never denormalized.
    if (fields.firstName || fields.lastName) {
      const fanOut: NameFanOutSummary = await fanOutNameCorrections(
        targetUserId,
        fields.firstName ?? (user.firstName as string) ?? '',
        fields.lastName ?? (user.lastName as string) ?? '',
      );
      try {
        await auditRef.update({ 'details.fanOut': fanOut });
      } catch (err) {
        // The correction and its audit entry are already committed; failing
        // the callable over the summary patch would misreport success as
        // failure. Log and return.
        console.error('correctUserIdentity: failed to record fanOut summary', {
          targetUserId,
          err,
        });
      }
    }

    return { success: true };
  },
);
