/**
 * Shared per-range location tag chip row (study issue #166) — used by BOTH
 * schedule editing surfaces (DayEditor's range list and WeeklyTimeline's
 * RangeEditDialog) so the chip semantics cannot drift: same defaults chip,
 * same offered-values filtering, same mixed third state, same not-offered
 * flagging. All labels come from the caller; sync-sit passes nothing and
 * renders neither surface's tag UI.
 */

/** Label/config subset shared by every tag-capable schedule surface. */
export interface LocationTagLabels {
  /** Chip options for the location categories, labeled by the caller. */
  options: { value: string; label: string }[];
  /**
   * The values the tutor currently OFFERS (their SAVED profile locationPrefs).
   * When set, unselected chips outside this list are hidden — tags can only
   * narrow within what is offered — while a STORED tag outside it stays
   * visible as a checked-but-flagged chip. Absent = all options offered.
   */
  offeredValues?: string[];
  /** Label for the "profile defaults" (no override) chip. */
  defaultsLabel: string;
  /** Separator word rendered between the defaults chip and the options
   * ("or" / "ou") — the chips are alternatives, not a multi-select row
   * (owner request, PR #185). */
  orLabel?: string;
  /** Hint shown when the covered cells carry DIFFERENT tag sets. */
  mixedLabel?: string;
  /** Hint shown when the selection carries a value outside offeredValues. */
  notOfferedLabel?: string;
}

/**
 * A cell range's current tag selection: the set shared by ALL covered cells,
 * or 'mixed' when cells disagree (ranges merged after separate tagging). A
 * mixed range renders as a distinct third state — NO chip pressed, so
 * "Profile defaults" only ever means what it says — and its cells are left
 * exactly as stored until the tutor actively picks a state.
 */
export function rangeTagSelection(
  locMap: Record<string, string[]>,
  idxs: number[],
): string[] | 'mixed' {
  const first = locMap[String(idxs[0])] ?? [];
  const key = [...first].sort().join(',');
  for (const i of idxs) {
    const v = locMap[String(i)] ?? [];
    if ([...v].sort().join(',') !== key) return 'mixed';
  }
  return first;
}

/** Apply one chip toggle to a selection (mixed unifies to just that chip). */
export function toggleSelection(
  selection: string[] | 'mixed',
  value: string,
): string[] {
  const current = selection === 'mixed' ? [] : selection;
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

interface RangeTagChipsProps {
  labels: LocationTagLabels;
  selection: string[] | 'mixed';
  onToggle: (value: string) => void;
  onReset: () => void;
}

export function RangeTagChips({ labels, selection, onToggle, onReset }: RangeTagChipsProps) {
  const mixed = selection === 'mixed';
  const selected = mixed ? [] : selection;
  const offered = labels.offeredValues;
  // Chips shown: offered values, plus any SELECTED value outside them (a
  // stored tag whose location is no longer offered) — flagged, never dropped.
  const visibleOptions = labels.options.filter(
    (opt) => !offered || offered.includes(opt.value) || selected.includes(opt.value),
  );
  const hasNotOffered = !!offered && selected.some((v) => !offered.includes(v));

  // A tutor offering a single location has no real choice: "defaults" and the
  // one chip mean the same thing, so an untouched range hides the whole row
  // (owner request, PR #185). Any STORED state (a tag, a mixed range, an
  // out-of-prefs leftover) keeps the row visible so it can be seen and fixed.
  if (
    !!offered &&
    offered.length <= 1 &&
    !mixed &&
    selected.length === 0
  ) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <button
        type="button"
        aria-pressed={!mixed && selected.length === 0}
        onClick={onReset}
        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
          !mixed && selected.length === 0
            ? 'border-brand-600 bg-brand-50 text-brand-600'
            : 'border-gray-300 text-gray-600 hover:border-gray-400'
        }`}
      >
        {labels.defaultsLabel}
      </button>
      {labels.orLabel && visibleOptions.length > 0 && (
        <span className="self-center text-xs font-medium text-gray-900">{labels.orLabel}</span>
      )}
      {visibleOptions.map((opt) => {
        const pressed = selected.includes(opt.value);
        const flagged = pressed && !!offered && !offered.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(opt.value)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              flagged
                ? 'border-amber-500 bg-amber-50 text-amber-700'
                : pressed
                  ? 'border-brand-600 bg-brand-50 text-brand-600'
                  : 'border-gray-300 text-gray-600 hover:border-gray-400'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      {mixed && labels.mixedLabel && (
        <span className="basis-full text-xs text-gray-500">{labels.mixedLabel}</span>
      )}
      {hasNotOffered && labels.notOfferedLabel && (
        <span className="basis-full text-xs text-amber-700">{labels.notOfferedLabel}</span>
      )}
    </div>
  );
}
