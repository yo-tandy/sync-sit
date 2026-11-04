import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CONSENT_VERSION, consentVersionSchema, isCurrentConsentVersion } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/**
 * The member accepts the CURRENT consent documents again (issue #488
 * decision 1 -- the re-consent gate's one write).
 *
 * THE TARGET IS NEVER A PARAMETER: it is `request.auth.uid`. What the client
 * sends is the version it PRESENTED, and that must equal the live
 * CONSENT_VERSION -- a stale bundle showing last year's text must not be able
 * to stamp this year's version onto the record. It fails
 * `failed-precondition` / `consent/stale-client`, and the client's answer is
 * to reload, not retry.
 *
 * IDEMPOTENT ON A CURRENT RECORD. If the stored version is already current
 * (or one of its aliases -- `isCurrentConsentVersion`, the same rule the
 * gate reads) nothing is written: a double-tap, or a gate that raced its own
 * snapshot, must not mint a second "acceptance" the audit trail would then
 * have to explain.
 *
 * Otherwise the root `consentVersion`/`consentAt` pair moves to the newest
 * acceptance -- the `doEnrollDoer` convention (see `addProfileToUser`'s
 * docstring), since this IS the newest acceptance -- and the previous value
 * goes to the audit trail, which is where prior acceptances live.
 */
export const acknowledgeConsent = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = consentVersionSchema.safeParse(
      (request.data as { consentVersion?: unknown } | null)?.consentVersion,
    );
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'consentVersion is required');
    }
    if (parsed.data !== CONSENT_VERSION) {
      throw new HttpsError(
        'failed-precondition',
        'This app is out of date. Reload the page and try again.',
        { code: 'consent/stale-client', current: CONSENT_VERSION },
      );
    }

    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'User not found');
    }
    const previous = (snap.data()?.consentVersion as string | undefined) ?? null;

    if (isCurrentConsentVersion(previous)) {
      return { success: true, consentVersion: CONSENT_VERSION, alreadyCurrent: true };
    }

    const now = new Date();
    await ref.update({ consentVersion: CONSENT_VERSION, consentAt: now, updatedAt: now });
    await writeUserActivity(uid, 'acknowledge_consent', {
      previousConsentVersion: previous,
      consentVersion: CONSENT_VERSION,
    });

    return { success: true, consentVersion: CONSENT_VERSION, alreadyCurrent: false };
  },
);
