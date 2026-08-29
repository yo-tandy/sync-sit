import { describe, it, expect } from 'vitest';
import { buildAccountExistsEmail, normalizeAccountExistsApp } from '../email.js';

// Copy-selection pins for the silent existing-account email (issue #148).
// The app param is untrusted client input: it only ever selects between the
// two literal copy sets and must collapse to 'sit' for anything else.

describe('normalizeAccountExistsApp', () => {
  it("passes through the three literal values", () => {
    expect(normalizeAccountExistsApp('sit')).toBe('sit');
    expect(normalizeAccountExistsApp('study')).toBe('study');
    // 'do' passes through since sync-do plan §13 PR9 — the PR4 deferral
    // (do collapsed to sit until the branding tables existed) is closed.
    expect(normalizeAccountExistsApp('do')).toBe('do');
  });

  it("defaults anything else to 'sit' (unknown strings, injection attempts, non-strings)", () => {
    expect(normalizeAccountExistsApp(undefined)).toBe('sit');
    expect(normalizeAccountExistsApp(null)).toBe('sit');
    expect(normalizeAccountExistsApp('')).toBe('sit');
    expect(normalizeAccountExistsApp('STUDY')).toBe('sit');
    expect(normalizeAccountExistsApp('DO')).toBe('sit');
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

  it('do copy names Sync/Do and links the LIVE web.app login page (never sync-do.com)', () => {
    const { subject, html } = buildAccountExistsEmail('do');
    expect(subject).toContain('Sync/Do');
    expect(html).toContain('create a Sync/Do account');
    expect(html).toContain('https://sync-do-app.web.app/login');
    expect(html).not.toContain('sync-do.com');
    expect(html).not.toContain('https://sync-sit.web.app/login');
  });

  it('sit and study copy carry NO Sync/Do mention (decision 20 — sibling apps must not surface sync-do)', () => {
    for (const app of ['sit', 'study'] as const) {
      const { subject, html } = buildAccountExistsEmail(app);
      expect(subject).not.toContain('Sync/Do');
      expect(html).not.toContain('Sync/Do');
      expect(html).not.toContain('sync-do-app.web.app');
    }
  });

  it('cross-app credentials line, invite-link hint, and support contact are present for all apps', () => {
    for (const app of ['sit', 'study', 'do'] as const) {
      const { html } = buildAccountExistsEmail(app);
      // Name-free cross-app line: decision 20 (sync-do plan §2) bars naming
      // Sync/Do inside sit/study-branded copy, so the shared sentence names
      // no sibling at all.
      expect(html).toContain('works across the Sync apps');
      expect(html).toContain('the same email and password sign you in to each of them');
      expect(html).toContain('If you were following an invite link, open it again after logging in.');
      expect(html).toContain('support@sync-sit.com');
    }
  });

  it('never mentions a verification code (the email replaces the code email)', () => {
    for (const app of ['sit', 'study', 'do'] as const) {
      const { subject, html } = buildAccountExistsEmail(app);
      expect(subject.toLowerCase()).not.toContain('code');
      expect(html.toLowerCase()).not.toContain('verification code');
    }
  });
});
