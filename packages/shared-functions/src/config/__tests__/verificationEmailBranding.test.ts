import { describe, it, expect } from 'vitest';
import { buildVerificationEmail, NOTIFICATION_BRANDING } from '../email.js';

/**
 * Per-app sender identity (issue #156): every branded surface of the
 * verification-code email follows the app hint, and the sender rows ride
 * the SAME verified domain with app-true display names -- a Sync/Study
 * user must never see Sync/Sit branding on a security-relevant email.
 */
describe('buildVerificationEmail', () => {
  it('sit copy is Sync/Sit-branded end to end', () => {
    const { subject, html } = buildVerificationEmail('123456', 'sit');
    expect(subject).toContain('Sync/Sit');
    expect(html).toContain('Sync/Sit');
    expect(html).not.toContain('Sync/Study');
    expect(html).toContain('123456');
  });

  it('study copy carries NO Sync/Sit branding and vice versa', () => {
    const { subject, html } = buildVerificationEmail('654321', 'study');
    expect(subject).toContain('Sync/Study');
    expect(html).toContain('Sync/Study');
    expect(html).not.toContain('Sync/Sit');
    expect(html).toContain('tutors');
  });

  it('do copy is Sync/Do-branded end to end — the PR4 deferral (doer codes arrived sit-branded) is closed', () => {
    const { subject, html } = buildVerificationEmail('222333', 'do');
    expect(subject).toContain('Sync/Do');
    expect(html).toContain('Sync/Do');
    expect(html).not.toContain('Sync/Sit');
    expect(html).not.toContain('Sync/Study');
    expect(html).toContain('helpers');
    expect(html).toContain('222333');
  });

  it('defaults to sit when no app is given (matches the callables\' normalize default)', () => {
    expect(buildVerificationEmail('111111').subject).toContain('Sync/Sit');
  });
});

describe('NOTIFICATION_BRANDING senders', () => {
  it('all apps send from the SAME verified domain with app-true display names', () => {
    expect(NOTIFICATION_BRANDING.sit.from).toBe('Sync/Sit <noreply@sync-sit.com>');
    expect(NOTIFICATION_BRANDING.study.from).toBe('Sync/Study <noreply@sync-sit.com>');
    expect(NOTIFICATION_BRANDING.study.fromFallback).toContain('Sync/Study');
    expect(NOTIFICATION_BRANDING.do.from).toBe('Sync/Do <noreply@sync-sit.com>');
    expect(NOTIFICATION_BRANDING.do.fromFallback).toContain('Sync/Do');
  });

  it('do branding builds on the LIVE web.app host — never sync-do.com (§10/#156)', () => {
    expect(NOTIFICATION_BRANDING.do.appUrl).toBe('https://sync-do-app.web.app');
  });
});
