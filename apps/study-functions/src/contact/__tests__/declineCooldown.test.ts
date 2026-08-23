import { describe, it, expect, vi } from 'vitest';
import {
  DECLINE_COOLDOWN_MS,
  latestDeclineMs,
  repairTimestamplessDeclines,
} from '../declineCooldown.js';

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
    //
    // On its own this silences the pair FOREVER -- the value is recomputed on
    // every call, so the difference never grows (issue #214). What bounds it is
    // repairTimestamplessDeclines, pinned below: callers stamp the doc first,
    // so the next call reads a real anchor and the week actually elapses.
    const before = Date.now();
    const got = latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor' }], 'tutor')!;
    expect(got).toBeGreaterThanOrEqual(before);
    expect(Date.now() - got).toBeLessThan(DECLINE_COOLDOWN_MS);
  });

  it('exports a seven-day window', () => {
    expect(DECLINE_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('repairTimestamplessDeclines', () => {
  const AT = new Date(50_000);

  function doc(data: Record<string, unknown>, update = vi.fn().mockResolvedValue(undefined)) {
    return { data: () => data, ref: { update }, update };
  }

  it('stamps updatedAt on a matching decline that carries no timestamp', async () => {
    const d = doc({ status: 'declined', initiatedBy: 'tutor' });
    expect(await repairTimestamplessDeclines([d], 'tutor', AT)).toBe(1);
    expect(d.update).toHaveBeenCalledWith({ updatedAt: AT });
  });

  it('leaves a decline that already has any readable timestamp alone', async () => {
    const docs = [
      doc({ status: 'declined', initiatedBy: 'tutor', respondedAt: ts(1_000) }),
      doc({ status: 'declined', initiatedBy: 'tutor', updatedAt: ts(1_000) }),
      doc({ status: 'declined', initiatedBy: 'tutor', createdAt: ts(1_000) }),
    ];
    expect(await repairTimestamplessDeclines(docs, 'tutor', AT)).toBe(0);
    for (const d of docs) expect(d.update).not.toHaveBeenCalled();
  });

  it('ignores declines opened by the other side, and non-declines', async () => {
    const docs = [
      doc({ status: 'declined', initiatedBy: 'family' }),
      doc({ status: 'pending', initiatedBy: 'tutor' }),
      doc({ status: 'accepted', initiatedBy: 'tutor' }),
    ];
    expect(await repairTimestamplessDeclines(docs, 'tutor', AT)).toBe(0);
    for (const d of docs) expect(d.update).not.toHaveBeenCalled();
  });

  it('treats a legacy decline with no initiatedBy as family-opened', async () => {
    const legacy = doc({ status: 'declined' });
    expect(await repairTimestamplessDeclines([legacy], 'tutor', AT)).toBe(0);
    expect(await repairTimestamplessDeclines([legacy], 'family', AT)).toBe(1);
  });

  it('never throws when the repair write fails -- the caller refuses either way', async () => {
    const d = doc({ status: 'declined', initiatedBy: 'tutor' }, vi.fn().mockRejectedValue(new Error('denied')));
    await expect(repairTimestamplessDeclines([d], 'tutor', AT)).resolves.toBe(0);
  });

  it('anchors the window: after the repair the decline ages out normally', async () => {
    // The doc the caller re-reads on the NEXT attempt carries the stamp, so
    // latestDeclineMs reports a fixed point that a week can pass from.
    const stamped = { status: 'declined', initiatedBy: 'tutor', updatedAt: asDate(50_000) };
    expect(latestDeclineMs([stamped], 'tutor')).toBe(50_000);
  });
});
