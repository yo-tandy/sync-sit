import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  buildVerificationRejectedEmail,
  sendVerificationRejectedEmail,
  __setResendClientForTests,
} from '../email.js';

const sendMock = vi.fn();

describe('buildVerificationRejectedEmail', () => {
  it('names the document, quotes the admin note (escaped), links the verification page, replies to support', () => {
    const { subject, html, replyTo } = buildVerificationRejectedEmail({
      type: 'identity',
      reason: 'Photo is blurry <script>alert(1)</script> & cropped',
      language: 'en',
    });
    expect(subject).toBe('Your identity document verification was not approved');
    expect(html).toContain('Note from the administrator');
    expect(html).toContain('Photo is blurry &lt;script&gt;alert(1)&lt;/script&gt; &amp; cropped');
    expect(html).not.toContain('<script>');
    expect(html).toContain('/family/verification');
    expect(replyTo).toBe('support@sync-sit.com');
  });

  it('localises to French on the recipient language and labels the enrollment proof', () => {
    const { subject, html } = buildVerificationRejectedEmail({
      type: 'ejm_enrollment',
      reason: 'Document expiré',
      language: 'fr',
    });
    expect(subject).toBe("Votre justificatif d'inscription EJM n'a pas été validée");
    expect(html).toContain("Note de l'administrateur");
    expect(html).toContain('Document expiré');
  });

  it('falls back to English for an unknown language', () => {
    expect(buildVerificationRejectedEmail({ type: 'identity', reason: 'x', language: 'de' }).subject).toMatch(/^Your /);
  });
});

describe('sendVerificationRejectedEmail', () => {
  const env = { ...process.env };
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({ error: null });
    delete process.env.FUNCTIONS_EMULATOR;
    __setResendClientForTests({ emails: { send: sendMock } });
  });
  afterEach(() => {
    __setResendClientForTests(null);
    process.env = { ...env };
  });

  it('hands the provider the support reply-to and the sit sender', async () => {
    const ok = await sendVerificationRejectedEmail('parent@example.org', {
      type: 'identity',
      reason: 'Blurry',
      language: 'en',
    });
    expect(ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const args = sendMock.mock.calls[0][0];
    expect(args.to).toBe('parent@example.org');
    expect(args.replyTo).toBe('support@sync-sit.com');
    expect(args.from).toMatch(/^Sync\/Sit </);
    expect(args.subject).toContain('was not approved');
  });

  it('never throws on a provider failure and reports false', async () => {
    sendMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      sendVerificationRejectedEmail('parent@example.org', { type: 'identity', reason: 'x' }),
    ).resolves.toBe(false);
  });

  it('refuses an invalid recipient without calling the provider', async () => {
    await expect(sendVerificationRejectedEmail('', { type: 'identity', reason: 'x' })).resolves.toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
