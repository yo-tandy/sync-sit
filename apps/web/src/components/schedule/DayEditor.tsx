import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Button, Select } from '@/components/ui';
import { createEmptySlots, setSlotRange, slotIndexToTime, timeToSlotIndex } from '@ejm/shared';
import type { DayOfWeek } from '@ejm/shared';

interface DayEditorProps {
  day: DayOfWeek;
  slots: boolean[];
  open: boolean;
  onClose: () => void;
  onSave: (day: DayOfWeek, slots: boolean[]) => void;
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

export function DayEditor({ day, slots: initialSlots, open, onClose, onSave }: DayEditorProps) {
  const { t } = useTranslation();
  const dayLabels: Record<DayOfWeek, string> = useMemo(() => ({
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  }), [t]);
  const TIME_OPTIONS = useMemo(() => generateTimeOptions(t('schedule.followingDay')), [t]);
  const [localSlots, setLocalSlots] = useState<boolean[]>(initialSlots);
  const [newStart, setNewStart] = useState('18:00');
  const [newEnd, setNewEnd] = useState('00:00');

  // Sync when props change (different day selected)
  useEffect(() => {
    setLocalSlots(initialSlots);
  }, [initialSlots]);

  const ranges = useMemo(() => slotsToRanges(localSlots), [localSlots]);

  const handleAddRange = () => {
    if (newStart === newEnd) return;
    setLocalSlots(addWrappingRange(localSlots, newStart, newEnd, true));
  };

  const handleRemoveRange = (range: TimeRange) => {
    setLocalSlots(removeWrappingRange(localSlots, range.start, range.end));
  };

  const handleClearAll = () => setLocalSlots(createEmptySlots());

  const handleTypicalEvening = () => {
    const s = [...localSlots];
    // 18:00 (slot 72) to 00:00 (slot 0 next day = slot 96 end)
    for (let i = 72; i < 96; i++) s[i] = true;
    setLocalSlots(s);
  };

  const handleSave = () => {
    onSave(day, localSlots);
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
        <div className="mb-4 max-h-40 space-y-2 overflow-y-auto">
          {ranges.map((r, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span className="text-sm font-medium">
                {r.start} – {r.end}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveRange(r)}
                className="text-sm text-red-600 hover:text-red-700"
              >
                {t('common.remove')}
              </button>
            </div>
          ))}
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
