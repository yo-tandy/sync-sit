import { describe, it, expect } from 'vitest';
import { computeEffectiveSearchable } from '../effectiveSearchable.js';

// One source of truth for "should this provider profile appear in search at
// all" (issue #435 PR2). Every combination of the three folded inputs is
// exercised here — this is the highest-value test surface in the PR: a pure
// function with no I/O, so every branch is cheap to pin.

describe('computeEffectiveSearchable', () => {
  it('true only when active + searchable + enrollmentComplete all hold', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: true, enrollmentComplete: true },
      ),
    ).toBe(true);
  });

  // Full truth table over the three boolean-ish inputs (status is
  // active/not-active for this purpose; blocked/invalid/deleted are all
  // "not active" and must behave identically to keep the hard-ban gate
  // absolute).
  const inactiveStatuses = ['invalid', 'blocked', 'deleted', undefined] as const;

  it('false when status is not active, regardless of the other two inputs', () => {
    for (const status of inactiveStatuses) {
      for (const searchable of [true, false, undefined]) {
        for (const enrollmentComplete of [true, false, undefined]) {
          expect(
            computeEffectiveSearchable(
              { status: status as never },
              { searchable, enrollmentComplete: enrollmentComplete as never },
            ),
          ).toBe(false);
        }
      }
    }
  });

  it('false when active but searchable is false', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: false, enrollmentComplete: true },
      ),
    ).toBe(false);
  });

  it('false when active but searchable is absent (undefined)', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: undefined, enrollmentComplete: true },
      ),
    ).toBe(false);
  });

  it('false when active + searchable but enrollmentComplete is false', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: true, enrollmentComplete: false },
      ),
    ).toBe(false);
  });

  it('false when active + searchable but enrollmentComplete is absent (undefined)', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: true, enrollmentComplete: undefined as unknown as boolean },
      ),
    ).toBe(false);
  });

  it('false when both searchable and enrollmentComplete are false', () => {
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: false, enrollmentComplete: false },
      ),
    ).toBe(false);
  });

  it('false when the profile is absent entirely (no babysitter/tutor profile on the doc)', () => {
    expect(computeEffectiveSearchable({ status: 'active' }, undefined)).toBe(false);
    expect(computeEffectiveSearchable({ status: 'active' }, null)).toBe(false);
  });

  it('false when the user is absent entirely', () => {
    expect(
      computeEffectiveSearchable(undefined, { searchable: true, enrollmentComplete: true }),
    ).toBe(false);
    expect(
      computeEffectiveSearchable(null, { searchable: true, enrollmentComplete: true }),
    ).toBe(false);
  });

  it('false when both user and profile are absent', () => {
    expect(computeEffectiveSearchable(undefined, undefined)).toBe(false);
    expect(computeEffectiveSearchable(null, null)).toBe(false);
  });

  it('rejects truthy-but-not-strictly-true stand-ins for searchable/enrollmentComplete', () => {
    // Guards against a future edit loosening `=== true` to a truthiness
    // check — Firestore can hand back any JSON value for a client-writable
    // field, and this function must not treat e.g. the string 'true' as true.
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: 'true' as unknown as boolean, enrollmentComplete: true },
      ),
    ).toBe(false);
    expect(
      computeEffectiveSearchable(
        { status: 'active' },
        { searchable: true, enrollmentComplete: 1 as unknown as boolean },
      ),
    ).toBe(false);
  });
});
