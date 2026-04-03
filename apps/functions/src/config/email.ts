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
      from: FROM_EMAIL_FALLBACK,
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
 * Send a notification email to a user.
 * Fails silently — notifications should not block user actions.
 */
export async function sendNotificationEmail(to: string, subject: string, body: string): Promise<void> {
  if (!to || !to.includes('@')) {
    console.warn(`[SKIP-EMAIL] Invalid recipient: ${to}`);
    return;
  }

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.log(`[DEV] Notification to ${to}: ${subject}`);
    return;
  }

  const resend = getResend();
  if (!resend) {
    console.log(`[NO-RESEND] Notification to ${to}: ${subject}`);
    return;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL_FALLBACK,
      to,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #DC2626; margin-bottom: 16px;">Sync/Sit</h2>
          ${body}
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">
            <a href="https://sync-sit.com" style="color: #DC2626;">Open Sync/Sit</a>
          </p>
        </div>
      `,
    });
  } catch (err) {
    console.error('Failed to send notification email:', err);
  }
}
