let resendInstance: any = null;

function getResend(): any {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not configured — emails will be logged only');
    return null;
  }
  if (!resendInstance) {
    // Lazy import to avoid startup failures if resend package has issues
    const { Resend } = require('resend');
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

/**
 * The three canonical app hosts — the ONE place any server-side link is built
 * from (docs/platform-plan.md §8's first work item).
 *
 * `SIT_APP_URL` did not exist: `https://sync-sit.com` was inlined ~20 times
 * across a dozen files under `apps/functions/src/**`, while study and do had
 * had constants since day one. Since the coming domain move IS a sit-domain
 * move, the sweep landed almost entirely on the half that was never
 * centralised. It is centralised now, so the cutover is these three lines.
 *
 * Two sit hosts were in circulation — the functions inlined `sync-sit.com`
 * while `email.ts` and `guardian/shared.ts` used `sync-sit.web.app`. Both
 * serve, and the custom domain is the canonical one, so everything now builds
 * on it.
 *
 * Configuration reference: docs/environments.md.
 *
 * ENV-OVERRIDABLE, and that is the point for anything that is not production:
 * a staging deployment whose emails link to production is worse than no
 * staging at all — a tester clicks "View your appointment" and lands on real
 * data. Firebase loads `.env` and then `.env.<projectId>` from the functions
 * directory at deploy time, so the staging project sets these and nothing
 * else changes.
 *
 * NOT env-driven here: `FROM_EMAIL`, `SUPPORT_EMAIL` and `ADMIN_EMAIL`. Those
 * are addresses, not links, and moving them needs the new domain verified at
 * Resend with SPF and DKIM (docs/platform-plan.md §8, and the still-half-open
 * issue #156) — mail from an unverified domain lands in spam. Separate work
 * with real lead time; deliberately not bundled here.
 */
export const SIT_APP_URL = process.env.SIT_APP_URL ?? 'https://sync-sit.com';
export const STUDY_APP_URL = process.env.STUDY_APP_URL ?? 'https://sync-study-app.web.app';
export const DO_APP_URL = process.env.DO_APP_URL ?? 'https://sync-do-app.web.app';

const FROM_EMAIL = 'Sync/Sit <noreply@sync-sit.com>';

/**
 * Verification-code email, branded per app (issue #156): a Sync/Study
 * enrollee must not receive a Sync/Sit-branded code from a Sync/Sit
 * sender. `app` is the callables' untrusted display-only hint, normalized
 * by the caller; the sender display name rides the SAME verified domain
 * (Resend validates the domain, not the RFC 5322 display name). Builder
 * exported for unit pins.
 */
export function buildVerificationEmail(code: string, app: NotificationApp = 'sit'): {
  subject: string;
  html: string;
} {
  const { appName, color, tagline } = NOTIFICATION_BRANDING[app];
  return {
    subject: `Your ${appName} verification code: ${code}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: ${color}; margin-bottom: 16px;">${appName}</h2>
        <p>Your verification code is:</p>
        <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${code}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px;">This code expires in 10 minutes.</p>
        <p style="color: #6B7280; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 12px;">${appName} — ${tagline}</p>
      </div>
    `,
  };
}

export async function sendVerificationEmail(
  to: string,
  code: string,
  app: NotificationApp = 'sit',
): Promise<void> {
  // In emulator, just log
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Code for ${to} (app: ${app}): ${code}`);
    return;
  }

  const resend = getResend();

  if (!resend) {
    console.log(`[NO-RESEND] Code for ${to} (app: ${app}): ${code}`);
    return;
  }

  const { subject, html } = buildVerificationEmail(code, app);
  const { from, fromFallback } = NOTIFICATION_BRANDING[app];
  try {
    await resend.emails.send({ from, to, subject, html });
  } catch (err: any) {
    // If domain not verified yet, try fallback sender
    if (err.statusCode === 403 || err.message?.includes('domain')) {
      await resend.emails.send({ from: fromFallback, to, subject, html });
    } else {
      throw err;
    }
  }
}

/**
 * Which app a signup attempt came from. Untrusted display-only client input:
 * it selects between three literal copy sets and NOTHING else — never
 * interpolate the raw client value anywhere. Normalize with
 * normalizeAccountExistsApp.
 */
export type AccountExistsApp = 'sit' | 'study' | 'do';

/**
 * Collapses an untrusted `app` request param to the literal set; anything
 * that is not exactly 'study' or 'do' becomes 'sit'. 'do' joined at sync-do
 * plan §13 PR9 (branding tables landed) — closing the PR4 deferral where
 * doer verification emails collapsed to sit branding.
 */
export function normalizeAccountExistsApp(app: unknown): AccountExistsApp {
  return app === 'study' || app === 'do' ? app : 'sit';
}

// Login URLs build on the three constants above rather than repeating hosts:
// this table previously named `sync-sit.web.app` while the functions emailed
// `sync-sit.com`, which is how two sit hosts stayed in circulation.
const ACCOUNT_EXISTS_COPY: Record<AccountExistsApp, { appName: string; loginUrl: string }> = {
  sit: { appName: 'Sync/Sit', loginUrl: `${SIT_APP_URL}/login` },
  study: { appName: 'Sync/Study', loginUrl: `${STUDY_APP_URL}/login` },
  do: { appName: 'Sync/Do', loginUrl: `${DO_APP_URL}/login` },
};

const SUPPORT_EMAIL = 'support@sync-sit.com';

/**
 * Builds the account-exists email (issue #148): sent INSTEAD of a verification
 * code when someone tries to sign up with an email that already has an
 * account. Only the mailbox owner ever learns the account exists — the on
 * screen flow stays indistinguishable from a fresh signup.
 *
 * The cross-app line deliberately names NO sibling app: this copy renders
 * under every app's branding, and decision 20 (sync-do plan §2) bars naming
 * Sync/Do in a sit/study-facing surface until the owner flips visibility.
 */
export function buildAccountExistsEmail(app: AccountExistsApp): { subject: string; html: string } {
  const { appName, loginUrl } = ACCOUNT_EXISTS_COPY[app];
  return {
    subject: `You already have a ${appName} account`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #DC2626; margin-bottom: 16px;">${appName}</h2>
        <p>Someone just tried to create a ${appName} account with this email address, but you already have an account.</p>
        <p>If this was you, simply log in:</p>
        <p style="margin: 24px 0; text-align: center;">
          <a href="${loginUrl}" style="color: #DC2626; font-weight: bold;">${loginUrl}</a>
        </p>
        <p>If you were following an invite link, open it again after logging in.</p>
        <p style="color: #6B7280; font-size: 14px;">Your account works across the Sync apps — the same email and password sign you in to each of them.</p>
        <p style="color: #6B7280; font-size: 14px;">If this wasn't you, you can safely ignore this email or contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #DC2626;">${SUPPORT_EMAIL}</a>.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 12px;">${appName}</p>
      </div>
    `,
  };
}

/**
 * Sends the account-exists email. Mirrors sendVerificationEmail's transport
 * behavior: emulator/no-resend log-only, primary sender with fallback when the
 * domain is not verified.
 */
export async function sendAccountExistsEmail(to: string, app: AccountExistsApp): Promise<void> {
  const { subject, html } = buildAccountExistsEmail(app);

  // In emulator, just log
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Account-exists notice for ${to} (app: ${app})`);
    return;
  }

  const resend = getResend();

  if (!resend) {
    console.log(`[NO-RESEND] Account-exists notice for ${to} (app: ${app})`);
    return;
  }

  try {
    // Per-app sender (issue #156): this notice is security-relevant -- a
    // Sync/Study-only user receiving it from an unknown Sync/Sit brand
    // reads it as phishing and ignores it.
    await resend.emails.send({ from: NOTIFICATION_BRANDING[app].from, to, subject, html });
  } catch (err: any) {
    // If domain not verified yet, try fallback sender
    if (err.statusCode === 403 || err.message?.includes('domain')) {
      await resend.emails.send({ from: NOTIFICATION_BRANDING[app].fromFallback, to, subject, html });
    } else {
      console.error('Failed to send email:', err);
      throw err;
    }
  }
}

const ADMIN_EMAIL = 'support@sync-sit.com';

/**
 * Send admin notification email (e.g. new verification request).
 * Fails silently — admin notifications should not block user actions.
 */
export async function sendAdminNotification(subject: string, body: string): Promise<void> {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Admin notification: ${subject}`);
    return;
  }

  const resend = getResend();
  if (!resend) {
    console.log(`[NO-RESEND] Admin notification: ${subject}`);
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #DC2626; margin-bottom: 16px;">Sync/Sit — Admin</h2>
          ${body}
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">
            <a href="${SIT_APP_URL}/admin/verifications" style="color: #DC2626;">Review in admin panel</a>
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
    // Don't throw — admin notification failure should not block user actions
  }
}

/**
 * Which app a notification belongs to. Selects between three literal branding
 * sets (name, accent color, host link, sender display name) and NOTHING else —
 * never interpolate an untrusted value anywhere in the email.
 */
export type NotificationApp = 'sit' | 'study' | 'do';

// Per-app notification branding (issue #168 Phase 0). Same literal-copy-set
// pattern as ACCOUNT_EXISTS_COPY above. The FROM address stays
// noreply@sync-sit.com for BOTH apps until #156 resolves study domain setup —
// only the display name varies (Resend validates the domain of the from
// address, not the RFC 5322 display name, so a different display name on the
// same verified domain is accepted).
export const NOTIFICATION_BRANDING: Record<
  NotificationApp,
  { appName: string; color: string; appUrl: string; from: string; fromFallback: string; tagline: string }
> = {
  sit: {
    appName: 'Sync/Sit',
    color: '#DC2626',
    appUrl: SIT_APP_URL,
    from: 'Sync/Sit <noreply@sync-sit.com>',
    fromFallback: 'Sync/Sit <onboarding@resend.dev>',
    tagline: 'Connecting EJM families with trusted student babysitters',
  },
  study: {
    appName: 'Sync/Study',
    color: '#2563EB',
    appUrl: STUDY_APP_URL,
    from: 'Sync/Study <noreply@sync-sit.com>',
    fromFallback: 'Sync/Study <onboarding@resend.dev>',
    tagline: 'Connecting EJM families with trusted student tutors',
  },
  // sync-do (plan §10, §13 PR9). Accent = the do theme's brand-600
  // (packages/shared-ui/src/theme/do.css). Same shared verified FROM domain
  // as study — only the display name varies (see the table comment above).
  do: {
    appName: 'Sync/Do',
    color: '#0d8204',
    appUrl: DO_APP_URL,
    from: 'Sync/Do <noreply@sync-sit.com>',
    fromFallback: 'Sync/Do <onboarding@resend.dev>',
    tagline: 'Connecting EJM families with trusted student helpers',
  },
};

/**
 * Escape a user-controlled string for interpolation into notification email
 * HTML (text-node and attribute contexts). Introduced at the
 * endorsement-response emails (issue #168 Phase 0); issue #188 applied it
 * across every sender in both apps. The convention: escape anything that
 * originates from user/family/request/session docs or free-text input when it
 * lands in email HTML; leave RFC 5322 subject lines (never HTML-decoded) and
 * system-generated values (self-formatted dates, constant-built URLs) raw.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the branded wrapper around a notification email body. Exported for
 * unit pins: study emails must carry no Sync/Sit branding and vice versa.
 */
export function buildNotificationEmailHtml(body: string, app: NotificationApp = 'sit'): string {
  const { appName, color, appUrl } = NOTIFICATION_BRANDING[app];
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: ${color}; margin-bottom: 16px;">${appName}</h2>
      ${body}
      <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
      <p style="color: #9CA3AF; font-size: 12px;">
        <a href="${appUrl}" style="color: ${color};">Open ${appName}</a>
      </p>
    </div>
  `;
}

/**
 * Send a notification email to a user, branded for the given app.
 * Fails silently — notifications should not block user actions.
 * Returns whether the email was actually handed to the transport (mirrors
 * sendPushNotification), so callers can record an honest emailSent audit
 * field: false on a skipped recipient, missing Resend config, a rejected
 * send, or a thrown transport error. The emulator [DEV] log IS that
 * environment's successful delivery, so it returns true.
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  app: NotificationApp = 'sit'
): Promise<boolean> {
  if (!to || !to.includes('@')) {
    console.warn(`[SKIP-EMAIL] Invalid recipient: ${to}`);
    return false;
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Notification to ${to} (app: ${app}): ${subject}`);
    return true;
  }

  const resend = getResend();
  if (!resend) {
    console.log(`[NO-RESEND] Notification to ${to} (app: ${app}): ${subject}`);
    return false;
  }

  const { from, fromFallback } = NOTIFICATION_BRANDING[app];
  const emailHtml = buildNotificationEmailHtml(body, app);

  try {
    const result = await resend.emails.send({ from, to, subject, html: emailHtml });
    if (result.error) {
      console.warn(`[EMAIL] Primary sender failed: ${result.error.message}, trying fallback`);
      const fallbackResult = await resend.emails.send({ from: fromFallback, to, subject, html: emailHtml });
      if (fallbackResult.error) {
        console.error(`[EMAIL] Fallback also failed: ${fallbackResult.error.message}`);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error('Failed to send notification email:', err);
    return false;
  }
}
