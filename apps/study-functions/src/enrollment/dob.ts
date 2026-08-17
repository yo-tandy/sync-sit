/**
 * Normalize a stored users-doc dateOfBirth: a Firestore Timestamp on
 * study-created accounts, a "YYYY-MM-DD" string on sit-created ones.
 */
export function toDobDate(dob: unknown): Date | null {
  if (typeof dob === 'string' && dob) return new Date(dob);
  if (dob && typeof (dob as { toDate?: unknown }).toDate === 'function') {
    return (dob as { toDate: () => Date }).toDate();
  }
  return null;
}
