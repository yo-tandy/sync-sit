import { useState, useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useSchedule } from '@/hooks/useSchedule';
import { useHolidays } from '@/hooks/useHolidays';
import { WeeklyTimeline } from '@/components/schedule/WeeklyTimeline';
import { DayEditor } from '@/components/schedule/DayEditor';
import { OverrideList } from '@/components/schedule/OverrideList';
import { Button, Card, Dialog, TopNav, Textarea, Spinner, InfoBanner } from '@/components/ui';
import { ChevronRightIcon } from '@/components/ui/Icons';
import { DAYS_OF_WEEK, createEmptySlots } from '@ejm/shared';
import type { DayOfWeek, HolidayMode, HolidayPeriod } from '@ejm/shared';

function getHolidayOptions(t: (key: string) => string): { value: HolidayMode; label: string; description: string }[] {
  return [
    { value: 'same', label: t('schedule.sameAsRegular'), description: t('schedule.sameDesc') },
    { value: 'different', label: t('schedule.differentSchedule'), description: t('schedule.differentDesc') },
    { value: 'unavailable', label: t('schedule.notAvailable'), description: t('schedule.notAvailableDesc') },
  ];
}

function createDefaultWeekly(): Record<DayOfWeek, boolean[]> {
  return Object.fromEntries(DAYS_OF_WEEK.map((d) => [d, createEmptySlots()])) as Record<DayOfWeek, boolean[]>;
}

function formatDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' });
}

function HolidayPeriodEditor({
  period,
  schedule,
  onChange,
}: {
  period: HolidayPeriod;
  schedule: Record<DayOfWeek, boolean[]>;
  onChange: (schedule: Record<DayOfWeek, boolean[]>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);

  const handleDaySave = useCallback(
    (day: DayOfWeek, slots: boolean[]) => {
      onChange({ ...schedule, [day]: slots });
    },
    [schedule, onChange]
  );

  // Check if any slots are set
  const { t, i18n } = useTranslation();
  const hasAvailability = DAYS_OF_WEEK.some((d) => schedule[d].some(Boolean));

  return (
    <Card className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-gray-900">{period.name}</p>
          <p className="text-xs text-gray-500">
            {formatDate(period.startDate, i18n.language)} — {formatDate(period.endDate, i18n.language)}
          </p>
          {!expanded && (
            <p className="mt-1 text-xs text-gray-400">
              {hasAvailability ? t('schedule.customAvailabilitySet') : t('schedule.noAvailabilityTapToEdit')}
            </p>
          )}
        </div>
        <ChevronRightIcon
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <WeeklyTimeline
            weekly={schedule}
            onChange={onChange}
            onDayHeaderClick={(day) => setEditingDay(day)}
          />
          {editingDay && (
            <DayEditor
              day={editingDay}
              slots={schedule[editingDay]}
              open
              onClose={() => setEditingDay(null)}
              onSave={handleDaySave}
            />
          )}
        </div>
      )}
    </Card>
  );
}

export function SchedulePage() {
  const { t } = useTranslation();
  const {
    weekly,
    holidayMode,
    holidaySchedules: savedHolidaySchedules,
    holidayNotes,
    overrides,
    loading,
    saveWeekly,
    setHolidayMode,
    addOverride,
    removeOverride,
  } = useSchedule();

  const { periods: holidayPeriods, loading: holidaysLoading } = useHolidays();

  const [localWeekly, setLocalWeekly] = useState(weekly);
  const [localHolidayMode, setLocalHolidayMode] = useState<HolidayMode>(holidayMode);
  const [localHolidaySchedules, setLocalHolidaySchedules] = useState<Record<string, Record<DayOfWeek, boolean[]>>>({});
  const [localHolidayNotes, setLocalHolidayNotes] = useState(holidayNotes || '');
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savedSnapshot = useRef<string>('');

  // Sync from hook when data loads
  if (!loading && !initialized) {
    setLocalWeekly(weekly);
    setLocalHolidayMode(holidayMode);
    setLocalHolidaySchedules(savedHolidaySchedules || {});
    setLocalHolidayNotes(holidayNotes || '');
    savedSnapshot.current = JSON.stringify({ weekly, holidayMode, holidaySchedules: savedHolidaySchedules || {}, holidayNotes: holidayNotes || '' });
    setInitialized(true);
  }

  // Track dirty state by comparing current local state to saved snapshot
  useEffect(() => {
    if (!initialized) return;
    const current = JSON.stringify({
      weekly: localWeekly,
      holidayMode: localHolidayMode,
      holidaySchedules: localHolidaySchedules,
      holidayNotes: localHolidayNotes,
    });
    setDirty(current !== savedSnapshot.current);
  }, [localWeekly, localHolidayMode, localHolidaySchedules, localHolidayNotes, initialized]);

  // Block navigation when there are unsaved changes
  const blocker = useBlocker(dirty);

  // Also warn on browser back / tab close
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleDaySave = useCallback((day: DayOfWeek, slots: boolean[]) => {
    setLocalWeekly((prev) => ({ ...prev, [day]: slots }));
  }, []);

  const handleHolidayPeriodChange = useCallback(
    (periodName: string, schedule: Record<DayOfWeek, boolean[]>) => {
      setLocalHolidaySchedules((prev) => ({ ...prev, [periodName]: schedule }));
    },
    []
  );

  const getHolidayPeriodSchedule = (periodName: string): Record<DayOfWeek, boolean[]> => {
    return localHolidaySchedules[periodName] || createDefaultWeekly();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveWeekly(localWeekly);
      await setHolidayMode(
        localHolidayMode,
        localHolidayMode === 'different' ? localHolidaySchedules : undefined,
        localHolidayNotes || undefined
      );
      savedSnapshot.current = JSON.stringify({
        weekly: localWeekly,
        holidayMode: localHolidayMode,
        holidaySchedules: localHolidaySchedules,
        holidayNotes: localHolidayNotes,
      });
      setDirty(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading || holidaysLoading) {
    return (
      <div>
        <TopNav title={t('schedule.title')} backTo="/babysitter" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('schedule.title')} backTo="/babysitter" />

      <div className="px-5 pt-4 pb-8">
        {success && <InfoBanner className="mb-4">{t('schedule.scheduleSaved')}</InfoBanner>}

        {/* ─── Section 1: Regular Availability ─── */}
        <h3 className="mb-3 text-base font-bold text-gray-900">{t('schedule.regularAvailability')}</h3>
        <p className="mb-4 text-xs text-gray-500">
          {t('schedule.regularDesc')}
        </p>

        <WeeklyTimeline
          weekly={localWeekly}
          onChange={setLocalWeekly}
          onDayHeaderClick={(day) => setEditingDay(day)}
        />

        {editingDay && (
          <DayEditor
            day={editingDay}
            slots={localWeekly[editingDay]}
            open
            onClose={() => setEditingDay(null)}
            onSave={handleDaySave}
          />
        )}

        <hr className="my-6 border-gray-200" />

        {/* Holiday mode */}
        <h4 className="mb-3 text-sm font-semibold text-gray-700">{t('schedule.schoolHolidays')}</h4>
        <div className="mb-4 space-y-2">
          {getHolidayOptions(t).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLocalHolidayMode(opt.value)}
              className={`flex w-full items-start gap-3 rounded-lg border-[1.5px] p-3 text-left transition-colors ${
                localHolidayMode === opt.value
                  ? 'border-red-600 bg-red-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div
                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                  localHolidayMode === opt.value
                    ? 'border-red-600 bg-red-600'
                    : 'border-gray-300'
                }`}
              >
                {localHolidayMode === opt.value && (
                  <div className="m-[2px] h-2 w-2 rounded-full bg-white" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-gray-500">{opt.description}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Per-period holiday schedules */}
        {localHolidayMode === 'different' && (
          <div className="mb-4">
            {holidayPeriods.length === 0 ? (
              <p className="text-sm text-gray-400">
                {t('schedule.noVacationPeriods')}
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  {t('schedule.setAvailabilityPerPeriod')}
                </p>
                {holidayPeriods.map((period) => (
                  <HolidayPeriodEditor
                    key={period.name}
                    period={period}
                    schedule={getHolidayPeriodSchedule(period.name)}
                    onChange={(s) => handleHolidayPeriodChange(period.name, s)}
                  />
                ))}
              </>
            )}
          </div>
        )}

        <Textarea
          label={t('schedule.holidayNotes')}
          value={localHolidayNotes}
          onChange={(e) => setLocalHolidayNotes(e.target.value)}
          placeholder={t('schedule.holidayNotesPlaceholder')}
        />

        <Button type="button" onClick={handleSave} disabled={saving} className="mt-4 mb-6">
          {saving ? t('common.saving') : t('schedule.saveSchedule')}
        </Button>

        <hr className="my-6 border-gray-200" />

        {/* ─── Section 2: Availability by Date ─── */}
        <h3 className="mb-1 text-base font-bold text-gray-900">{t('schedule.availabilityByDate')}</h3>
        <p className="mb-4 text-xs text-gray-500">
          {t('schedule.dateOverrideDesc')}
        </p>

        <OverrideList overrides={overrides} onAdd={addOverride} onRemove={removeOverride} />
      </div>

      {/* Unsaved changes dialog */}
      {blocker.state === 'blocked' && (
        <Dialog open onClose={() => blocker.reset()}>
          <h3 className="mb-2 text-lg font-bold">{t('schedule.unsavedChanges')}</h3>
          <p className="mb-5 text-sm text-gray-600">
            {t('schedule.unsavedDesc')}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={async () => {
                await handleSave();
                blocker.proceed();
              }}
              disabled={saving}
            >
              {saving ? t('common.saving') : t('schedule.saveAndLeave')}
            </Button>
            <Button type="button" variant="outline" onClick={() => blocker.proceed()}>
              {t('schedule.discardChanges')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => blocker.reset()}>
              {t('schedule.stayOnPage')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
