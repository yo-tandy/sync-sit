import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Select } from '../components/index.js';
import { createEmptySlots, setSlotRange, slotIndexToTime, timeToSlotIndex } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';

/**
 * Optional per-range location tags (study issue #166). When absent the editor
 * renders and behaves exactly as before — sync-sit passes nothing here. All
 * labels come from the caller so this shared component needs no app-specific
 * i18n keys. Keys of `initial` are slot indices as strings ("0".."95").
 */
export interface DayEditorLocationTags {
  /** Chip options for the location categories, labeled by the caller. */
  options: { value: string; label: string }[];
  /**
   * The values the tutor currently OFFERS (their profile locationPrefs). When
   * set, unselected chips outside this list are hidden — tags can only narrow
   * within what is offered — while a STORED tag outside it (prefs narrowed
   * after tagging) stays visible as a checked-but-flagged chip so the dead
   * state is seen rather than silently dropped. Absent = all options offered.
   */
  offeredValues?: string[];
  /** Label for the "profile defaults" (no override) chip. */
  defaultsLabel: string;
  /**
   * Hint shown when a range's covered cells carry DIFFERENT tag sets (ranges
   * merged after separate tagging): no chip renders pressed and the stored
   * cells stay untouched until the tutor actively picks a state.
   */
  mixedLabel?: string;
  /**
   * Hint shown when a range's selection carries a value outside
   * `offeredValues` — the tag is kept (never silently dropped) but the range
   * is not bookable for that location until it is unchecked or offered again.
   */
  notOfferedLabel?: string;
  /** Short helper line above the ranges list. */
  helpText?: string;
  /** Sparse initial per-cell tags for this day: slot index -> values. */
  initial?: Record<string, string[]>;
}

// Stable empty fallback: a fresh `?? {}` at the call site would change
// identity on every parent render and reset in-progress edits via the sync
// effect below.
const EMPTY_LOCATIONS: Record<string, string[]> = {};

interface DayEditorProps {
  day: DayOfWeek;
  slots: boolean[];
  open: boolean;
  onClose: () => void;
  /** `locations` is passed only when `locationTags` is configured. */
  onSave: (day: DayOfWeek, slots: boolean[], locations?: Record<string, string[]>) => void;
  locationTags?: DayEditorLocationTags;
}

// DAY_LABELS moved inside component to use t()

// Time options from 06:00 → 02:00 (wrapping past midnight)
function generateTimeOptions(followingDayLabel: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let slot = 24; slot < 96; slot++) {
    const time = slotIndexToTime(slot);
    options.push({ value: time, label: time });
  }
  for (let slot = 0; slot <= 8; slot++) {
    const time = slotIndexToTime(slot);
    options.push({ value: time, label: `${time} ${followingDayLabel}` });
  }
  return options;
}

interface TimeRange {
  start: string;
  end: string;
}

// Convert the 96-slot array into human-readable ranges
// Display order: slots 24..95 first, then 0..7
function slotsToRanges(slots: boolean[]): TimeRange[] {
  const ranges: TimeRange[] = [];
  const displayOrder = [
    ...Array.from({ length: 72 }, (_, i) => i + 24), // 24..95
    ...Array.from({ length: 8 }, (_, i) => i),        // 0..7
  ];

  let rangeStart: number | null = null;

  for (let di = 0; di < displayOrder.length; di++) {
    const slot = displayOrder[di];
    if (slots[slot] && rangeStart === null) {
      rangeStart = slot;
    } else if (!slots[slot] && rangeStart !== null) {
      ranges.push({
        start: slotIndexToTime(rangeStart),
        end: slotIndexToTime(slot),
      });
      rangeStart = null;
    }
  }
  if (rangeStart !== null) {
    ranges.push({
      start: slotIndexToTime(rangeStart),
      end: '02:00',
    });
  }

  return ranges;
}

// Handle wrapping: if start >= end (e.g. 18:00 → 00:00), we need to handle
// the slot range that wraps past midnight
function addWrappingRange(slots: boolean[], start: string, end: string, value: boolean): boolean[] {
  let result = [...slots];
  const startIdx = timeToSlotIndex(start);
  const endIdx = timeToSlotIndex(end);

  if (startIdx < endIdx) {
    // Normal range (e.g. 08:00 – 12:00)
    result = setSlotRange(result, start, end, value);
  } else {
    // Wrapping range (e.g. 22:00 – 02:00)
    // First part: start → midnight (slot 96 = end of day)
    for (let i = startIdx; i < 96; i++) result[i] = value;
    // Second part: midnight → end
    for (let i = 0; i < endIdx; i++) result[i] = value;
  }
  return result;
}

function removeWrappingRange(slots: boolean[], start: string, end: string): boolean[] {
  return addWrappingRange(slots, start, end, false);
}

// The slot indices a display range covers, handling the past-midnight wrap
// (e.g. 22:00 - 02:00 covers 88..95 then 0..7).
function rangeSlotIndices(start: string, end: string): number[] {
  const startIdx = timeToSlotIndex(start);
  const endIdx = timeToSlotIndex(end);
  const idxs: number[] = [];
  if (startIdx < endIdx) {
    for (let i = startIdx; i < endIdx; i++) idxs.push(i);
  } else {
    for (let i = startIdx; i < 96; i++) idxs.push(i);
    for (let i = 0; i < endIdx; i++) idxs.push(i);
  }
  return idxs;
}

// A range's current tag selection: the set shared by ALL covered cells, or
// 'mixed' when cells disagree (ranges merged after separate tagging). A mixed
// range renders as a distinct third state — NO chip pressed, so "Profile
// defaults" only ever means what it says — and its cells are left exactly as
// stored until the tutor actively picks a chip (which re-tags the whole range
// uniformly) or resets to defaults.
function rangeTagSelection(
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

export function DayEditor({ day, slots: initialSlots, open, onClose, onSave, locationTags }: DayEditorProps) {
  const { t } = useTranslation();
  const dayLabels: Record<DayOfWeek, string> = useMemo(() => ({
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  }), [t]);
  const TIME_OPTIONS = useMemo(() => generateTimeOptions(t('schedule.followingDay')), [t]);
  const initialLocations = locationTags?.initial ?? EMPTY_LOCATIONS;
  const [localSlots, setLocalSlots] = useState<boolean[]>(initialSlots);
  const [locMap, setLocMap] = useState<Record<string, string[]>>(initialLocations);
  const [newStart, setNewStart] = useState('18:00');
  const [newEnd, setNewEnd] = useState('00:00');

  // Sync when props change (different day selected)
  useEffect(() => {
    setLocalSlots(initialSlots);
  }, [initialSlots]);
  useEffect(() => {
    setLocMap(initialLocations);
  }, [initialLocations]);

  const ranges = useMemo(() => slotsToRanges(localSlots), [localSlots]);

  const handleAddRange = () => {
    if (newStart === newEnd) return;
    setLocalSlots(addWrappingRange(localSlots, newStart, newEnd, true));
  };

  const handleRemoveRange = (range: TimeRange) => {
    setLocalSlots(removeWrappingRange(localSlots, range.start, range.end));
    // Tags on the removed cells go with them.
    setLocMap((prev) => {
      const copy = { ...prev };
      for (const i of rangeSlotIndices(range.start, range.end)) delete copy[String(i)];
      return copy;
    });
  };

  const handleClearAll = () => {
    setLocalSlots(createEmptySlots());
    setLocMap({});
  };

  // Toggle one location chip for a whole range: every covered cell gets the
  // range's new uniform set; an empty set means "profile defaults" (entries
  // removed — an empty-array override is never stored).
  const toggleRangeTag = (idxs: number[], value: string) => {
    setLocMap((prev) => {
      const selection = rangeTagSelection(prev, idxs);
      // Picking a chip on a mixed range unifies it to just that chip.
      const current = selection === 'mixed' ? [] : selection;
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const copy = { ...prev };
      for (const i of idxs) {
        if (next.length > 0) copy[String(i)] = next;
        else delete copy[String(i)];
      }
      return copy;
    });
  };

  const resetRangeTags = (idxs: number[]) => {
    setLocMap((prev) => {
      const copy = { ...prev };
      for (const i of idxs) delete copy[String(i)];
      return copy;
    });
  };

  const handleTypicalEvening = () => {
    const s = [...localSlots];
    // 18:00 (slot 72) to 00:00 (slot 0 next day = slot 96 end)
    for (let i = 72; i < 96; i++) s[i] = true;
    setLocalSlots(s);
  };

  const handleSave = () => {
    if (locationTags) {
      // Normalize: keep only non-empty tag sets on ACTIVE cells, so stale tags
      // on cells toggled off elsewhere never persist.
      const normalized: Record<string, string[]> = {};
      for (const [key, values] of Object.entries(locMap)) {
        const idx = Number(key);
        if (localSlots[idx] && values.length > 0) normalized[key] = values;
      }
      onSave(day, localSlots, normalized);
    } else {
      onSave(day, localSlots);
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <h3 className="mb-4 text-lg font-bold">{t('schedule.setAvailability', { day: dayLabels[day] })}</h3>

      {/* 1. Add time range inputs */}
      <div className="mb-4">
        <p className="mb-2 text-xs font-medium text-gray-500">{t('schedule.addTimeRange')}</p>
        <div className="flex gap-3">
          <div className="flex-1">
            <Select
              label={t('schedule.from')}
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
              options={TIME_OPTIONS}
            />
          </div>
          <div className="flex-1">
            <Select
              label={t('schedule.to')}
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              options={TIME_OPTIONS}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleAddRange}
          disabled={newStart === newEnd}
        >
          {t('common.add')}
        </Button>
      </div>

      {/* 2. Quick actions */}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={handleTypicalEvening}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {t('schedule.available18h')}
        </button>
        <button
          type="button"
          onClick={handleClearAll}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {t('schedule.clearAll')}
        </button>
      </div>

      {/* 3. Current ranges list */}
      {ranges.length === 0 ? (
        <p className="mb-4 text-sm text-gray-500">{t('schedule.noAvailabilitySet')}</p>
      ) : (
        <div className={`mb-4 space-y-2 overflow-y-auto ${locationTags ? 'max-h-60' : 'max-h-40'}`}>
          {locationTags?.helpText && (
            <p className="text-xs text-gray-500">{locationTags.helpText}</p>
          )}
          {ranges.map((r, i) => {
            const idxs = locationTags ? rangeSlotIndices(r.start, r.end) : [];
            const rawSelection = locationTags ? rangeTagSelection(locMap, idxs) : [];
            const mixed = rawSelection === 'mixed';
            const selection = mixed ? [] : rawSelection;
            const offered = locationTags?.offeredValues;
            // Chips shown: offered values, plus any SELECTED value outside
            // them (a stored tag whose location is no longer offered) —
            // rendered flagged, never silently dropped.
            const visibleOptions = locationTags
              ? locationTags.options.filter(
                  (opt) =>
                    !offered || offered.includes(opt.value) || selection.includes(opt.value),
                )
              : [];
            const hasNotOffered =
              !!offered && selection.some((v) => !offered.includes(v));
            return (
              <div key={i} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {r.start} – {r.end}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRange(r)}
                    className="text-sm text-brand-600 hover:text-brand-700"
                  >
                    {t('common.remove')}
                  </button>
                </div>
                {locationTags && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      aria-pressed={!mixed && selection.length === 0}
                      onClick={() => resetRangeTags(idxs)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        !mixed && selection.length === 0
                          ? 'border-brand-600 bg-brand-50 text-brand-600'
                          : 'border-gray-300 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {locationTags.defaultsLabel}
                    </button>
                    {visibleOptions.map((opt) => {
                      const pressed = selection.includes(opt.value);
                      const flagged =
                        pressed && !!offered && !offered.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={pressed}
                          onClick={() => toggleRangeTag(idxs, opt.value)}
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
                    {mixed && locationTags.mixedLabel && (
                      <span className="basis-full text-xs text-gray-500">
                        {locationTags.mixedLabel}
                      </span>
                    )}
                    {hasNotOffered && locationTags.notOfferedLabel && (
                      <span className="basis-full text-xs text-amber-700">
                        {locationTags.notOfferedLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Done / Cancel */}
      <div className="flex gap-2">
        <Button type="button" onClick={handleSave} className="flex-1">
          {t('common.done')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
