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

  it('defaults to sit when no app is given (matches the callables\' normalize default)', () => {
    expect(buildVerificationEmail('111111').subject).toContain('Sync/Sit');
  });
});

describe('NOTIFICATION_BRANDING senders', () => {
  it('both apps send from the SAME verified domain with app-true display names', () => {
    expect(NOTIFICATION_BRANDING.sit.from).toBe('Sync/Sit <noreply@sync-sit.com>');
    expect(NOTIFICATION_BRANDING.study.from).toBe('Sync/Study <noreply@sync-sit.com>');
    expect(NOTIFICATION_BRANDING.study.fromFallback).toContain('Sync/Study');
  });
});
