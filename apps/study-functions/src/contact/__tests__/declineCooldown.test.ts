import { describe, it, expect, vi } from 'vitest';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import {
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

  it('reads export/import shapes rather than repairing over them', () => {
    // A JSON export/re-import leaves plain maps, numbers or strings behind.
    // Reading them matters twice over: the original decline time survives,
    // and an old imported decline ages out instead of getting a fresh week
    // from the repair (PR #219 review).
    const cases: [unknown, number][] = [
      [4_000, 4_000],
      [new Date(4_000).toISOString(), 4_000],
      [new Date(4_000), 4_000],
      [{ _seconds: 4, _nanoseconds: 0 }, 4_000],
      [{ seconds: 4, nanoseconds: 500_000_000 }, 4_500],
    ];
    for (const [respondedAt, expected] of cases) {
      expect(
        latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor', respondedAt }], 'tutor'),
      ).toBe(expected);
    }
    // Genuinely unreadable values still fail closed.
    const before = Date.now();
    expect(
      latestDeclineMs([{ status: 'declined', initiatedBy: 'tutor', respondedAt: 'not a date', updatedAt: NaN }], 'tutor')!,
    ).toBeGreaterThanOrEqual(before);
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
    expect(Date.now() - got).toBeLessThan(ADMIN_CONFIG_DEFS.declineCooldownDays.default * 86400_000);
  });

  it('exports a seven-day window', () => {
    expect(ADMIN_CONFIG_DEFS.declineCooldownDays.default).toBe(7);
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

  it('anchors the window: latestDeclineMs reads exactly what the repair writes', async () => {
    // The contract between the two functions: the repair's field name and
    // value shape must sit on latestDeclineMs's fallback chain. Merging the
    // update payload into the backing object pins the round-trip -- a repair
    // that wrote the wrong field, a non-timestamp value, or nothing at all
    // fails here (PR #219 review; the earlier version of this test hand-built
    // the stamped doc and never called the repair).
    const backing: Record<string, unknown> = { status: 'declined', initiatedBy: 'tutor' };
    const update = vi.fn(async (payload: Record<string, unknown>) => {
      Object.assign(backing, payload);
    });
    expect(await repairTimestamplessDeclines([{ data: () => backing, ref: { update } }], 'tutor', AT)).toBe(1);
    expect(latestDeclineMs([backing], 'tutor')).toBe(AT.getTime());
    // AT is far in the past, so the anchored decline is already outside the
    // window: the pair is no longer silenced, which is the whole point.
    expect(Date.now() - latestDeclineMs([backing], 'tutor')!).toBeGreaterThan(ADMIN_CONFIG_DEFS.declineCooldownDays.default * 86400_000);
  });
});
