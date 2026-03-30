import { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Button, Dialog, Input, Select } from '@/components/ui';
import { XIcon, PlusIcon, CalendarIcon } from '@/components/ui/Icons';
import { slotIndexToTime, timeToSlotIndex, setSlotRange, createEmptySlots } from '@ejm/shared';
import type { ScheduleOverrideDoc } from '@ejm/shared';

interface OverrideListProps {
  overrides: ScheduleOverrideDoc[];
  onAdd: (date: string, type: 'unavailable' | 'custom', slots?: boolean[]) => Promise<void>;
  onRemove: (date: string) => Promise<void>;
}

// Time options 06:00–02:00 (wrapping past midnight) in 15-min steps
function generateTimeOptions(tFollowingDay: string): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  for (let slot = 24; slot < 96; slot++) {
    const time = slotIndexToTime(slot);
    options.push({ value: time, label: time });
  }
  for (let slot = 0; slot <= 8; slot++) {
    const time = slotIndexToTime(slot);
    options.push({ value: time, label: `${time} ${tFollowingDay}` });
  }
  return options;
}

function formatOverrideDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Extract the first range's start/end from slots (display order 6h→2h)
function getFirstRange(slots: boolean[]): { start: string; end: string } {
  const displayOrder = [
    ...Array.from({ length: 72 }, (_, i) => i + 24),
    ...Array.from({ length: 8 }, (_, i) => i),
  ];
  let startSlot: number | null = null;
  for (let di = 0; di < displayOrder.length; di++) {
    const slot = displayOrder[di];
    if (slots[slot] && startSlot === null) startSlot = slot;
    if (!slots[slot] && startSlot !== null) {
      return { start: slotIndexToTime(startSlot), end: slotIndexToTime(slot) };
    }
  }
  if (startSlot !== null) return { start: slotIndexToTime(startSlot), end: '02:00' };
  return { start: '18:00', end: '00:00' };
}

function describeOverride(override: ScheduleOverrideDoc, t: (key: string) => string): string {
  if (override.type === 'unavailable') return t('schedule.unavailableAllDay');
  if (override.slots) {
    const displayOrder = [
      ...Array.from({ length: 72 }, (_, i) => i + 24),
      ...Array.from({ length: 8 }, (_, i) => i),
    ];
    const ranges: string[] = [];
    let start: number | null = null;
    for (let di = 0; di < displayOrder.length; di++) {
      const slot = displayOrder[di];
      if (override.slots[slot] && start === null) start = slot;
      if (!override.slots[slot] && start !== null) {
        ranges.push(`${slotIndexToTime(start)}–${slotIndexToTime(slot)}`);
        start = null;
      }
    }
    if (start !== null) ranges.push(`${slotIndexToTime(start)}–02:00`);
    if (ranges.length > 0) return ranges.join(', ');
  }
  return t('schedule.noAvailabilityLabel');
}

function buildSlots(start: string, end: string): boolean[] {
  const startIdx = timeToSlotIndex(start);
  const endIdx = timeToSlotIndex(end);
  const slots = createEmptySlots();
  if (startIdx < endIdx) {
    return setSlotRange(slots, start, end, true);
  } else {
    for (let i = startIdx; i < 96; i++) slots[i] = true;
    for (let i = 0; i < endIdx; i++) slots[i] = true;
    return slots;
  }
}

type FormMode = null | 'availability' | 'block';

export function OverrideList({ overrides, onAdd, onRemove }: OverrideListProps) {
  const { t, i18n } = useTranslation();
  const TIME_OPTIONS = useMemo(() => generateTimeOptions(t('schedule.followingDay')), [t]);
  const formRef = useRef<HTMLDivElement>(null);
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('00:00');
  const [saving, setSaving] = useState(false);

  // Edit dialog state
  const [editingOverride, setEditingOverride] = useState<ScheduleOverrideDoc | null>(null);
  const [editStart, setEditStart] = useState('18:00');
  const [editEnd, setEditEnd] = useState('00:00');
  const [editType, setEditType] = useState<'unavailable' | 'custom'>('custom');

  const openEditDialog = (override: ScheduleOverrideDoc) => {
    setEditType(override.type);
    if (override.type === 'custom' && override.slots) {
      const range = getFirstRange(override.slots);
      setEditStart(range.start);
      setEditEnd(range.end);
    } else {
      setEditStart('18:00');
      setEditEnd('00:00');
    }
    setEditingOverride(override);
  };

  const handleEditSave = async () => {
    if (!editingOverride) return;
    setSaving(true);
    try {
      // Remove old, add new
      await onRemove(editingOverride.date);
      if (editType === 'unavailable') {
        await onAdd(editingOverride.date, 'unavailable');
      } else {
        const slots = buildSlots(editStart, editEnd);
        await onAdd(editingOverride.date, 'custom', slots);
      }
      setEditingOverride(null);
    } finally {
      setSaving(false);
    }
  };

  const handleEditRemove = async () => {
    if (!editingOverride) return;
    setSaving(true);
    try {
      await onRemove(editingOverride.date);
      setEditingOverride(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddAvailability = async () => {
    if (!date) return;
    setSaving(true);
    try {
      const slots = buildSlots(startTime, endTime);
      await onAdd(date, 'custom', slots);
      setDate('');
      setFormMode(null);
    } finally {
      setSaving(false);
    }
  };

  const handleBlockDay = async () => {
    if (!date) return;
    setSaving(true);
    try {
      await onAdd(date, 'unavailable');
      setDate('');
      setFormMode(null);
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];

  return (
    <div>
      {overrides.length === 0 && !formMode && (
        <p className="mb-4 text-sm text-gray-400">{t('schedule.noOverrides')}</p>
      )}

      {overrides.map((o) => (
        <Card
          key={o.date}
          interactive
          className="mb-2 flex items-center justify-between"
          onClick={() => openEditDialog(o)}
        >
          <div>
            <p className="text-sm font-medium">{formatOverrideDate(o.date, i18n.language)}</p>
            <p className="text-xs text-gray-500">{describeOverride(o, t)}</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(o.date); }}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </Card>
      ))}

      {formMode === 'availability' && (
        <Card className="mt-3" ref={formRef as any}>
          <p className="mb-3 text-sm font-semibold text-gray-700">{t('schedule.addAvailability')}</p>
          <Input
            label={t('common.date')}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={today}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <Select label={t('schedule.from')} value={startTime} onChange={(e) => setStartTime(e.target.value)} options={TIME_OPTIONS} />
            </div>
            <div className="flex-1">
              <Select label={t('schedule.to')} value={endTime} onChange={(e) => setEndTime(e.target.value)} options={TIME_OPTIONS} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={handleAddAvailability} disabled={!date || saving} className="flex-1">
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormMode(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      )}

      {formMode === 'block' && (
        <Card className="mt-3" ref={formRef as any}>
          <p className="mb-3 text-sm font-semibold text-gray-700">{t('schedule.blockDay')}</p>
          <Input
            label={t('common.date')}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={today}
          />
          <p className="mb-4 text-xs text-gray-500">
            {t('schedule.blockDayDesc')}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={handleBlockDay} disabled={!date || saving} className="flex-1">
              {saving ? t('common.saving') : t('schedule.blockDay')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormMode(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </Card>
      )}

      {!formMode && (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => { setFormMode('availability'); setDate(''); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }}
            className="flex-1"
          >
            <PlusIcon className="h-4 w-4" />
            {t('schedule.addAvailability')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { setFormMode('block'); setDate(''); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }}
            className="flex-1"
          >
            <CalendarIcon className="h-4 w-4" />
            {t('schedule.blockDay')}
          </Button>
        </div>
      )}

      {/* Edit override dialog */}
      {editingOverride && (
        <Dialog open onClose={() => setEditingOverride(null)}>
          <h3 className="mb-2 text-lg font-bold">
            {formatOverrideDate(editingOverride.date, i18n.language)}
          </h3>

          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">{t('schedule.type')}</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditType('custom')}
                className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                  editType === 'custom'
                    ? 'border-red-600 bg-red-50 text-red-600'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {t('schedule.available')}
              </button>
              <button
                type="button"
                onClick={() => setEditType('unavailable')}
                className={`flex-1 rounded-lg border-[1.5px] px-3 py-2 text-sm font-medium transition-colors ${
                  editType === 'unavailable'
                    ? 'border-red-600 bg-red-50 text-red-600'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {t('schedule.unavailable')}
              </button>
            </div>
          </div>

          {editType === 'custom' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <Select label={t('schedule.from')} value={editStart} onChange={(e) => setEditStart(e.target.value)} options={TIME_OPTIONS} />
              </div>
              <div className="flex-1">
                <Select label={t('schedule.to')} value={editEnd} onChange={(e) => setEditEnd(e.target.value)} options={TIME_OPTIONS} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button type="button" onClick={handleEditSave} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleEditRemove}
              disabled={saving}
              className="!text-red-600 !border-red-200"
            >
              {t('schedule.removeAvailability')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditingOverride(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
