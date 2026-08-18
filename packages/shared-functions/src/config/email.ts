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

const FROM_EMAIL = 'Sync/Sit <noreply@sync-sit.com>';
const FROM_EMAIL_FALLBACK = 'Sync/Sit <onboarding@resend.dev>';

/**
 * Send a verification code email.
 */
export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  // In emulator, just log
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Code for ${to}: ${code}`);
    return;
  }

  const resend = getResend();

  if (!resend) {
    console.log(`[NO-RESEND] Code for ${to}: ${code}`);
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `Your Sync/Sit verification code: ${code}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #DC2626; margin-bottom: 16px;">Sync/Sit</h2>
          <p>Your verification code is:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${code}</span>
          </div>
          <p style="color: #6B7280; font-size: 14px;">This code expires in 10 minutes.</p>
          <p style="color: #6B7280; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">Sync/Sit — Connecting EJM families with trusted student babysitters</p>
        </div>
      `,
    });
  } catch (err: any) {
    // If domain not verified yet, try fallback sender
    if (err.statusCode === 403 || err.message?.includes('domain')) {
      await resend.emails.send({
        from: FROM_EMAIL_FALLBACK,
        to,
        subject: `Your Sync/Sit verification code: ${code}`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #DC2626; margin-bottom: 16px;">Sync/Sit</h2>
            <p>Your verification code is:</p>
            <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827;">${code}</span>
            </div>
            <p style="color: #6B7280; font-size: 14px;">This code expires in 10 minutes.</p>
            <p style="color: #6B7280; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
            <p style="color: #9CA3AF; font-size: 12px;">Sync/Sit — Connecting EJM families with trusted student babysitters</p>
          </div>
        `,
      });
    } else {
      console.error('Failed to send email:', err);
      throw err;
    }
  }
}

/**
 * Which app a signup attempt came from. Untrusted display-only client input:
 * it selects between two literal copy sets and NOTHING else — never interpolate
 * the raw client value anywhere. Normalize with normalizeAccountExistsApp.
 */
export type AccountExistsApp = 'sit' | 'study';

/**
 * Collapses an untrusted `app` request param to the literal set; anything that
 * is not exactly 'study' becomes 'sit'.
 */
export function normalizeAccountExistsApp(app: unknown): AccountExistsApp {
  return app === 'study' ? 'study' : 'sit';
}

// Canonical prod login URLs, hardcoded because functions cannot import app
// code. Keep in sync with the prod fallbacks of the appSwitch constants:
// - apps/study-web/src/utils/appSwitch.ts SIT_APP_URL   -> https://sync-sit.web.app
// - apps/web/src/lib/appSwitch.ts        STUDY_APP_URL  -> https://sync-study-app.web.app
const ACCOUNT_EXISTS_COPY: Record<AccountExistsApp, { appName: string; loginUrl: string }> = {
  sit: { appName: 'Sync/Sit', loginUrl: 'https://sync-sit.web.app/login' },
  study: { appName: 'Sync/Study', loginUrl: 'https://sync-study-app.web.app/login' },
};

const SUPPORT_EMAIL = 'support@sync-sit.com';

/**
 * Builds the account-exists email (issue #148): sent INSTEAD of a verification
 * code when someone tries to sign up with an email that already has an
 * account. Only the mailbox owner ever learns the account exists — the on
 * screen flow stays indistinguishable from a fresh signup.
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
        <p style="color: #6B7280; font-size: 14px;">Your account works on both Sync/Sit and Sync/Study — the same email and password sign you in to either app.</p>
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
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  } catch (err: any) {
    // If domain not verified yet, try fallback sender
    if (err.statusCode === 403 || err.message?.includes('domain')) {
      await resend.emails.send({ from: FROM_EMAIL_FALLBACK, to, subject, html });
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
            <a href="https://sync-sit.com/admin/verifications" style="color: #DC2626;">Review in admin panel</a>
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
 * Which app a notification belongs to. Selects between two literal branding
 * sets (name, accent color, host link, sender display name) and NOTHING else —
 * never interpolate an untrusted value anywhere in the email.
 */
export type NotificationApp = 'sit' | 'study';

// Per-app notification branding (issue #168 Phase 0). Same literal-copy-set
// pattern as ACCOUNT_EXISTS_COPY above. The FROM address stays
// noreply@sync-sit.com for BOTH apps until #156 resolves study domain setup —
// only the display name varies (Resend validates the domain of the from
// address, not the RFC 5322 display name, so a different display name on the
// same verified domain is accepted).
const NOTIFICATION_BRANDING: Record<
  NotificationApp,
  { appName: string; color: string; appUrl: string; from: string; fromFallback: string }
> = {
  sit: {
    appName: 'Sync/Sit',
    color: '#DC2626',
    appUrl: 'https://sync-sit.com',
    from: 'Sync/Sit <noreply@sync-sit.com>',
    fromFallback: 'Sync/Sit <onboarding@resend.dev>',
  },
  study: {
    appName: 'Sync/Study',
    color: '#2563EB',
    appUrl: 'https://sync-study-app.web.app',
    from: 'Sync/Study <noreply@sync-sit.com>',
    fromFallback: 'Sync/Study <onboarding@resend.dev>',
  },
};

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
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  app: NotificationApp = 'sit'
): Promise<void> {
  if (!to || !to.includes('@')) {
    console.warn(`[SKIP-EMAIL] Invalid recipient: ${to}`);
    return;
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Notification to ${to} (app: ${app}): ${subject}`);
    return;
  }

  const resend = getResend();
  if (!resend) {
    console.log(`[NO-RESEND] Notification to ${to} (app: ${app}): ${subject}`);
    return;
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
      }
    }
  } catch (err) {
    console.error('Failed to send notification email:', err);
  }
}
