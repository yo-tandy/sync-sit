import { escapeHtml, sendNotificationEmail, SUPPORT_EMAIL } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';
import { db } from '../config/firebase.js';

/** The durable notification doc's `type`, and the push payload's `data.type`. */
export const BLOCKED_MINOR_NOTIFICATION_TYPE = 'account_blocked_last_parent';

/**
 * English/French copy for the last-parent-erasure block notice (issue #421,
 * option 1b). Only two locales because that is all `Language` (shared-core)
 * carries; an unrecognised value falls back to English at the call site,
 * same convention as `getConsideration`'s locale table (do-core) and the
 * `language?.startsWith('fr')` check the client apps already use.
 *
 * The three facts every branch of this copy carries, deliberately, because
 * the triage comment on #421 asked for exactly these and no more: WHAT
 * happened (a guardian's account was deleted), WHAT IT MEANS (the account is
 * PAUSED, not deleted -- nothing here is a second erasure), and the SUPPORT
 * PATH (`SUPPORT_EMAIL`, issue #363's verified address -- never a second,
 * invented one).
 */
const COPY: Record<
  'en' | 'fr',
  { subject: string; pushBody: string; html: (firstName: string) => string }
> = {
  en: {
    subject: 'Your account is paused',
    pushBody:
      "Your guardian's account was deleted. Your account is paused until a guardian re-links you.",
    html: (firstName) => `
      <p>Hi ${firstName ? escapeHtml(firstName) : 'there'},</p>
      <p>Your guardian's account has been deleted, and with it the supervision your account needs to stay active.</p>
      <p>Your account is paused until a guardian re-links to supervise you again. This does not delete your account or your data.</p>
      <p>If you have questions, or need help getting a guardian re-linked, contact us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color: #DC2626;">${SUPPORT_EMAIL}</a>.</p>
    `,
  },
  fr: {
    subject: 'Votre compte est suspendu',
    pushBody:
      "Le compte de votre tuteur a été supprimé. Votre compte est suspendu jusqu'à ce qu'un tuteur vous relie à nouveau.",
    html: (firstName) => `
      <p>Bonjour ${firstName ? escapeHtml(firstName) : ''},</p>
      <p>Le compte de votre tuteur a été supprimé, et avec lui la supervision dont votre compte a besoin pour rester actif.</p>
      <p>Votre compte est suspendu jusqu'à ce qu'un tuteur soit à nouveau lié pour vous superviser. Cela ne supprime ni votre compte ni vos données.</p>
      <p>Pour toute question, ou pour obtenir de l'aide afin qu'un tuteur vous relie à nouveau, contactez-nous à
      <a href="mailto:${SUPPORT_EMAIL}" style="color: #DC2626;">${SUPPORT_EMAIL}</a>.</p>
    `,
  },
};

/**
 * Tell a supervised minor, at the moment their account is blocked, that
 * their last parent's account was erased and why (issue #421, option 1b from
 * the triage comment: notify AFTER the block, with a support path -- NOT
 * before, with a grace window, which would delay an erasure the parent is
 * legally entitled to).
 *
 * Mirrors the #368 mirror case's channel set exactly
 * (`notifyGuardiansOfSelfDelete` in `account/deleteMyAccount.ts`): email via
 * the existing mailer, push via the existing helper (`'auto'` app
 * resolution -- a minor who only installed the study or do PWA still has a
 * channel), and a durable in-app notification doc so the record survives
 * even if both transports miss. The recipient here is the CHILD themselves,
 * not a guardian, so unlike that function this one has no per-recipient loop
 * to isolate -- a single failure is the caller's to catch (see
 * `notifyBlockedMinorBestEffort` in `admin/deleteUser.ts`).
 *
 * Called BEFORE `adminAuth.updateUser(childUid, { disabled: true })`: the
 * push-token read and the email send both still see a fully enabled account,
 * and the plain "notify, then disable" ordering keeps this function's
 * contract simple rather than needing to reason about a half-disabled one.
 *
 * Localised off the CHILD's own `language` field -- the field every other
 * per-user record in this schema carries, and the one this function's own
 * caller reads straight off the just-fetched child doc.
 */
export async function notifyBlockedMinor(
  child: { email?: string; firstName?: string; language?: string },
  childUid: string,
  now: Date,
): Promise<{ emailSent: boolean; pushSent: boolean }> {
  const lang = child.language === 'fr' ? 'fr' : 'en';
  const copy = COPY[lang];
  const firstName = child.firstName || '';

  let emailSent = false;
  if (child.email) {
    emailSent = await sendNotificationEmail(
      child.email,
      copy.subject,
      copy.html(firstName),
      'sit',
    );
  }

  // 'auto', matching every other guardian/safeguarding notification in the
  // repo: an explicit app reads that app's token array ALONE, so a minor who
  // only uses sync/study or sync/do would have no `sit` tokens and this send
  // would return false without even trying.
  const pushSent = await sendPushNotification(
    childUid,
    copy.subject,
    copy.pushBody,
    { type: BLOCKED_MINOR_NOTIFICATION_TYPE },
    'auto',
  );

  await db.collection('notifications').add({
    recipientUserId: childUid,
    type: BLOCKED_MINOR_NOTIFICATION_TYPE,
    title: copy.subject,
    body: copy.pushBody,
    data: {},
    read: false,
    channels: ['email', 'push'],
    emailSent,
    pushSent,
    createdAt: now,
  });

  return { emailSent, pushSent };
}
