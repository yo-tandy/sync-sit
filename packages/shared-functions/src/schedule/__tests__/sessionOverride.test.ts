import { describe, it, expect } from 'vitest';
import {
  buildMergedOverride,
  buildRestoredOverride,
  type SessionBlockEntry,
} from '../sessionOverride.js';

// Direct unit coverage of the generalized ledger engine that both study session
// confirms and sit appointment confirms share. Provenance is parameterized:
// study stamps { appSource:'study', reason:'study_session' }, sit stamps
// { appSource:'sit', reason:'appointment' }. The tests prove the AND-only merge,
// foreign preservation, current-slots restore, conditional delete, and — the
// point of the extraction — that a mixed sit+study ledger restores each app's
// claim while respecting the other's range.

const STUDY = { appSource: 'study', reason: 'study_session' } as const;
const SIT = { appSource: 'sit', reason: 'appointment' } as const;
const NOW = new Date('2026-07-22T10:00:00.000Z');

/** A weekly grid open 16:00–20:00 (slots 64..79), else closed. */
function weeklyGrid(): boolean[] {
  const g = new Array(96).fill(false);
  for (let i = 64; i < 80; i++) g[i] = true;
  return g;
}

describe('buildMergedOverride', () => {
  it('creates a custom doc from the weekly grid, ANDing the block false + appending the ledger', () => {
    const entry: SessionBlockEntry = { appointmentId: 'apt-1', startIdx: 64, endIdx: 68 };
    const doc = buildMergedOverride({
      existing: null,
      date: '2027-06-07',
      weeklySlots: weeklyGrid(),
      block: { start: 64, end: 68 },
      entry,
      ownProvenance: SIT,
      now: NOW,
    });
    const slots = doc.slots as boolean[];
    expect(doc.type).toBe('custom');
    expect(doc.appSource).toBe('sit');
    expect(doc.reason).toBe('appointment');
    expect(doc.sessionBlocks).toEqual([entry]);
    // Block ANDed false; rest of the weekly-open window still true.
    expect(slots[64]).toBe(false);
    expect(slots[67]).toBe(false);
    expect(slots[68]).toBe(true);
    expect(slots[79]).toBe(true);
    // Closed weekly slots stay closed.
    expect(slots[0]).toBe(false);
    expect(doc.createdAt).toBe(NOW);
  });

  it('merges into an existing (foreign) doc: ANDs the block, appends the entry, PRESERVES provenance', () => {
    const slots = new Array(96).fill(true);
    slots[70] = false; // a pre-existing foreign block
    const existing = {
      date: '2027-06-07',
      type: 'custom',
      slots,
      appSource: 'study',
      reason: 'study_session',
      sessionBlocks: [{ sessionId: 'sess-a', startIdx: 64, endIdx: 68 }],
    };
    const sitEntry: SessionBlockEntry = { appointmentId: 'apt-1', startIdx: 72, endIdx: 76 };
    const doc = buildMergedOverride({
      existing,
      date: '2027-06-07',
      weeklySlots: weeklyGrid(),
      block: { start: 72, end: 76 },
      entry: sitEntry,
      ownProvenance: SIT, // sit merging into a STUDY-owned doc
      now: NOW,
    });
    const out = doc.slots as boolean[];
    // Foreign owner's provenance kept (first claimant owns the doc).
    expect(doc.appSource).toBe('study');
    expect(doc.reason).toBe('study_session');
    // Both ledgers coexist.
    expect(doc.sessionBlocks).toEqual([
      { sessionId: 'sess-a', startIdx: 64, endIdx: 68 },
      sitEntry,
    ]);
    // Our block ANDed false; the pre-existing foreign block preserved.
    expect(out[72]).toBe(false);
    expect(out[75]).toBe(false);
    expect(out[70]).toBe(false); // never resurrected
    expect(out[64]).toBe(true); // untouched by our claim
    expect(doc.createdAt).toBeUndefined(); // merge never stamps createdAt
  });

  it('bases an existing whole-day unavailable doc on all-false slots', () => {
    const doc = buildMergedOverride({
      existing: { date: '2027-06-07', type: 'unavailable', reason: 'appointment' },
      date: '2027-06-07',
      weeklySlots: weeklyGrid(),
      block: { start: 64, end: 68 },
      entry: { appointmentId: 'apt-2', startIdx: 64, endIdx: 68 },
      ownProvenance: SIT,
      now: NOW,
    });
    const slots = doc.slots as boolean[];
    expect(slots.every((s) => s === false)).toBe(true);
    expect(doc.type).toBe('unavailable'); // preserved
  });
});

describe('buildRestoredOverride', () => {
  const matchApt = (id: string) => (b: SessionBlockEntry) => b.appointmentId === id;

  it('returns none when no override doc exists', () => {
    expect(
      buildRestoredOverride({
        existing: null,
        matches: matchApt('apt-1'),
        weeklySlots: weeklyGrid(),
        ownProvenance: SIT,
        now: NOW,
      }),
    ).toEqual({ action: 'none' });
  });

  it('deletes an ours-only doc whose sole claim is removed and slots revert to weekly', () => {
    const slots = weeklyGrid();
    for (let i = 64; i < 68; i++) slots[i] = false;
    const res = buildRestoredOverride({
      existing: {
        date: '2027-06-07',
        type: 'custom',
        slots,
        appSource: 'sit',
        reason: 'appointment',
        sessionBlocks: [{ appointmentId: 'apt-1', startIdx: 64, endIdx: 68 }],
      },
      matches: matchApt('apt-1'),
      weeklySlots: weeklyGrid(),
      ownProvenance: SIT,
      now: NOW,
    });
    expect(res).toEqual({ action: 'delete' });
  });

  it('current-slots restore reopens ONLY the removed range where weekly allows', () => {
    const slots = weeklyGrid();
    for (let i = 64; i < 68; i++) slots[i] = false; // our claim
    slots[76] = false; // a ledgerless block OUTSIDE our range
    const res = buildRestoredOverride({
      existing: {
        date: '2027-06-07',
        type: 'custom',
        slots,
        appSource: 'sit',
        reason: 'appointment',
        sessionBlocks: [{ appointmentId: 'apt-1', startIdx: 64, endIdx: 68 }],
      },
      matches: matchApt('apt-1'),
      weeklySlots: weeklyGrid(),
      ownProvenance: SIT,
      now: NOW,
    });
    expect(res.action).toBe('set');
    const doc = (res as { action: 'set'; doc: Record<string, unknown> }).doc;
    const out = doc.slots as boolean[];
    expect(out[64]).toBe(true); // reopened
    expect(out[67]).toBe(true);
    expect(out[76]).toBe(false); // ledgerless block OUTSIDE range survives
    expect(doc.sessionBlocks).toEqual([]);
  });

  it('conserves a FOREIGN doc: drops only our ledger entry, keeps every slot', () => {
    const slots = new Array(96).fill(true);
    slots[40] = false; // foreign block
    slots[72] = false; // our claim's slot (but doc is foreign to us)
    const res = buildRestoredOverride({
      existing: {
        date: '2027-06-07',
        type: 'custom',
        slots,
        appSource: 'study', // foreign to SIT
        reason: 'study_session',
        sessionBlocks: [
          { sessionId: 'sess-a', startIdx: 64, endIdx: 68 },
          { appointmentId: 'apt-1', startIdx: 72, endIdx: 76 },
        ],
      },
      matches: matchApt('apt-1'),
      weeklySlots: weeklyGrid(),
      ownProvenance: SIT,
      now: NOW,
    });
    expect(res.action).toBe('set');
    const doc = (res as { action: 'set'; doc: Record<string, unknown> }).doc;
    // Only our entry dropped; slots untouched (72 stays blocked — conservative).
    expect(doc.sessionBlocks).toEqual([{ sessionId: 'sess-a', startIdx: 64, endIdx: 68 }]);
    expect((doc.slots as boolean[])[72]).toBe(false);
    expect((doc.slots as boolean[])[40]).toBe(false);
  });

  // ── The cross-app point of the extraction: mixed sit+study ledger ──
  it('restoring the SIT claim from a sit-owned doc respects the surviving STUDY entry', () => {
    // sit-owned doc claiming 64..67 (sit) and 72..75 (study, merged in).
    const slots = weeklyGrid();
    for (let i = 64; i < 68; i++) slots[i] = false; // sit
    for (let i = 72; i < 76; i++) slots[i] = false; // study
    const res = buildRestoredOverride({
      existing: {
        date: '2027-06-07',
        type: 'custom',
        slots,
        appSource: 'sit',
        reason: 'appointment',
        sessionBlocks: [
          { appointmentId: 'apt-1', startIdx: 64, endIdx: 68 },
          { sessionId: 'sess-a', startIdx: 72, endIdx: 76 },
        ],
      },
      matches: matchApt('apt-1'),
      weeklySlots: weeklyGrid(),
      ownProvenance: SIT,
      now: NOW,
    });
    const doc = (res as { action: 'set'; doc: Record<string, unknown> }).doc;
    const out = doc.slots as boolean[];
    // sit's range reopened...
    expect(out[64]).toBe(true);
    expect(out[67]).toBe(true);
    // ...but study's block survives (its entry still covers 72..75).
    expect(out[72]).toBe(false);
    expect(out[75]).toBe(false);
    expect(doc.sessionBlocks).toEqual([{ sessionId: 'sess-a', startIdx: 72, endIdx: 76 }]);
  });

  it('restoring the STUDY claim from a sit-owned doc is foreign-conservative (sit block survives)', () => {
    const slots = weeklyGrid();
    for (let i = 64; i < 68; i++) slots[i] = false; // sit
    for (let i = 72; i < 76; i++) slots[i] = false; // study
    const res = buildRestoredOverride({
      existing: {
        date: '2027-06-07',
        type: 'custom',
        slots,
        appSource: 'sit', // foreign to STUDY
        reason: 'appointment',
        sessionBlocks: [
          { appointmentId: 'apt-1', startIdx: 64, endIdx: 68 },
          { sessionId: 'sess-a', startIdx: 72, endIdx: 76 },
        ],
      },
      matches: (b) => b.sessionId === 'sess-a',
      weeklySlots: weeklyGrid(),
      ownProvenance: STUDY,
      now: NOW,
    });
    const doc = (res as { action: 'set'; doc: Record<string, unknown> }).doc;
    const out = doc.slots as boolean[];
    // Conservative: nothing reopened; sit's block untouched.
    expect(out[64]).toBe(false);
    expect(out[72]).toBe(false);
    expect(doc.sessionBlocks).toEqual([{ appointmentId: 'apt-1', startIdx: 64, endIdx: 68 }]);
  });
});
