import { describe, it, expect } from 'vitest';
import { DECLINE_COOLDOWN_MS, latestDeclineMs } from '../declineCooldown.js';

/**
 * Unit pins for the shared cooldown helper (issue #207 PR4, PR #213 review).
 * Two behaviours are load-bearing and invisible from the call sites: WHICH
 * declines count for a given asker, and that an unreadable timestamp fails
 * CLOSED rather than opening the gate.
 */
const ts = (ms: number) => ({ toMillis: () => ms });
const asDate = (ms: number) => ({ toDate: () => new Date(ms) });

describe('latestDeclineMs', () => {
  it('returns null when nothing was declined', () => {
    expect(latestDeclineMs([], 'tutor')).toBeNull();
    expect(
      latestDeclineMs([{ status: 'pending', initiatedBy: 'tutor' }], 'tutor'),
    ).toBeNull();
  });

  it('counts only declines of requests the named side OPENED', () => {
    const docs = [
      { status: 'declined', initiatedBy: 'tutor', respondedAt: ts(5_000) },
      { status: 'declined', respondedAt: ts(9_000) }, // family-initiated (legacy shape)
    ];
    expect(latestDeclineMs(docs, 'tutor')).toBe(5_000);
    expect(latestDeclineMs(docs, 'family')).toBe(9_000);
  });

  it('treats an ABSENT initiatedBy as family — every legacy doc predates the inversion', () => {
    const docs = [{ status: 'declined', respondedAt: ts(1_000) }];
    expect(latestDeclineMs(docs, 'family')).toBe(1_000);
    expect(latestDeclineMs(docs, 'tutor')).toBeNull();
  });

  it('takes the MOST RECENT matching decline, not the first or the newest doc', () => {
    const docs = [
      { status: 'declined', initiatedBy: 'tutor', respondedAt: ts(3_000) },
      { status: 'declined', initiatedBy: 'tutor', respondedAt: ts(7_000) },
      { status: 'declined', initiatedBy: 'tutor', respondedAt: ts(1_000) },
    ];
    expect(latestDeclineMs(docs, 'tutor')).toBe(7_000);
  });

  it('measures the DECLINE, falling back through updatedAt to createdAt', () => {
    // The old inline cooldown measured createdAt — the moment the request was
    // sent — so a request declined months later was already out of cooldown.
    expect(
      latestDeclineMs(
        [{ status: 'declined', initiatedBy: 'tutor', respondedAt: ts(9_000), createdAt: ts(1_000) }],
        'tutor',
      ),
    ).toBe(9_000);
    expect(
      latestDeclineMs(
        [{ status: 'declined', initiatedBy: 'tutor', updatedAt: ts(8_000), createdAt: ts(1_000) }],
        'tutor',
      ),
    ).toBe(8_000);
    expect(
      latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor', createdAt: ts(1_000) }], 'tutor'),
    ).toBe(1_000);
  });

  it('accepts a Date-shaped timestamp as well as a Timestamp', () => {
    expect(
      latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor', respondedAt: asDate(4_000) }], 'tutor'),
    ).toBe(4_000);
  });

  it('fails CLOSED on a decline with no readable timestamp', () => {
    // Reported as ~now, so the caller stays inside the cooldown. The
    // alternative re-notifies someone who already said no.
    const before = Date.now();
    const got = latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor' }], 'tutor')!;
    expect(got).toBeGreaterThanOrEqual(before);
    expect(Date.now() - got).toBeLessThan(DECLINE_COOLDOWN_MS);
  });

  it('exports a seven-day window', () => {
    expect(DECLINE_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
