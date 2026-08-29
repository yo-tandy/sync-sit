/**
 * Labels + pure selection helpers behind the shared per-range location tag
 * chip row (study issue #166) — used by BOTH
 * schedule editing surfaces (DayEditor's range list and WeeklyTimeline's
 * RangeEditDialog) so the chip semantics cannot drift: same defaults chip,
 * same offered-values filtering, same mixed third state, same not-offered
 * flagging. All labels come from the caller; sync-sit passes nothing and
 * renders neither surface's tag UI.
 *
 * Component-free by design: `locationTagChips.tsx` may export only the chip
 * row itself, or React Fast Refresh stops working for it
 * (react-refresh/only-export-components).
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
