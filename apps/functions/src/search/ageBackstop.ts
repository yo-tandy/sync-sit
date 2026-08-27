import { db } from '../config/firebase.js';
import { validateEjmEmail, checkEnrollmentAge } from '@ejm/shared-core';
import type { FirestoreTimestamp } from '@ejm/sit-core';

/**
 * The sit age backstop — sit has no server-side DOB check at enrollment, so
 * this is the ONLY operative age gate on the provider side. It was born inline
 * in `searchBabysitters` (governance PR 1, then PR 2's governed bypass); it
 * lives here because published searches (issue #207) opened a SECOND path to a
 * babysitter/family match, and a gate that exists in one copy per path is a
 * gate that eventually diverges. Both call sites now run this one function:
 * `searchBabysitters.ts` (result filter) and `contactPublishedSearch.ts`
 * (contact gate).
 *
 * Semantics, unchanged from the original inline block:
 * - a provider whose DOB says under-15 is excluded outright;
 * - one whose DOB contradicts the EJM email's graduation year beyond one class
 *   is excluded unless an admin exemption exists (the exemption doc is read
 *   only on failure — rare path);
 * - missing DOB or an unparseable stored email (legacy profiles) are NOT
 *   excluded — the count script measures those first;
 * - GOVERNED bypass: a supervised account (server-owned `governedBy` mirror,
 *   present iff its guardian link is ACTIVE) passes at any age — supervision
 *   is its protection. Read off the RAW user doc: the flattened babysitter
 *   view need not carry the mirror.
 */
export function toDate(dob: string | Date | FirestoreTimestamp): Date {
  return typeof dob === 'string' ? new Date(dob) : dob instanceof Date ? dob : (dob as FirestoreTimestamp).toDate();
}

export function calculateAge(dob: string | Date | FirestoreTimestamp): number {
  const birthDate = toDate(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

export async function passesAgeBackstop(provider: {
  /** `!!rawUserDoc.governedBy` — the server-owned active-supervision mirror. */
  governed: boolean;
  dateOfBirth?: string | Date | FirestoreTimestamp | null;
  ejemEmail?: string | null;
}): Promise<boolean> {
  if (provider.governed || !provider.dateOfBirth) return true;

  if (calculateAge(provider.dateOfBirth) < 15) return false;

  const emailCheck = validateEjmEmail(provider.ejemEmail || '');
  if (emailCheck.valid && emailCheck.graduationYear !== undefined) {
    const verdict = checkEnrollmentAge({
      dateOfBirth: toDate(provider.dateOfBirth),
      graduationYear: emailCheck.graduationYear,
    });
    // The floor is never waivable; only a mismatch consults exemptions.
    if (verdict === 'under_15') return false;
    if (verdict === 'age_mismatch') {
      const exemption = await db
        .collection('enrollmentExemptions')
        .doc((provider.ejemEmail as string).toLowerCase())
        .get();
      if (!exemption.exists) return false;
    }
  }
  return true;
}
