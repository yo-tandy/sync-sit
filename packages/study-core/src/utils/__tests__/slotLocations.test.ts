import { describe, it, expect } from 'vitest';
import {
  sanitizeDayLocations,
  resolveEffectiveLocations,
  splitRangesByLocation,
} from '../slotLocations.js';
import type { LocationPref } from '../../types/subject.js';

// Grid helpers — 96 fifteen-minute slots per day (same space as availability).
const allFalse = () => new Array(96).fill(false) as boolean[];

const DEFAULTS: LocationPref[] = ['family_home', 'online'];

describe('sanitizeDayLocations', () => {
  it('returns 96 null cells for absent or non-object input', () => {
    for (const raw of [undefined, null, 'junk', 42, true, ['online']]) {
      const cells = sanitizeDayLocations(raw);
      expect(cells).toHaveLength(96);
      expect(cells.every((c) => c === null)).toBe(true);
    }
  });

  it('places sparse entries at their slot index and leaves the rest null', () => {
    const cells = sanitizeDayLocations({ '68': ['online'], '69': ['online'] });
    expect(cells).toHaveLength(96);
    expect(cells[68]).toEqual(['online']);
    expect(cells[69]).toEqual(['online']);
    expect(cells[67]).toBeNull();
    expect(cells[70]).toBeNull();
  });

  it('drops junk keys: non-numeric, fractional, negative, out of range', () => {
    const cells = sanitizeDayLocations({
      abc: ['online'],
      '5.5': ['online'],
      '-1': ['online'],
      '96': ['online'],
      '007x': ['online'],
      '10': ['tutor_home'],
    });
    expect(cells.filter((c) => c !== null)).toHaveLength(1);
    expect(cells[10]).toEqual(['tutor_home']);
  });

  it('drops junk values: non-arrays, non-vocabulary elements, and empties', () => {
    const cells = sanitizeDayLocations({
      '1': 'online', // not an array
      '2': { online: true }, // not an array
      '3': ['zoom', 42, null], // nothing from the vocabulary
      '4': [], // empty override is not a state we store
      '5': ['online', 'zoom', 'online'], // junk + duplicate filtered
    });
    expect(cells[1]).toBeNull();
    expect(cells[2]).toBeNull();
    expect(cells[3]).toBeNull();
    expect(cells[4]).toBeNull();
    expect(cells[5]).toEqual(['online']);
  });

  it('canonicalizes element order to the LOCATION_PREFS order', () => {
    const cells = sanitizeDayLocations({ '0': ['library', 'online', 'family_home'] });
    expect(cells[0]).toEqual(['family_home', 'online', 'library']);
  });
});

describe('resolveEffectiveLocations', () => {
  it('returns the profile defaults when no cell carries an override', () => {
    const cells = sanitizeDayLocations({});
    expect(resolveEffectiveLocations(cells, 68, 72, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('returns the defaults when cells are absent entirely (legacy doc)', () => {
    expect(resolveEffectiveLocations(undefined, 68, 72, DEFAULTS)).toEqual(DEFAULTS);
    expect(resolveEffectiveLocations(null, 68, 72, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('returns a uniform override covering the whole range', () => {
    const cells = sanitizeDayLocations({ '68': ['online'], '69': ['online'] });
    expect(resolveEffectiveLocations(cells, 68, 70, DEFAULTS)).toEqual(['online']);
  });

  it('intersects when the range spans overridden and default cells', () => {
    // Cell 68 override [online]; cell 69 defaults [family_home, online].
    const cells = sanitizeDayLocations({ '68': ['online'] });
    expect(resolveEffectiveLocations(cells, 68, 70, DEFAULTS)).toEqual(['online']);
  });

  it('returns an empty set when overrides in the range are disjoint', () => {
    const cells = sanitizeDayLocations({ '68': ['online'], '69': ['tutor_home'] });
    expect(resolveEffectiveLocations(cells, 68, 70, DEFAULTS)).toEqual([]);
  });

  it('canonicalizes the result to the LOCATION_PREFS order', () => {
    const cells = sanitizeDayLocations({});
    expect(
      resolveEffectiveLocations(cells, 0, 1, ['library', 'online'] as LocationPref[]),
    ).toEqual(['online', 'library']);
  });
});

describe('splitRangesByLocation', () => {
  it('returns no ranges for an all-false grid', () => {
    expect(splitRangesByLocation(allFalse(), sanitizeDayLocations({}), DEFAULTS)).toEqual([]);
  });

  it('emits one defaults range for a contiguous run without overrides', () => {
    const slots = allFalse();
    for (let i = 68; i < 76; i++) slots[i] = true; // 17:00-19:00
    expect(splitRangesByLocation(slots, sanitizeDayLocations({}), DEFAULTS)).toEqual([
      { startIdx: 68, endIdx: 76, locations: DEFAULTS },
    ]);
  });

  it('treats an absent cells array (legacy doc) as all defaults', () => {
    const slots = allFalse();
    slots[10] = slots[11] = true;
    expect(splitRangesByLocation(slots, undefined, DEFAULTS)).toEqual([
      { startIdx: 10, endIdx: 12, locations: DEFAULTS },
    ]);
  });

  it('splits a run where the effective set changes', () => {
    const slots = allFalse();
    for (let i = 68; i < 76; i++) slots[i] = true;
    const cells = sanitizeDayLocations({
      '68': ['online'],
      '69': ['online'],
      '70': ['online'],
      '71': ['online'],
    });
    expect(splitRangesByLocation(slots, cells, DEFAULTS)).toEqual([
      { startIdx: 68, endIdx: 72, locations: ['online'] },
      { startIdx: 72, endIdx: 76, locations: DEFAULTS },
    ]);
  });

  it('does not split when an override equals the defaults set', () => {
    const slots = allFalse();
    for (let i = 20; i < 24; i++) slots[i] = true;
    const cells = sanitizeDayLocations({
      '20': ['online', 'family_home'],
      '21': ['family_home', 'online'],
    });
    expect(splitRangesByLocation(slots, cells, DEFAULTS)).toEqual([
      { startIdx: 20, endIdx: 24, locations: DEFAULTS },
    ]);
  });

  it('keeps separate active runs as separate ranges', () => {
    const slots = allFalse();
    slots[4] = slots[5] = true;
    slots[40] = true;
    // 'library' is valid vocabulary but outside DEFAULTS: the advertised set
    // is the INTERSECTION with the profile prefs (PR #185 r2 review) — a
    // dead range advertises [], matching what resolveEffectiveLocations
    // validates, instead of offering a location the tutor does not accept.
    const cells = sanitizeDayLocations({ '40': ['library'] });
    expect(splitRangesByLocation(slots, cells, DEFAULTS)).toEqual([
      { startIdx: 4, endIdx: 6, locations: DEFAULTS },
      { startIdx: 40, endIdx: 41, locations: [] },
    ]);
  });

  it('advertises the intersection when a tag partially falls outside the prefs', () => {
    const slots = allFalse();
    slots[50] = slots[51] = true;
    // Tagged online+library while prefs are family_home+online: advertise
    // only what BOTH allow. Note the intersected set differs from DEFAULTS,
    // so the run still splits from an adjacent untagged run.
    const cells = sanitizeDayLocations({ '50': ['online', 'library'], '51': ['online', 'library'] });
    expect(splitRangesByLocation(slots, cells, DEFAULTS)).toEqual([
      { startIdx: 50, endIdx: 52, locations: ['online'] },
    ]);
  });

  it('advertise and validate paths agree on an outside-prefs tag', () => {
    const cells = sanitizeDayLocations({ '40': ['library'] });
    const slots = allFalse();
    slots[40] = true;
    const advertised = splitRangesByLocation(slots, cells, DEFAULTS)[0].locations;
    expect(advertised).toEqual(resolveEffectiveLocations(cells, 40, 41, DEFAULTS));
    expect(advertised).toEqual([]);
  });

  it('ignores override entries on inactive cells', () => {
    const slots = allFalse();
    slots[30] = true;
    const cells = sanitizeDayLocations({ '31': ['tutor_home'] });
    expect(splitRangesByLocation(slots, cells, DEFAULTS)).toEqual([
      { startIdx: 30, endIdx: 31, locations: DEFAULTS },
    ]);
  });
});
