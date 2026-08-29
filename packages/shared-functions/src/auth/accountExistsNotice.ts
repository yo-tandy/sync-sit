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
 * a DECOY verificationCodes/{email} doc is written, shaped like the caller's
 * fresh path would write (unguessable crypto code, same consumer-read fields,
 * plus a server-only `decoy` tag) — unless a REAL unexpired code from the
 * authed own-email bypass is in flight (see the branch comment below).
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
 * Known residual channel (deliberate, do NOT claim it is closed): in the
 * 60s-24h repeat window the fresh path performs an outbound email send while
 * this path skips it (notice already sent within 24h). Two manifestations:
 * (a) wall-clock timing — the send costs hundreds of milliseconds; and
 * (b) under a mail-transport failure, an error-vs-success split — the fresh
 * path rethrows the send failure (INTERNAL to the caller) while this path,
 * having nothing to send, succeeds. The error split needs an outage AND a
 * second probe inside the window (a first probe on an existing address also
 * sends and fails symmetrically). Closing it would mean swallowing send
 * failures on both paths, losing the failure propagation the send-then-mark
 * ordering below deliberately preserves — accepted instead. (Every branch
 * below refreshes createdAt, so the 60s cooldown itself fires symmetrically
 * on both paths — the divergence is the send, plus small per-request
 * read-count differences.) Full symmetry would mean 24h-throttling legitimate resends or
 * fire-and-forget sends that lose failure propagation — both worse. A third
 * option, padding both branches to a fixed floor duration, was considered
 * and rejected: the floor only closes the channel if it exceeds the p99
 * outbound-send latency, which would add roughly a second to every
 * legitimate signup step. Repeats under 60s are symmetric via the shared
 * send cooldown (sendCooldown.ts).
 *
 * @param email lowercased account email
 * @param app untrusted client hint of which app the attempt came from —
 *   normalized to the literal 'sit' | 'study' set before it touches copy.
 * @param decoyCodeDoc the exact doc shape the CALLER's fresh path writes
 *   (each callable owns its shape — verifyEjmEmail includes graduationYear
 *   and the `ejm` identity stamp, verifyParentEmail the `mailbox` one), with
 *   an unguessable random code.
 */
export async function handleExistingAccountSignup(
  email: string,
  app: unknown,
  decoyCodeDoc: Record<string, unknown>,
): Promise<{ success: true; message: string }> {
  // Decoy vs real handling (round 4). Decoys carry a server-only
  // `decoy: true` tag (unobservable: the collection is client-unreadable and
  // every consumer — verifyCode + the four enroll callables — reads only the
  // named code/attempts/expiresAt/identityClass fields, copying nothing
  // onward). `identityClass` (issue #322) is graded by the enroll callables,
  // so the decoy MUST carry the calling callable's stamp — which it does:
  // each caller passes its own fresh-write shape in `decoyCodeDoc`, and a
  // stamp mismatch would grade differently and re-open the oracle.
  //
  // - Existing DECOY: clobber unconditionally. A repeat request past the
  //   cooldown must reset attempts and refresh expiresAt/createdAt exactly
  //   like the fresh path's rewrite, or the frozen state becomes a
  //   deterministic oracle (RESOURCE_EXHAUSTED / DEADLINE_EXCEEDED splits).
  // - Existing REAL unexpired code (no tag — includes pre-deploy legacy
  //   docs; only reachable while the authed own-email bypass has a code in
  //   flight): refresh createdAt ONLY, so the 60s cooldown still fires
  //   symmetrically on both paths. code, attempts and expiresAt stay frozen
  //   DELIBERATELY: resetting attempts would hand an unauthenticated prober
  //   five fresh guesses per cooldown cycle at the victim's live code, and
  //   refreshing expiresAt would keep that code alive indefinitely.
  //   Honest residual: during such a live bypass window (at most the code's
  //   10-minute life) the attempts/expiry divergence IS observable to a
  //   prober — accepted because the window is short, requires the victim to
  //   be mid-enrollment, reveals only what the bypass state already implies,
  //   and the alternative weakens the victim's actual code.
  // - Existing REAL but expired: clobber with a fresh decoy, matching the
  //   fresh path's rewrite of stale docs.
  const codeRef = db.collection('verificationCodes').doc(email);
  const existingCode = await codeRef.get();
  const existingData = existingCode.data();
  const existingExpiresAt = existingData?.expiresAt;
  const existingExpiresMs =
    existingExpiresAt instanceof Timestamp
      ? existingExpiresAt.toMillis()
      : existingExpiresAt instanceof Date
        ? existingExpiresAt.getTime()
        : 0;
  const isLiveRealCode =
    existingCode.exists && existingData?.decoy !== true && existingExpiresMs > Date.now();
  if (isLiveRealCode) {
    await codeRef.update({ createdAt: new Date() });
  } else {
    await codeRef.set({ ...decoyCodeDoc, decoy: true });
  }

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
