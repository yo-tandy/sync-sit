import { db } from '../config/firebase.js';
import { sendVerificationRejectedEmail, type VerificationDocType } from '../config/email.js';

export interface NotifyVerificationRejectedInput {
  familyId: string;
  uploadedByUserId?: string | null;
  type: VerificationDocType;
  reason: string;
}

export interface NotifyVerificationRejectedResult {
  /** Distinct user ids the notice was attempted for. */
  recipients: string[];
  /** How many emails were handed to the provider. */
  sent: number;
}

/**
 * Emails every parent of the family (the uploader first, then the other
 * parents, de-duplicated) that a verification document was rejected, with the
 * admin's note. Transactional: sent regardless of notification preferences.
 * Best-effort per recipient — a failure is logged, never thrown, so the review
 * decision itself is never rolled back by a delivery problem.
 */
export async function notifyVerificationRejected(
  input: NotifyVerificationRejectedInput,
): Promise<NotifyVerificationRejectedResult> {
  const familyDoc = await db.collection('families').doc(input.familyId).get();
  const parentIds: string[] = (familyDoc.data()?.parentIds as string[] | undefined) ?? [];
  const ordered = [input.uploadedByUserId, ...parentIds].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const recipients = Array.from(new Set(ordered));

  let sent = 0;
  for (const uid of recipients) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      const user = userDoc.data() as { email?: string; language?: string } | undefined;
      if (!user?.email) {
        console.warn(`[verification] rejection notice skipped for ${uid}: no email on file`);
        continue;
      }
      const ok = await sendVerificationRejectedEmail(user.email, {
        type: input.type,
        reason: input.reason,
        language: user.language,
      });
      if (ok) sent += 1;
    } catch (err) {
      console.error(`[verification] rejection notice failed for ${uid}`, err);
    }
  }
  return { recipients, sent };
}
