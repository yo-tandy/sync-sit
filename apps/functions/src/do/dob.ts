/**
 * Normalize a stored users-doc dateOfBirth: a Firestore Timestamp on
 * study/parent-created accounts, a "YYYY-MM-DD" string on sit-created ones.
 * Mirror of apps/study-functions/src/enrollment/dob.ts — the two codebases
 * deploy separately, so the six-line helper is duplicated rather than
 * hoisted (same call the tutor enrollment made).
 */
export function toDobDate(dob: unknown): Date | null {
  if (typeof dob === 'string' && dob) return new Date(dob);
  if (dob && typeof (dob as { toDate?: unknown }).toDate === 'function') {
    return (dob as { toDate: () => Date }).toDate();
  }
  return null;
}
