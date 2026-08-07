import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { requireFamilyParent } from './shared.js';

/** Firestore Timestamp | Date | absent → ISO string | null, for payloads. */
export function iso(value: unknown): string | null {
  if (!value) return null;
  const d =
    value instanceof Date
      ? value
      : (value as { toDate?: () => Date }).toDate?.() ?? null;
  return d ? d.toISOString() : null;
}

/** Dashboard-level presence summary of a provider profile. */
export function profileSummary(
  profile: Record<string, unknown> | undefined,
): { searchable: boolean; enrollmentComplete: boolean } | null {
  if (!profile) return null;
  return {
    searchable: profile.searchable === true,
    enrollmentComplete: profile.enrollmentComplete === true,
  };
}

/**
 * The guardian authorization gate shared by oversight and protective-control
 * callables: the caller must be a family parent AND hold the child's ACTIVE
 * link. "No link", "not active", and "someone else's family" are one
 * indistinguishable refusal (same shape as revokeSupervision's).
 */
export async function requireActiveLinkParent(
  callerUid: string,
  childUid: string,
): Promise<{ familyId: string; link: FirebaseFirestore.DocumentData }> {
  const { familyId } = await requireFamilyParent(callerUid);
  const link = (await db.collection('guardianLinks').doc(childUid).get()).data();
  if (!link || link.status !== 'active' || link.familyId !== familyId) {
    throw new HttpsError('failed-precondition', 'This account is not under your supervision.', {
      code: 'guardian/not-supervised',
    });
  }
  return { familyId, link };
}
