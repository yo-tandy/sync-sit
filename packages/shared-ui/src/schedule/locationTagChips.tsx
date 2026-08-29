/**
 * Shared per-range location tag chip row (study issue #166) — the rendering
 * half; its labels type and pure selection helpers live in `locationTags.ts`.
 */

import type { LocationTagLabels } from './locationTags.js';

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
