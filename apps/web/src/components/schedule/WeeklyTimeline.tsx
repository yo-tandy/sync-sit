import { useRef, useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DAYS_OF_WEEK, slotIndexToTime } from '@ejm/shared';
import type { DayOfWeek } from '@ejm/shared';
import { Dialog, Button, Select } from '@/components/ui';

interface WeeklyTimelineProps {
  weekly: Record<DayOfWeek, boolean[]>;
  onChange: (weekly: Record<DayOfWeek, boolean[]>) => void;
  onDayHeaderClick: (day: DayOfWeek) => void;
}

// DAY_LABELS moved inside component to use t()

// Display order: slots 24..95 (06:00–23:45), then 0..7 (00:00–01:45) = 80 slots
const DISPLAY_SLOTS = (() => {
  const s: number[] = [];
  for (let i = 24; i < 96; i++) s.push(i);
  for (let i = 0; i < 8; i++) s.push(i);
  return s;
})();

const SLOT_HEIGHT = 3; // px per slot

// Hour labels every 2 hours
const HOUR_LABELS = (() => {
  const m = new Map<number, string>();
  for (let di = 0; di < DISPLAY_SLOTS.length; di++) {
    const slot = DISPLAY_SLOTS[di];
    if (slot % 8 === 0) {
      m.set(di, `${Math.floor((slot * 15) / 60)}h`);
    }
  }
  return m;
})();

function displayIdxToTime(di: number): string {
  return slotIndexToTime(DISPLAY_SLOTS[Math.min(di, DISPLAY_SLOTS.length - 1)]);
}

function displayIdxToEndTime(di: number): string {
  // End time = start of the next slot
  const nextDi = di + 1;
  if (nextDi >= DISPLAY_SLOTS.length) return '02:00';
  return slotIndexToTime(DISPLAY_SLOTS[nextDi]);
}

interface AvailRange {
  startDi: number; // display index of first available slot
  endDi: number;   // display index of last available slot (inclusive)
  startTime: string;
  endTime: string;
}

function computeRanges(slots: boolean[]): AvailRange[] {
  const ranges: AvailRange[] = [];
  let rangeStart: number | null = null;

  for (let di = 0; di < DISPLAY_SLOTS.length; di++) {
    const slotIdx = DISPLAY_SLOTS[di];
    if (slots[slotIdx]) {
      if (rangeStart === null) rangeStart = di;
    } else {
      if (rangeStart !== null) {
        ranges.push({
          startDi: rangeStart,
          endDi: di - 1,
          startTime: displayIdxToTime(rangeStart),
          endTime: displayIdxToTime(di), // start of first unavailable = end time
        });
        rangeStart = null;
      }
    }
  }
  if (rangeStart !== null) {
    ranges.push({
      startDi: rangeStart,
      endDi: DISPLAY_SLOTS.length - 1,
      startTime: displayIdxToTime(rangeStart),
      endTime: '02:00',
    });
  }
  return ranges;
}

// Time options 06:00 → 02:00
function generateTimeOptions(followingDayLabel: string): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  for (let s = 24; s < 96; s++) {
    const tm = slotIndexToTime(s);
    opts.push({ value: tm, label: tm });
  }
  for (let s = 0; s <= 8; s++) {
    const tm = slotIndexToTime(s);
    opts.push({ value: tm, label: `${tm} ${followingDayLabel}` });
  }
  return opts;
}

// ── Range Edit Dialog ──
function RangeEditDialog({
  range,
  day,
  open,
  onClose,
  onSave,
  onRemove,
}: {
  range: AvailRange;
  day: DayOfWeek;
  open: boolean;
  onClose: () => void;
  onSave: (oldRange: AvailRange, newStart: string, newEnd: string) => void;
  onRemove: (range: AvailRange) => void;
}) {
  const { t } = useTranslation();
  const timeOptions = useMemo(() => generateTimeOptions(t('schedule.followingDay')), [t]);
  const fullDayLabels: Record<DayOfWeek, string> = useMemo(() => ({
    mon: t('days.monday'), tue: t('days.tuesday'), wed: t('days.wednesday'), thu: t('days.thursday'),
    fri: t('days.friday'), sat: t('days.saturday'), sun: t('days.sunday'),
  }), [t]);
  const [start, setStart] = useState(range.startTime);
  const [end, setEnd] = useState(range.endTime);

  return (
    <Dialog open={open} onClose={onClose}>
      <h3 className="mb-4 text-lg font-bold">
        {t('schedule.editAvailability')} — {fullDayLabels[day]}
      </h3>
      <div className="flex gap-3">
        <div className="flex-1">
          <Select label={t('schedule.from')} value={start} onChange={(e) => setStart(e.target.value)} options={timeOptions} />
        </div>
        <div className="flex-1">
          <Select label={t('schedule.to')} value={end} onChange={(e) => setEnd(e.target.value)} options={timeOptions} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => { onSave(range, start, end); onClose(); }} disabled={start === end} className="flex-1">
          {t('common.save')}
        </Button>
        <Button type="button" variant="outline" onClick={() => { onRemove(range); onClose(); }} className="flex-1 !text-red-600 !border-red-200">
          {t('common.remove')}
        </Button>
      </div>
      <Button type="button" variant="ghost" onClick={onClose} className="mt-2">
        {t('common.cancel')}
      </Button>
    </Dialog>
  );
}

// ── Main Component ──
export function WeeklyTimeline({ weekly, onChange, onDayHeaderClick }: WeeklyTimelineProps) {
  const { t } = useTranslation();
  const dayLabels: Record<DayOfWeek, string> = useMemo(() => ({
    mon: t('days.mon'), tue: t('days.tue'), wed: t('days.wed'), thu: t('days.thu'),
    fri: t('days.fri'), sat: t('days.sat'), sun: t('days.sun'),
  }), [t]);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    day: DayOfWeek;
    startDisplayIdx: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    day: DayOfWeek;
    fromIdx: number;
    toIdx: number;
  } | null>(null);
  const [editingRange, setEditingRange] = useState<{ day: DayOfWeek; range: AvailRange } | null>(null);

  // Compute availability ranges per day
  const rangesByDay = useMemo(() => {
    const result = {} as Record<DayOfWeek, AvailRange[]>;
    for (const day of DAYS_OF_WEEK) {
      result[day] = computeRanges(weekly[day]);
    }
    return result;
  }, [weekly]);

  // Find which range a display index falls in
  const findRange = useCallback((day: DayOfWeek, displayIdx: number): AvailRange | null => {
    for (const r of rangesByDay[day]) {
      if (displayIdx >= r.startDi && displayIdx <= r.endDi) return r;
    }
    return null;
  }, [rangesByDay]);

  const getCellFromPoint = useCallback((clientX: number, clientY: number): { day: DayOfWeek; displayIdx: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const labelWidth = 32;
    const gap = 2;
    const dayAreaWidth = rect.width - labelWidth;
    const colWidth = (dayAreaWidth - gap * 6) / 7;
    const relX = x - labelWidth;
    if (relX < 0) return null;
    const dayIdx = Math.floor(relX / (colWidth + gap));
    if (dayIdx < 0 || dayIdx >= 7) return null;
    const displayIdx = Math.max(0, Math.min(Math.floor(y / SLOT_HEIGHT), DISPLAY_SLOTS.length - 1));
    return { day: DAYS_OF_WEEK[dayIdx], displayIdx };
  }, []);

  const handlePointerDown = useCallback(
    (day: DayOfWeek, displayIdx: number, e: React.PointerEvent) => {
      e.preventDefault();
      const slotIdx = DISPLAY_SLOTS[displayIdx];
      const isAvailable = weekly[day][slotIdx];

      if (isAvailable) {
        // Clicking on an available slot — will open edit dialog on pointerUp if no drag
        dragging.current = { day, startDisplayIdx: displayIdx };
        // Don't set dragPreview yet — wait for movement
        return;
      }

      // Clicking on empty slot — start drag to add availability
      dragging.current = { day, startDisplayIdx: displayIdx };
      setDragPreview({ day, fromIdx: displayIdx, toIdx: displayIdx });
    },
    [weekly]
  );

  const handlePointerMoveOnGrid = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const cell = getCellFromPoint(e.clientX, e.clientY);
      if (!cell || cell.day !== dragging.current.day) return;

      // If we moved away from start, we're dragging
      if (cell.displayIdx !== dragging.current.startDisplayIdx || dragPreview) {
        setDragPreview({
          day: dragging.current.day,
          fromIdx: dragging.current.startDisplayIdx,
          toIdx: cell.displayIdx,
        });
      }
    },
    [getCellFromPoint, dragPreview]
  );

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return;
    const { day, startDisplayIdx } = dragging.current;

    if (!dragPreview) {
      // No drag happened — this was a click
      const slotIdx = DISPLAY_SLOTS[startDisplayIdx];
      if (weekly[day][slotIdx]) {
        // Clicked on available slot — open edit dialog for that range
        const range = findRange(day, startDisplayIdx);
        if (range) {
          setEditingRange({ day, range });
        }
      }
      // Clicked on empty slot without dragging — do nothing
      dragging.current = null;
      return;
    }

    // Drag completed — add availability for the range
    const minIdx = Math.min(dragPreview.fromIdx, dragPreview.toIdx);
    const maxIdx = Math.max(dragPreview.fromIdx, dragPreview.toIdx);

    const newSlots = [...weekly[day]];
    for (let i = minIdx; i <= maxIdx; i++) {
      newSlots[DISPLAY_SLOTS[i]] = true; // Always add availability on drag
    }

    onChange({ ...weekly, [day]: newSlots });
    dragging.current = null;
    setDragPreview(null);
  }, [weekly, onChange, dragPreview, findRange]);

  // Handle range edit save
  const handleRangeSave = useCallback(
    (oldRange: AvailRange, newStart: string, newEnd: string) => {
      if (!editingRange) return;
      const { day } = editingRange;
      const newSlots = [...weekly[day]];

      // Remove old range
      for (let di = oldRange.startDi; di <= oldRange.endDi; di++) {
        newSlots[DISPLAY_SLOTS[di]] = false;
      }

      // Add new range using actual slot indices (handles wrapping past midnight)
      const sSlot = Math.floor((parseInt(newStart.split(':')[0]) * 60 + parseInt(newStart.split(':')[1])) / 15);
      const eSlot = Math.floor((parseInt(newEnd.split(':')[0]) * 60 + parseInt(newEnd.split(':')[1])) / 15);

      if (sSlot < eSlot) {
        // Normal range (e.g. 08:00–12:00)
        for (let i = sSlot; i < eSlot && i < 96; i++) newSlots[i] = true;
      } else if (sSlot > eSlot) {
        // Wrapping range (e.g. 22:00–02:00)
        for (let i = sSlot; i < 96; i++) newSlots[i] = true;
        for (let i = 0; i < eSlot; i++) newSlots[i] = true;
      }

      onChange({ ...weekly, [day]: newSlots });
      setEditingRange(null);
    },
    [weekly, onChange, editingRange]
  );

  // Handle range remove
  const handleRangeRemove = useCallback(
    (range: AvailRange) => {
      if (!editingRange) return;
      const { day } = editingRange;
      const newSlots = [...weekly[day]];
      for (let di = range.startDi; di <= range.endDi; di++) {
        newSlots[DISPLAY_SLOTS[di]] = false;
      }
      onChange({ ...weekly, [day]: newSlots });
      setEditingRange(null);
    },
    [weekly, onChange, editingRange]
  );

  // Drag preview helpers
  const dragMinIdx = dragPreview ? Math.min(dragPreview.fromIdx, dragPreview.toIdx) : -1;
  const dragMaxIdx = dragPreview ? Math.max(dragPreview.fromIdx, dragPreview.toIdx) : -1;
  const dragDay = dragPreview?.day;
  const dragStartTime = dragPreview ? displayIdxToTime(dragMinIdx) : '';
  const dragEndTime = dragPreview ? displayIdxToEndTime(dragMaxIdx) : '';

  return (
    <div className="overflow-x-auto select-none touch-none">
      <div className="min-w-[360px]">
        {/* Header row */}
        <div className="mb-1 grid grid-cols-[32px_repeat(7,1fr)] gap-x-[2px]">
          <div />
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => onDayHeaderClick(day)}
              className="rounded-md py-1 text-center text-xs font-semibold text-gray-700 hover:bg-gray-100"
            >
              {dayLabels[day]}
            </button>
          ))}
        </div>

        {/* Slot grid */}
        <div
          ref={gridRef}
          className="relative grid grid-cols-[32px_repeat(7,1fr)] gap-x-[2px]"
          onPointerMove={handlePointerMoveOnGrid}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {DISPLAY_SLOTS.map((slotIdx, displayIdx) => {
            const hourLabel = HOUR_LABELS.get(displayIdx);
            return (
              <div key={displayIdx} className="contents">
                <div className="flex h-[3px] items-center justify-end pr-1">
                  {hourLabel && (
                    <span className="relative -top-[1px] text-[9px] leading-none text-gray-400">
                      {hourLabel}
                    </span>
                  )}
                </div>
                {DAYS_OF_WEEK.map((day) => {
                  const baseAvailable = weekly[day][slotIdx];
                  const inDrag = dragDay === day && displayIdx >= dragMinIdx && displayIdx <= dragMaxIdx;
                  const showAvailable = inDrag ? true : baseAvailable;

                  // Determine if this is the start of a range (for label positioning)
                  const range = baseAvailable ? findRange(day, displayIdx) : null;
                  const isRangeStart = range && range.startDi === displayIdx;
                  const rangeHeight = range ? (range.endDi - range.startDi + 1) * SLOT_HEIGHT : 0;

                  // Drag preview label positioning
                  const isDragStart = inDrag && displayIdx === dragMinIdx;
                  const dragHeight = inDrag ? (dragMaxIdx - dragMinIdx + 1) * SLOT_HEIGHT : 0;

                  return (
                    <div
                      key={day}
                      onPointerDown={(e) => handlePointerDown(day, displayIdx, e)}
                      className={`relative h-[3px] ${
                        baseAvailable ? 'cursor-pointer' : 'cursor-crosshair'
                      } ${
                        inDrag
                          ? 'bg-red-300'
                          : showAvailable
                            ? 'bg-red-200'
                            : 'bg-gray-50'
                      }`}
                    >
                      {/* Time label on existing range */}
                      {isRangeStart && rangeHeight >= 24 && !inDrag && (
                        <div
                          className="pointer-events-none absolute left-0 right-0 z-10 flex flex-col items-center justify-center overflow-hidden"
                          style={{ height: rangeHeight, top: 0 }}
                        >
                          <span className="text-[10px] font-semibold leading-tight text-red-700">
                            {range.startTime}
                          </span>
                          <span className="text-[10px] font-semibold leading-tight text-red-700">
                            {range.endTime}
                          </span>
                        </div>
                      )}
                      {/* Time label on drag preview */}
                      {isDragStart && dragHeight >= 18 && (
                        <div
                          className="pointer-events-none absolute left-0 right-0 z-20 flex flex-col items-center justify-center overflow-hidden"
                          style={{ height: dragHeight, top: 0 }}
                        >
                          <span className="text-[10px] font-bold leading-tight text-red-800">
                            {dragStartTime}
                          </span>
                          <span className="text-[10px] font-bold leading-tight text-red-800">
                            {dragEndTime}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-sm bg-red-200" />
            {t('schedule.available')}
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded-sm bg-gray-50 border border-gray-200" />
            {t('schedule.unavailable')}
          </div>
          <p className="text-gray-400">{t('schedule.dragToAdd')}</p>
        </div>
      </div>

      {/* Range edit dialog */}
      {editingRange && (
        <RangeEditDialog
          range={editingRange.range}
          day={editingRange.day}
          open
          onClose={() => setEditingRange(null)}
          onSave={handleRangeSave}
          onRemove={handleRangeRemove}
        />
      )}
    </div>
  );
}
