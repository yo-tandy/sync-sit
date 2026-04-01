import { Resend } from 'resend';

let resendInstance: Resend | null = null;

function getResend(): Resend {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
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
