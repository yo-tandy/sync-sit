import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { normalizeAccountExistsApp, sendAccountExistsEmail } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/** At most one account-exists email per address per 24h (mail-bomb guard). */
const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Silent existing-account path (issue #148): when a signup verification
 * request hits an email that already belongs to an account, the caller must
 * not be able to tell — the response is byte-identical to the fresh path and
 * no verificationCodes doc is written (the code step then fails with the
 * normal invalid-code error). The mailbox owner gets an account-exists email
 * instead of a code, rate-limited to one per 24h via the server-only
 * accountExistsNotices/{email} marker (clients cannot reach it: firestore.rules
 * has no match for the collection, so the default-deny catch-all applies).
 *
 * @param email lowercased account email
 * @param app untrusted client hint of which app the attempt came from —
 *   normalized to the literal 'sit' | 'study' set before it touches copy.
 */
export async function handleExistingAccountSignup(
  email: string,
  app: unknown,
): Promise<{ success: true; message: string }> {
  const noticeRef = db.collection('accountExistsNotices').doc(email);
  const notice = await noticeRef.get();
  const lastSentAt = notice.data()?.lastSentAt;
  const lastSentMs =
    lastSentAt instanceof Timestamp
      ? lastSentAt.toMillis()
      : lastSentAt instanceof Date
        ? lastSentAt.getTime()
        : 0;

  if (Date.now() - lastSentMs >= NOTICE_WINDOW_MS) {
    await noticeRef.set({ email, lastSentAt: new Date() });
    await sendAccountExistsEmail(email, normalizeAccountExistsApp(app));
    await writeUserActivity('system', 'account_exists_email_sent', { email });
  }

  // MUST stay byte-identical to the fresh-path response of verifyEjmEmail /
  // verifyParentEmail — any difference is an account-enumeration oracle.
  return { success: true, message: 'Verification code sent' };
}
