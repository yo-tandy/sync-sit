import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildNotificationEmailHtml, sendNotificationEmail, escapeHtml, STUDY_APP_URL, DO_APP_URL } from '../email.js';

// Branding pins for the shared notification email wrapper (issue #168 Phase 0).
// Study emails must carry no Sync/Sit branding and link the study host; the
// sit default must stay byte-identical in spirit to the pre-#168 wrapper.

describe('buildNotificationEmailHtml', () => {
  it('defaults to sit branding: Sync/Sit name, red accent, sync-sit.com footer link', () => {
    const html = buildNotificationEmailHtml('<p>hello</p>');
    expect(html).toContain('Sync/Sit');
    expect(html).toContain('#DC2626');
    expect(html).toContain('https://sync-sit.com');
    expect(html).toContain('Open Sync/Sit');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toContain('Sync/Study');
    expect(html).not.toContain('sync-study-app.web.app');
  });

  it("explicit 'sit' matches the default", () => {
    expect(buildNotificationEmailHtml('<p>x</p>', 'sit')).toBe(buildNotificationEmailHtml('<p>x</p>'));
  });

  it('study branding names Sync/Study, blue accent, links the study host, and carries no Sync/Sit text', () => {
    const html = buildNotificationEmailHtml('<p>hello</p>', 'study');
    expect(html).toContain('Sync/Study');
    expect(html).toContain('#2563EB');
    expect(html).toContain('https://sync-study-app.web.app');
    expect(html).toContain('Open Sync/Study');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toContain('Sync/Sit');
    expect(html).not.toContain('#DC2626');
    // The wrapper itself must not point at the sit host. "Sync/Sit" is a
    // substring-free check already; also pin the sit host absent outside the
    // caller-supplied body.
    expect(buildNotificationEmailHtml('', 'study')).not.toContain('https://sync-sit.com');
  });

  it('the study footer links the exported STUDY_APP_URL (one host for CTA, footer, and push)', () => {
    expect(buildNotificationEmailHtml('', 'study')).toContain(STUDY_APP_URL);
  });

  it('do branding names Sync/Do, green accent, links the LIVE do host, and carries no sibling branding', () => {
    const html = buildNotificationEmailHtml('<p>hello</p>', 'do');
    expect(html).toContain('Sync/Do');
    expect(html).toContain('#0d8204');
    expect(html).toContain(DO_APP_URL);
    expect(html).toContain('Open Sync/Do');
    expect(html).toContain('<p>hello</p>');
    expect(html).not.toContain('Sync/Sit');
    expect(html).not.toContain('Sync/Study');
    expect(html).not.toContain('#DC2626');
    // §10/#156 rule: CTAs build on the live web.app host, never sync-do.com.
    expect(html).not.toContain('sync-do.com');
    expect(buildNotificationEmailHtml('', 'do')).not.toContain('https://sync-sit.com');
  });

  it('the do footer links the exported DO_APP_URL (one host for CTA, footer, and push)', () => {
    expect(DO_APP_URL).toBe('https://sync-do-app.web.app');
    expect(buildNotificationEmailHtml('', 'do')).toContain(DO_APP_URL);
  });
});

describe('escapeHtml', () => {
  it('neutralizes markup in a user-controlled string', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
    expect(escapeHtml('a & b "c" \'d\'')).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });

  it('leaves a plain name untouched', () => {
    expect(escapeHtml('Yael Cohen')).toBe('Yael Cohen');
  });

  it('escapes the ampersand first (no double-escaping)', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

// Return-value pins for the emailSent audit field (issue #168 Phase 0): a
// caller recording sendNotificationEmail's result must get false whenever
// nothing was handed to a transport.
describe('sendNotificationEmail return value (emailSent honesty)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns false for an invalid recipient (skip path)', async () => {
    await expect(sendNotificationEmail('', 'subject', '<p>b</p>', 'study')).resolves.toBe(false);
    await expect(sendNotificationEmail('not-an-email', 'subject', '<p>b</p>')).resolves.toBe(false);
  });

  it('returns true on the emulator [DEV] path — the dev log IS that transport\'s delivery', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    await expect(sendNotificationEmail('a@example.com', 'subject', '<p>b</p>', 'study')).resolves.toBe(true);
  });

  it('returns false when Resend is not configured (nothing was sent)', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'false');
    vi.stubEnv('RESEND_API_KEY', '');
    await expect(sendNotificationEmail('a@example.com', 'subject', '<p>b</p>')).resolves.toBe(false);
  });
});
