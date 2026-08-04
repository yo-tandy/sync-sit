import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

// Enrollment exemptions (governance design §"Data model"): doc id is the
// lowercased EJM email; the doc's existence waives the DOB/grad-year
// CONSISTENCY check at the enrollment/search gates — never the under-15 floor.

const setExemptionSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
  note: z.string().max(500, 'Note must be 500 characters or fewer').optional(),
});

const removeExemptionSchema = z.object({
  email: z.string().trim().email('A valid email is required'),
});

/** Same normalization the enrollment callables apply to ejemEmail. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create (or overwrite) an enrollment exemption for an EJM email.
 */
export const setEnrollmentExemption = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const parsed = setExemptionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid exemption data',
      );
    }
    const email = normalizeEmail(parsed.data.email);

    await db.collection('enrollmentExemptions').doc(email).set({
      createdByUid: request.auth.uid,
      createdAt: new Date(),
      note: parsed.data.note ?? null,
    });

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'set_enrollment_exemption',
      details: { email, note: parsed.data.note ?? null },
    });

    return { success: true };
  },
);

/**
 * Remove an enrollment exemption.
 */
export const removeEnrollmentExemption = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const parsed = removeExemptionSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid exemption data',
      );
    }
    const email = normalizeEmail(parsed.data.email);

    await db.collection('enrollmentExemptions').doc(email).delete();

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'remove_enrollment_exemption',
      details: { email },
    });

    return { success: true };
  },
);

/**
 * List all enrollment exemptions (small admin-curated collection).
 */
export const listEnrollmentExemptions = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    await verifyAdmin(request.auth.uid);

    const snapshot = await db.collection('enrollmentExemptions').get();

    const exemptions = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        email: doc.id,
        note: data.note ?? null,
        createdByUid: data.createdByUid,
        createdAt: data.createdAt,
      };
    });

    return { exemptions };
  },
);
