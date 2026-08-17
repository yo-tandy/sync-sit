import { describe, it, expect } from 'vitest';
import { buildAccountExistsEmail, normalizeAccountExistsApp } from '../email.js';

// Copy-selection pins for the silent existing-account email (issue #148).
// The app param is untrusted client input: it only ever selects between the
// two literal copy sets and must collapse to 'sit' for anything else.

describe('normalizeAccountExistsApp', () => {
  it("passes through the two literal values", () => {
    expect(normalizeAccountExistsApp('sit')).toBe('sit');
    expect(normalizeAccountExistsApp('study')).toBe('study');
  });

  it("defaults anything else to 'sit' (unknown strings, injection attempts, non-strings)", () => {
    expect(normalizeAccountExistsApp(undefined)).toBe('sit');
    expect(normalizeAccountExistsApp(null)).toBe('sit');
    expect(normalizeAccountExistsApp('')).toBe('sit');
    expect(normalizeAccountExistsApp('STUDY')).toBe('sit');
    expect(normalizeAccountExistsApp('<script>alert(1)</script>')).toBe('sit');
    expect(normalizeAccountExistsApp(42)).toBe('sit');
    expect(normalizeAccountExistsApp({ app: 'study' })).toBe('sit');
  });
});

describe('buildAccountExistsEmail', () => {
  it('sit copy names Sync/Sit and links the sit login page', () => {
    const { subject, html } = buildAccountExistsEmail('sit');
    expect(subject).toContain('Sync/Sit');
    expect(html).toContain('create a Sync/Sit account');
    expect(html).toContain('https://sync-sit.web.app/login');
    expect(html).not.toContain('https://sync-study-app.web.app/login');
  });

  it('study copy names Sync/Study and links the study login page', () => {
    const { subject, html } = buildAccountExistsEmail('study');
    expect(subject).toContain('Sync/Study');
    expect(html).toContain('create a Sync/Study account');
    expect(html).toContain('https://sync-study-app.web.app/login');
    expect(html).not.toContain('https://sync-sit.web.app/login');
  });

  it('cross-app credentials line, invite-link hint, and support contact are present for both apps', () => {
    for (const app of ['sit', 'study'] as const) {
      const { html } = buildAccountExistsEmail(app);
      expect(html).toContain('works on both Sync/Sit and Sync/Study');
      expect(html).toContain('the same email and password sign you in to either app');
      expect(html).toContain('If you were following an invite link, open it again after logging in.');
      expect(html).toContain('support@sync-sit.com');
    }
  });

  it('never mentions a verification code (the email replaces the code email)', () => {
    for (const app of ['sit', 'study'] as const) {
      const { subject, html } = buildAccountExistsEmail(app);
      expect(subject.toLowerCase()).not.toContain('code');
      expect(html.toLowerCase()).not.toContain('verification code');
    }
  });
});
