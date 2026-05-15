/**
 * L6: PhoneInput oracle-diff test.
 *
 * Gate 2 of the Phase -1 lint-cleanup verification sub-checklist (see
 * docs/agent-runs/agent-8-test-plan.md §3 row L6). The trickiest row
 * because the cleanup replaced an internal useState + useEffect mirror
 * of the `value` prop with pure derivation via parsePhone(value) on
 * every render. PhoneInput is now fully controlled.
 *
 * Post-cleanup pattern (read from
 * apps/web/src/components/forms/PhoneInput.tsx after merge 8e1272f):
 *   - Local state: NONE.
 *   - On every render: `const { countryCode, number } = parsePhone(value);`
 *   - handleCountryChange(code): onChange(formatFullNumber(code, number)).
 *   - handleNumberChange(num): leading-0 strip iff countryCode === '+33',
 *     then onChange(formatFullNumber(countryCode, cleaned)).
 *   - The barrel export of parsePhone/formatFullNumber/COUNTRY_CODES was
 *     removed; consumers can no longer import them directly. This test
 *     therefore observes their behavior through the component API only.
 *
 * Two test modes:
 *   1. DIRECT render of <PhoneInput .../> with a stable parent that
 *      passes a fixed `value` prop. Verifies parsing & display.
 *   2. WRAPPED render via <ControlledHarness/>, which holds the value
 *      in a parent useState and forwards onChange. This matches real
 *      RHF usage and lets us observe the round-trip: user types →
 *      onChange fires with cleaned value → parent rerenders → input
 *      reflects the cleaned value.
 *
 * Owned by agent-8-tester. Do not modify production code on failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { diffFrames } from '../../../hooks/__tests__/_helpers/replayHook';
import { PhoneInput } from '../PhoneInput';

// --- helpers ----------------------------------------------------------------

type DomFrame = {
  selectValue: string;
  inputValue: string;
  lastOnChange: string | null;
};

function readDom(container: HTMLElement): Omit<DomFrame, 'lastOnChange'> {
  const select = container.querySelector('select') as HTMLSelectElement | null;
  const input = container.querySelector('input[type="tel"]') as
    | HTMLInputElement
    | null;
  if (!select) throw new Error('PhoneInput: no <select> rendered');
  if (!input) throw new Error('PhoneInput: no <input type=tel> rendered');
  return { selectValue: select.value, inputValue: input.value };
}

// Stateful test harness: holds value in a useState and forwards onChange.
// Matches real-world usage with RHF (or any controlled parent). Exposes
// the latest received onChange string via the lastChangeRef object.
function ControlledHarness({
  initial,
  changes,
}: {
  initial: string;
  changes: { last: string | null };
}) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneInput
      label="Phone"
      value={value}
      onChange={(next) => {
        changes.last = next;
        setValue(next);
      }}
    />
  );
}

beforeEach(() => {
  // No fake timers needed — PhoneInput is sync.
});

afterEach(() => {
  vi.useRealTimers();
});

// --- tests: DIRECT render ---------------------------------------------------

describe('L6: PhoneInput — Gate 2 oracle-diff (direct render)', () => {
  it('initial render parses (countryCode, number) from value prop', () => {
    const cases: Array<{ value: string; selectValue: string; inputValue: string }> = [
      { value: '+33 0612345678', selectValue: '+33', inputValue: '0612345678' },
      { value: '+44 7700900123', selectValue: '+44', inputValue: '7700900123' },
      { value: '+1 5551234', selectValue: '+1', inputValue: '5551234' },
      { value: '', selectValue: '+33', inputValue: '' },
      // No prefix → parser falls back to +33 and treats the whole
      // string as the number portion.
      { value: '0612345678', selectValue: '+33', inputValue: '0612345678' },
    ];

    for (const c of cases) {
      const onChange = vi.fn();
      const { container, unmount } = render(
        <PhoneInput label="Phone" value={c.value} onChange={onChange} />,
      );
      expect(readDom(container)).toEqual({
        selectValue: c.selectValue,
        inputValue: c.inputValue,
      });
      // Pure render must not fire onChange.
      expect(onChange).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('rerender with a new value prop re-derives (countryCode, number) — no stale state', () => {
    const onChange = vi.fn();
    const { container, rerender, unmount } = render(
      <PhoneInput label="Phone" value="+33 0612345678" onChange={onChange} />,
    );
    expect(readDom(container)).toEqual({
      selectValue: '+33',
      inputValue: '0612345678',
    });

    rerender(
      <PhoneInput label="Phone" value="+44 7700900123" onChange={onChange} />,
    );
    expect(readDom(container)).toEqual({
      selectValue: '+44',
      inputValue: '7700900123',
    });

    // Verify with a single diffFrames over the two captured DOM
    // states + a third rerender. This is the explicit oracle-diff
    // assertion the §3 row L6 oracle expects.
    rerender(<PhoneInput label="Phone" value="" onChange={onChange} />);
    const finalDom = readDom(container);

    const oracle = [
      { selectValue: '+33', inputValue: '0612345678' },
      { selectValue: '+44', inputValue: '7700900123' },
      { selectValue: '+33', inputValue: '' },
    ];
    const actual = [
      { selectValue: '+33', inputValue: '0612345678' },
      { selectValue: '+44', inputValue: '7700900123' },
      finalDom,
    ];
    const diff = diffFrames(actual, oracle, 'L6 rerender re-derives');
    expect(diff.ok, diff.message).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    unmount();
  });

  it('country select change with non-empty number: onChange emits formatFullNumber(newCode, number)', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <PhoneInput label="Phone" value="+33 612345678" onChange={onChange} />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '+44' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('+44 612345678');
    unmount();
  });
});

// --- tests: WRAPPED in stateful parent (round-trip) -------------------------

describe('L6: PhoneInput — Gate 2 oracle-diff (controlled parent harness)', () => {
  it('user types "06" with +33 selected: leading-0 strip, parent shows "6"', () => {
    const changes = { last: null as string | null };
    const { container, unmount } = render(
      <ControlledHarness initial="+33 " changes={changes} />,
    );

    // Frame 0 — mount.
    const frame0: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '06' } });
    });
    const frame1: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const oracle: DomFrame[] = [
      { selectValue: '+33', inputValue: '', lastOnChange: null },
      // +33 strip: onChange fires with '+33 6'; parent re-renders;
      // input now shows '6'.
      { selectValue: '+33', inputValue: '6', lastOnChange: '+33 6' },
    ];

    const diff = diffFrames([frame0, frame1], oracle, 'L6 type 06 with +33');
    expect(diff.ok, diff.message).toBe(true);
    unmount();
  });

  it('user types "06" with +44 selected: NO leading-0 strip, parent shows "06"', () => {
    const changes = { last: null as string | null };
    const { container, unmount } = render(
      <ControlledHarness initial="+44 " changes={changes} />,
    );

    const frame0: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '06' } });
    });
    const frame1: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const oracle: DomFrame[] = [
      { selectValue: '+44', inputValue: '', lastOnChange: null },
      // No strip for non-FR: onChange fires '+44 06'; parent shows '06'.
      { selectValue: '+44', inputValue: '06', lastOnChange: '+44 06' },
    ];

    const diff = diffFrames([frame0, frame1], oracle, 'L6 type 06 with +44');
    expect(diff.ok, diff.message).toBe(true);
    unmount();
  });

  it('country change while non-empty number: onChange reformats, parent shows same digits under new code', () => {
    const changes = { last: null as string | null };
    const { container, unmount } = render(
      <ControlledHarness initial="+33 612345678" changes={changes} />,
    );

    const frame0: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const select = container.querySelector('select') as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: '+1' } });
    });
    const frame1: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const oracle: DomFrame[] = [
      { selectValue: '+33', inputValue: '612345678', lastOnChange: null },
      { selectValue: '+1', inputValue: '612345678', lastOnChange: '+1 612345678' },
    ];

    const diff = diffFrames([frame0, frame1], oracle, 'L6 country change');
    expect(diff.ok, diff.message).toBe(true);
    unmount();
  });

  it('clearing the input: formatFullNumber on empty digits returns "", parent goes to ""', () => {
    const changes = { last: null as string | null };
    const { container, unmount } = render(
      <ControlledHarness initial="+33 6" changes={changes} />,
    );

    const frame0: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '' } });
    });
    const frame1: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    const oracle: DomFrame[] = [
      { selectValue: '+33', inputValue: '6', lastOnChange: null },
      // Clear: cleaned='' → formatFullNumber returns '' (no code prefix).
      // Parent re-renders with value=''; parsePhone('') yields +33 + ''.
      { selectValue: '+33', inputValue: '', lastOnChange: '' },
    ];

    const diff = diffFrames([frame0, frame1], oracle, 'L6 clear input');
    expect(diff.ok, diff.message).toBe(true);
    unmount();
  });

  it('formatFullNumber strips non-digit chars from user input', () => {
    const changes = { last: null as string | null };
    const { container, unmount } = render(
      <ControlledHarness initial="+33 " changes={changes} />,
    );

    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    act(() => {
      // User pastes "6abc12" — formatFullNumber strips non-digits.
      // With +33, leading-0 strip is a no-op here ('6abc12' doesn't
      // start with '0').
      fireEvent.change(input, { target: { value: '6abc12' } });
    });
    const frame: DomFrame = {
      ...readDom(container),
      lastOnChange: changes.last,
    };

    // Expected: cleaned digits = '612', onChange('+33 612'), parent
    // re-renders, input shows '612'.
    expect(frame).toEqual({
      selectValue: '+33',
      inputValue: '612',
      lastOnChange: '+33 612',
    });
    unmount();
  });
});
