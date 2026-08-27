import { useState, useCallback, useEffect, useRef } from 'react';
import { useFlashTimer } from '@ejm/shared-ui';
import { Link, useBlocker } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useSchedule } from '@/hooks/useSchedule';
import { useHolidays } from '@/hooks/useHolidays';
import { getTutorProfile, sanitizeDayLocations, SESSION_LENGTHS, LOCATION_PREFS } from '@ejm/study-core';
import type { LocationPref } from '@ejm/study-core';
import type { ScheduleDoc } from '@ejm/shared-core';
import {
  WeeklyTimeline,
  DayEditor,
  OverrideList,
  Button,
  Card,
  Dialog,
  TopNav,
  Textarea,
  Input,
  Select,
  InfoBanner,
  Spinner,
  ChevronRightIcon,
  useToast,
} from '@ejm/shared-ui';
import { DAYS_OF_WEEK, createEmptySlots, ALL_AREAS, postcodeToArrondissement } from '@ejm/shared-core';
import type { DayOfWeek, HolidayMode, HolidayPeriod } from '@ejm/shared-core';

// Copy-adapted from apps/web/src/pages/babysitter/SchedulePage.tsx. The only
// changes are import sources (schedule leaf components + UI from @ejm/shared-ui,
// hooks from @/hooks, types/constants from @ejm/shared-core) and backTo="/tutor".
// The schedule leaf components (WeeklyTimeline/DayEditor/OverrideList) carry
// their own e2e coverage in sync-sit, so they are not re-tested here.
//
// Issue #169: the session-preferences and cancellation-policy sections moved
// here from AccountPage (booking-shaped settings belong next to availability).
// They keep their OWN save buttons and updateDoc dot-path writes — they are
// deliberately NOT folded into the schedule's save/dirty-tracking flow, and
// their i18n keys stay under tutor.account.* (namespace is historical; kept to
// avoid translation churn).
//
// ACCEPTED RISK (see useSchedule): schedules/{uid} is keyed on uid alone, so a
// dual-profile user (babysitter + tutor) edits ONE shared availability grid
// from both apps. Known limitation, tracked as a follow-up.

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

/** Per-slot location tags for the whole week (issue #166): sparse per day. */
type WeeklyLocationsState = Partial<Record<DayOfWeek, Record<string, string[]>>>;

// Normalize the raw stored map through study-core's junk-tolerant sanitizer
// (the single read seam), back into the sparse editing shape. Days without any
// tagged cell are omitted entirely.
function normalizeWeeklyLocations(raw: ScheduleDoc['weeklyLocations']): WeeklyLocationsState {
  const out: WeeklyLocationsState = {};
  for (const day of DAYS_OF_WEEK) {
    const cells = sanitizeDayLocations(raw?.[day]);
    const sparse: Record<string, string[]> = {};
    cells.forEach((values, idx) => {
      if (values) sparse[String(idx)] = values;
    });
    if (Object.keys(sparse).length > 0) out[day] = sparse;
  }
  return out;
}

// Save-time normalization: drop tags on cells no longer active in the weekly
// grid (a slot toggled off in the timeline sheds its tag) and empty days.
function pruneWeeklyLocations(
  locations: WeeklyLocationsState,
  weekly: Record<DayOfWeek, boolean[]>,
): WeeklyLocationsState {
  const out: WeeklyLocationsState = {};
  for (const day of DAYS_OF_WEEK) {
    const sparse = locations[day];
    if (!sparse) continue;
    const kept: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(sparse)) {
      if (weekly[day]?.[Number(key)] && values.length > 0) kept[key] = values;
    }
    if (Object.keys(kept).length > 0) out[day] = kept;
  }
  return out;
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
            <p className="mt-1 text-xs text-gray-500">
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
    weeklyLocations,
    holidayMode,
    holidaySchedules: savedHolidaySchedules,
    holidayNotes,
    overrides,
    loading,
    saveWeekly,
    addOverride,
    removeOverride,
  } = useSchedule();

  const { periods: holidayPeriods, loading: holidaysLoading } = useHolidays();

  const [localWeekly, setLocalWeekly] = useState(weekly);
  const [localWeeklyLocations, setLocalWeeklyLocations] = useState<WeeklyLocationsState>({});
  const [localHolidayMode, setLocalHolidayMode] = useState<HolidayMode>(holidayMode);
  const [localHolidaySchedules, setLocalHolidaySchedules] = useState<Record<string, Record<DayOfWeek, boolean[]>>>({});
  const [localHolidayNotes, setLocalHolidayNotes] = useState(holidayNotes || '');
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toast = useToast();
  const [initialized, setInitialized] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savedSnapshot = useRef<string>('');

  // --- Moved from AccountPage (issue #169) ---
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const uid = firebaseUser?.uid;

  // Cancellation policy (V2 feature 7) — a preset notice window in hours.
  const [noticeHours, setNoticeHours] = useState(0);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Session preferences (issue #123) — lengths + padding feed the booking
  // slot math, locations feed search filters. All three are owner-editable
  // dot-paths.
  const [sessionLengths, setSessionLengths] = useState<number[]>([]);
  const [locationPrefs, setLocationPrefs] = useState<LocationPref[]>([]);
  const [paddingMin, setPaddingMin] = useState(0);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSuccess, setPrefsSuccess] = useState(false);
  const flashAfter = useFlashTimer();
  const [prefsError, setPrefsError] = useState<string | null>(null);

  // Seed the moved form fields from userDoc exactly once per mount (same
  // guard as AccountPage): the saves call refreshUserDoc(), and re-seeding on
  // every refresh would silently discard unsaved edits in the other section.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!userDoc || seededRef.current) return;
    seededRef.current = true;
    setNoticeHours(tutor?.cancellationNoticeHours ?? 0);
    setSessionLengths(tutor?.sessionLengthsMin ?? []);
    setLocationPrefs(tutor?.locationPrefs ?? []);
    setPaddingMin(tutor?.paddingMin ?? 0);
  }, [userDoc, tutor]);

  // --- Cancellation policy ---
  // Writes only the preset dot-path (like SubjectsPage.handleSave), refreshes the
  // user doc, then shows a transient success. The value is snapshotted onto future
  // bookings server-side; editing it never retro-flags existing sessions.
  const handleSavePolicy = async () => {
    if (!uid) return;
    setPolicySaving(true);
    setPolicyError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.cancellationNoticeHours': noticeHours,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      toast(t('tutor.account.cancellationPolicy.saved'));
    } catch {
      setPolicyError(t('common.error'));
    } finally {
      setPolicySaving(false);
    }
  };

  // --- Session preferences ---
  const toggleSessionLength = (len: number) => {
    setSessionLengths((prev) =>
      prev.includes(len) ? prev.filter((l) => l !== len) : [...prev, len],
    );
    setPrefsSuccess(false);
  };

  const toggleLocationPref = (pref: LocationPref) => {
    setLocationPrefs((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref],
    );
    setPrefsSuccess(false);
  };

  // Coverage-requirement visibility (issue #167): the hard gate lives in
  // searchTutors (an in-person tutor without coverage is excluded), and the
  // area page blocks empty-area saves — but THIS page owns locationPrefs, so
  // a tutor can tick an in-person location here and never learn they are
  // invisible. Derived from the SAVED doc (not draft state) so the warning is
  // persistent: it shows on load for already-misconfigured docs and clears
  // only once the area page has real coverage. Warn + deep-link, never block.
  // "Has coverage" means MATCHABLE coverage: at least one stored area that
  // resolves into the shared vocabulary (postcode-normalized, matching what
  // searchTutors can actually intersect). A doc holding only unmappable
  // free-text-era values can never match a family address, so it still warns.
  const inPersonNoCoverage =
    (tutor?.locationPrefs ?? []).some((p) => p !== 'online' && p !== 'tutor_home') &&
    (tutor?.areaMode === 'distance'
      ? !tutor?.areaLatLng
      : !(tutor?.arrondissements ?? []).some(
          (a) =>
            typeof a === 'string' &&
            (ALL_AREAS as readonly string[]).includes(postcodeToArrondissement(a) ?? a),
        ));

  const handleSavePrefs = async () => {
    if (!uid) return;
    // At least one length and one location (the schema's floor when the
    // fields are present); padding is already clamped by the input.
    if (sessionLengths.length === 0) {
      setPrefsError(t('tutor.account.sessionPrefs.errorNoLengths'));
      setPrefsSuccess(false);
      return;
    }
    if (locationPrefs.length === 0) {
      setPrefsError(t('tutor.account.sessionPrefs.errorNoLocations'));
      setPrefsSuccess(false);
      return;
    }
    // UX validation mirroring enrollment's 0-60; the real bound lives in
    // firestore.rules (tutorNumericBoundsValid).
    if (!Number.isInteger(paddingMin) || paddingMin < 0 || paddingMin > 60) {
      setPrefsError(t('tutor.account.sessionPrefs.errorPaddingRange'));
      setPrefsSuccess(false);
      return;
    }
    setPrefsSaving(true);
    setPrefsSuccess(false);
    setPrefsError(null);
    try {
      await updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.sessionLengthsMin': sessionLengths,
        'profiles.tutor.locationPrefs': locationPrefs,
        'profiles.tutor.paddingMin': paddingMin,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
      setPrefsSuccess(true);
      flashAfter(() => setPrefsSuccess(false), 3000);
    } catch {
      setPrefsError(t('common.error'));
    } finally {
      setPrefsSaving(false);
    }
  };

  // Sync from hook when data loads
  if (!loading && !initialized) {
    const normalizedLocations = normalizeWeeklyLocations(weeklyLocations);
    setLocalWeekly(weekly);
    setLocalWeeklyLocations(normalizedLocations);
    setLocalHolidayMode(holidayMode);
    setLocalHolidaySchedules(savedHolidaySchedules || {});
    setLocalHolidayNotes(holidayNotes || '');
    savedSnapshot.current = JSON.stringify({ weekly, weeklyLocations: normalizedLocations, holidayMode, holidaySchedules: savedHolidaySchedules || {}, holidayNotes: holidayNotes || '' });
    setInitialized(true);
  }

  // Track dirty state by comparing current local state to saved snapshot
  useEffect(() => {
    if (!initialized) return;
    const current = JSON.stringify({
      weekly: localWeekly,
      weeklyLocations: localWeeklyLocations,
      holidayMode: localHolidayMode,
      holidaySchedules: localHolidaySchedules,
      holidayNotes: localHolidayNotes,
    });
    setDirty(current !== savedSnapshot.current);
  }, [localWeekly, localWeeklyLocations, localHolidayMode, localHolidaySchedules, localHolidayNotes, initialized]);

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

  const handleDaySave = useCallback(
    (day: DayOfWeek, slots: boolean[], locations?: Record<string, string[]>) => {
      setLocalWeekly((prev) => ({ ...prev, [day]: slots }));
      if (locations !== undefined) {
        setLocalWeeklyLocations((prev) => {
          const next = { ...prev };
          if (Object.keys(locations).length > 0) next[day] = locations;
          else delete next[day];
          return next;
        });
      }
    },
    [],
  );

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
    setSaveError(null);
    try {
      // Tags on cells toggled off in the timeline are pruned at save time so
      // they never persist and never resurface when a slot is re-enabled.
      const prunedLocations = pruneWeeklyLocations(localWeeklyLocations, localWeekly);
      // ONE atomic write: grid, tags, and holiday fields land (or fail)
      // together — two sequential awaits could persist the first half while
      // the error path claimed nothing was saved (PR #185 review).
      await saveWeekly(localWeekly, prunedLocations, {
        mode: localHolidayMode,
        holidaySchedules:
          localHolidayMode === 'different' ? localHolidaySchedules : undefined,
        holidayNotes: localHolidayNotes || undefined,
      });
      setLocalWeeklyLocations(prunedLocations);
      savedSnapshot.current = JSON.stringify({
        weekly: localWeekly,
        weeklyLocations: prunedLocations,
        holidayMode: localHolidayMode,
        holidaySchedules: localHolidaySchedules,
        holidayNotes: localHolidayNotes,
      });
      setDirty(false);
      toast(t('schedule.scheduleSaved'));
    } catch (err) {
      // A rejected write (offline, transient) must be visible: the snapshot
      // stays dirty and the tutor is told the save did not go through (true
      // now that the write is a single batch). Log the cause so
      // permission-denied vs offline is distinguishable in the field.
      console.error('schedule save failed', err);
      setSaveError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || holidaysLoading) {
    return (
      <div>
        <TopNav title={t('schedule.title')} backTo="/tutor" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-brand-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('schedule.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">

        {/* ─── Section 1: Regular Availability ─── */}
        <h3 className="mb-3 text-base font-bold text-gray-900">{t('schedule.regularAvailability')}</h3>
        <p className="mb-4 text-xs text-gray-500">
          {t('schedule.regularDesc')}
        </p>

        <WeeklyTimeline
          weekly={localWeekly}
          onChange={setLocalWeekly}
          onDayHeaderClick={(day) => setEditingDay(day)}
          locationTags={{
            // Same tag control as the DayEditor path (issue #166, owner
            // report on PR #185): the range-click dialog is the natural
            // interaction, so it must offer the chips too. Same saved-prefs
            // vocabulary; edits land in the page's draft and persist through
            // the same atomic Save Schedule batch.
            options: LOCATION_PREFS.map((p) => ({
              value: p,
              label: t(`tutor.account.sessionPrefs.location.${p}`),
            })),
            offeredValues: tutor?.locationPrefs ?? [],
            defaultsLabel: t('schedule.locationTags.defaults'),
              orLabel: t('schedule.locationTags.or'),
            mixedLabel: t('schedule.locationTags.mixed'),
            notOfferedLabel: t('schedule.locationTags.notOffered'),
            weeklyLocations: localWeeklyLocations,
            onDayLocationsChange: (day, locations) =>
              setLocalWeeklyLocations((prev) => {
                const next = { ...prev };
                if (Object.keys(locations).length > 0) next[day] = locations;
                else delete next[day];
                return next;
              }),
          }}
        />

        {editingDay && (
          <DayEditor
            day={editingDay}
            slots={localWeekly[editingDay]}
            open
            onClose={() => setEditingDay(null)}
            onSave={handleDaySave}
            locationTags={{
              options: LOCATION_PREFS.map((p) => ({
                value: p,
                label: t(`tutor.account.sessionPrefs.location.${p}`),
              })),
              // Chips narrow within what the tutor currently OFFERS — the
              // SAVED doc (same source as the coverage warning), NOT the
              // unsaved prefs draft: the two sections have separate save
              // buttons, and a draft-sourced vocabulary would let "Save
              // Schedule" persist a tag for a pref that was never saved
              // (an instant dead range). A stored tag outside the saved
              // prefs renders checked-but-flagged, never dropped.
              offeredValues: tutor?.locationPrefs ?? [],
              defaultsLabel: t('schedule.locationTags.defaults'),
              orLabel: t('schedule.locationTags.or'),
              mixedLabel: t('schedule.locationTags.mixed'),
              notOfferedLabel: t('schedule.locationTags.notOffered'),
              helpText: t('schedule.locationTags.help'),
              initial: localWeeklyLocations[editingDay],
            }}
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
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div
                className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                  localHolidayMode === opt.value
                    ? 'border-brand-600 bg-brand-600'
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
              <p className="text-sm text-gray-500">
                {t('schedule.noVacationPeriods')}
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-gray-500">
                  {t('schedule.setAvailabilityPerPeriod')}
                </p>
                {Object.keys(localWeeklyLocations).length > 0 && (
                  <p className="mb-3 text-xs text-gray-500">
                    {t('schedule.locationTags.weeklyOnlyNote')}
                  </p>
                )}
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
        {saveError && <p className="-mt-4 mb-6 text-sm text-brand-600">{saveError}</p>}

        <hr className="my-6 border-gray-200" />

        {/* ─── Section 2: Availability by Date ─── */}
        <h3 className="mb-1 text-base font-bold text-gray-900">{t('schedule.availabilityByDate')}</h3>
        <p className="mb-4 text-xs text-gray-500">
          {t('schedule.dateOverrideDesc')}
          {Object.keys(localWeeklyLocations).length > 0 && (
            <> {t('schedule.locationTags.weeklyOnlyNote')}</>
          )}
        </p>

        <OverrideList overrides={overrides} onAdd={addOverride} onRemove={removeOverride} />

        <hr className="my-6 border-gray-200" />

        {/* ─── Section 3: Session preferences (moved from Account, issue #169) ─── */}
        <h3 className="mb-1 text-base font-bold text-gray-900">
          {t('tutor.account.sessionPrefs.title')}
        </h3>
        <p className="mb-4 text-xs text-gray-500">{t('tutor.account.sessionPrefs.help')}</p>

        {prefsSuccess && (
          <InfoBanner className="mb-4">{t('tutor.account.sessionPrefs.saved')}</InfoBanner>
        )}

        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('tutor.account.sessionPrefs.lengths')}
          </label>
          <div className="flex flex-wrap gap-2">
            {SESSION_LENGTHS.map((len) => (
              <button
                key={len}
                type="button"
                aria-pressed={sessionLengths.includes(len)}
                onClick={() => toggleSessionLength(len)}
                className={`rounded-lg border-[1.5px] px-4 py-2 text-sm font-medium transition-colors ${
                  sessionLengths.includes(len)
                    ? 'border-brand-600 bg-brand-50 text-brand-600'
                    : 'border-gray-300 text-gray-700 hover:border-gray-400'
                }`}
              >
                {len} min
              </button>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('tutor.account.sessionPrefs.locations')}
          </label>
          <div className="flex flex-col gap-2">
            {LOCATION_PREFS.map((pref) => (
              <label key={pref} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={locationPrefs.includes(pref)}
                  onChange={() => toggleLocationPref(pref)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {t(`tutor.account.sessionPrefs.location.${pref}`)}
              </label>
            ))}
          </div>
          {inPersonNoCoverage && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-sm text-amber-900">
                {t('tutor.account.sessionPrefs.coverageWarning')}
              </p>
              <Link to="/tutor/area" className="text-sm font-semibold text-amber-900 underline">
                {t('tutor.account.sessionPrefs.coverageWarningCta')}
              </Link>
            </div>
          )}
        </div>

        <Input
          label={t('tutor.account.sessionPrefs.padding')}
          type="number"
          value={paddingMin}
          onChange={(e) => {
            setPaddingMin(parseInt(e.target.value) || 0);
            setPrefsSuccess(false);
          }}
          min={0}
          max={60}
          hint={t('tutor.account.sessionPrefs.paddingHint')}
        />

        {prefsError && <p className="mb-4 text-sm text-brand-600">{prefsError}</p>}
        <Button type="button" onClick={handleSavePrefs} disabled={prefsSaving} className="mb-6">
          {prefsSaving ? t('common.saving') : t('tutor.account.sessionPrefs.save')}
        </Button>

        <hr className="my-6 border-gray-200" />

        {/* ─── Section 4: Cancellation policy (moved from Account, issue #169) ─── */}
        <h3 className="mb-1 text-base font-bold text-gray-900">
          {t('tutor.account.cancellationPolicy.title')}
        </h3>
        <p className="mb-4 text-xs text-gray-500">{t('tutor.account.cancellationPolicy.help')}</p>

        <Select
          aria-label={t('tutor.account.cancellationPolicy.title')}
          value={String(noticeHours)}
          onChange={(e) => setNoticeHours(Number(e.target.value))}
          options={[
            { value: '0', label: t('tutor.account.cancellationPolicy.none') },
            { value: '24', label: t('tutor.account.cancellationPolicy.hours24') },
            { value: '48', label: t('tutor.account.cancellationPolicy.hours48') },
            { value: '168', label: t('tutor.account.cancellationPolicy.week1') },
          ]}
        />
        {policyError && <p className="mb-4 text-sm text-brand-600">{policyError}</p>}
        <Button type="button" onClick={handleSavePolicy} disabled={policySaving} className="mb-6">
          {policySaving ? t('common.saving') : t('tutor.account.cancellationPolicy.save')}
        </Button>
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
