import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { normalizeAccountExistsApp, sendAccountExistsEmail } from '../config/email.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

/** At most one account-exists email per address per 24h (mail-bomb guard). */
const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Silent existing-account path (issue #148): when a signup verification
 * request hits an email that already belongs to an account, the caller must
 * not be able to tell — the response is byte-identical to the fresh path, and
 * a DECOY verificationCodes/{email} doc is written, byte-shaped like the
 * caller's fresh path would write (unguessable crypto code, same fields).
 * The decoy makes every downstream step — verifyCode and all four enroll
 * callables — take the exact same error branches as a fresh email with a
 * wrong code (invalid-argument "Invalid verification code", the same
 * attempts limit, the same expiry), instead of the not-found split that
 * would re-open the oracle one step downstream.
 *
 * Accepted residual: a caller who GUESSES the decoy code (~5 in 900000
 * before the attempts limit) passes the code check and reaches the enroll
 * callables' createUser race backstop (already-exists) — a negligible,
 * probabilistic oracle we accept.
 *
 * The mailbox owner gets an account-exists email instead of a working code,
 * rate-limited to one per 24h via the server-only accountExistsNotices/{email}
 * marker (clients cannot reach it: firestore.rules has no match for the
 * collection, so the default-deny catch-all applies).
 *
 * Known residual timing channel (deliberate, do NOT claim it is closed): in
 * the 60s-24h repeat window the fresh path performs an outbound email send
 * while this path skips it (notice already sent within 24h), so wall-clock
 * can differ. Full symmetry would mean 24h-throttling legitimate resends or
 * fire-and-forget sends that lose failure propagation — both worse. Repeats
 * under 60s are symmetric via the shared send cooldown (sendCooldown.ts).
 *
 * @param email lowercased account email
 * @param app untrusted client hint of which app the attempt came from —
 *   normalized to the literal 'sit' | 'study' set before it touches copy.
 * @param decoyCodeDoc the exact doc shape the CALLER's fresh path writes
 *   (each callable owns its shape — verifyEjmEmail includes graduationYear,
 *   verifyParentEmail does not), with an unguessable random code.
 */
export async function handleExistingAccountSignup(
  email: string,
  app: unknown,
  decoyCodeDoc: Record<string, unknown>,
): Promise<{ success: true; message: string }> {
  await db.collection('verificationCodes').doc(email).set(decoyCodeDoc);

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
    // Send BEFORE marking: a transport failure must not stamp lastSentAt and
    // silently suppress the owner's warning for 24h. The trade — a possible
    // duplicate email when the send succeeds but the marker write fails — is
    // the better failure mode, consistent with the accepted get/set race
    // (two concurrent first requests may each send once).
    await sendAccountExistsEmail(email, normalizeAccountExistsApp(app));
    await noticeRef.set({ email, lastSentAt: new Date() });
    await writeUserActivity('system', 'account_exists_email_sent', { email });
  }

  // MUST stay byte-identical to the fresh-path response of verifyEjmEmail /
  // verifyParentEmail — any difference is an account-enumeration oracle.
  return { success: true, message: 'Verification code sent' };
}
