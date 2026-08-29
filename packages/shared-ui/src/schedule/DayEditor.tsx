import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Select } from '../components/index.js';
import { createEmptySlots, setSlotRange, slotIndexToTime, timeToSlotIndex } from '@ejm/shared-core';
import type { DayOfWeek } from '@ejm/shared-core';
import {
  rangeTagSelection,
  toggleSelection,
  type LocationTagLabels,
} from './locationTags.js';
import { RangeTagChips } from './locationTagChips.js';

/**
 * Optional per-range location tags (study issue #166). When absent the editor
 * renders and behaves exactly as before — sync-sit passes nothing here. All
 * labels come from the caller so this shared component needs no app-specific
 * i18n keys. Keys of `initial` are slot indices as strings ("0".."95").
 */
export interface DayEditorLocationTags extends LocationTagLabels {
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
      // Picking a chip on a mixed range unifies it to just that chip.
      const next = toggleSelection(rangeTagSelection(prev, idxs), value);
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
    <Dialog open={open} onClose={onClose} ariaLabel={t('schedule.setAvailability', { day: dayLabels[day] })}>
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
        <div className={`focus-ring-inset mb-4 space-y-2 overflow-y-auto ${locationTags ? 'max-h-60' : 'max-h-40'}`}>
          {locationTags?.helpText && (
            <p className="text-xs text-gray-500">{locationTags.helpText}</p>
          )}
          {ranges.map((r, i) => {
            const idxs = locationTags ? rangeSlotIndices(r.start, r.end) : [];
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
                  <RangeTagChips
                    labels={locationTags}
                    selection={rangeTagSelection(locMap, idxs)}
                    onToggle={(value) => toggleRangeTag(idxs, value)}
                    onReset={() => resetRangeTags(idxs)}
                  />
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
