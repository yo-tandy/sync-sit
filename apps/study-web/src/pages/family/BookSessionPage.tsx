import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile, timeToSlotIndex } from '@ejm/shared-core';
import type { KidDoc, DayOfWeek } from '@ejm/shared-core';
import type { LocationPref, TutorSearchResult } from '@ejm/study-core';
import { expandRecurringDates } from '@ejm/study-core';
import { useHolidays } from '@/hooks/useHolidays';
import { Button, Input, Select, Textarea, Checkbox, Chip, Card, TopNav, Spinner, Dialog, Badge } from '@ejm/shared-ui';
import {
  deriveStartChips,
  deriveWeeklySlots,
  effectiveLocationsForSlot,
  effectiveLocationsForWeeklySlot,
  type WeeklyCandidate,
  type AvailabilityLocationRange,
} from './bookingSlots';
import { humanizeNoticeWindow } from '@/utils/cancellationPolicy';

/**
 * Family booking page. Reached from an accepted-tutor context (TutorCard or the
 * requests page) at `/family/book/:tutorUserId`.
 *
 * ENTRY WIRING (delegated decision — router-state-first with a searchTutors
 * fallback): the tutor's `sessionLengthsMin` + `locationPrefs` drive the form
 * and the calendar. The TutorCard entry passes the full card data via router
 * `state` (subject/level/rate/sessionLengthsMin/locationPrefs/tutorName) — no
 * refetch. The requests-page entry is a deep link that carries only subject +
 * level (from the request doc); when the card data is absent we re-derive it
 * with a single `searchTutors({subject, level})` call and match the row on
 * `uid === tutorUserId`. Availability itself always comes from
 * getTutorAvailability, which is the real approval gate.
 *
 * getTutorAvailability is loaded in 14-day pages (a pager walks a 28-day
 * window, respecting the callable's ≤28-day cap). Per day we derive the valid
 * START times for the chosen session length from the boolean[96] grid; picking a
 * chip arms Book. A `permission-denied` (no accepted request) renders a friendly
 * "request contact first" screen — we NEVER surface a raw backend message.
 *
 * WEEKLY mode books a recurring series. It loads the full 28-day window in one
 * call and derives offerable weekly (day, startTime) slots via deriveWeeklySlots
 * (a ≥3-of-4-occurrences client heuristic; the server re-checks each concrete
 * date and skips conflicts). A projection panel lists the next 8 occurrences,
 * greying school-holiday weeks when schoolWeeksOnly is on.
 */

/** Router state carried into the page from an accepted-tutor entry point. */
interface BookNavState {
  subject?: string;
  level?: string;
  rate?: number;
  sessionLengthsMin?: number[];
  locationPrefs?: LocationPref[];
  tutorName?: string;
  cancellationNoticeHours?: number;
}

/** The tutor card data the form needs — resolved from state or a fallback search. */
interface CardData {
  sessionLengthsMin: number[];
  locationPrefs: LocationPref[];
  tutorName: string;
  // Cancellation-notice policy in hours (0 = none); shown near submit (V2 feat 7).
  cancellationNoticeHours: number;
}

/** A kid the family can book for. */
interface Student {
  kidId: string;
  firstName: string;
  age: number;
}

interface AvailabilityDate {
  date: string;
  slots: boolean[];
  /** Effective per-range location sets (issue #166); absent on stale deploys. */
  locationRanges?: AvailabilityLocationRange[];
}

/** Two 14-day pages = a 28-day look-ahead (the callable's hard cap). */
const PAGE_DAYS = 14;
const MAX_PAGE = 1;
/** Weekly derivation window: the full 28-day span (4 occurrences per weekday). */
const WEEKLY_WINDOW_DAYS = 28;
/** Occurrences the tutor's accept flow materializes — mirror in the projection. */
const PROJECTION_WEEKS = 8;

/** 3-letter weekday code → the full-name i18n key under `days.*`. */
const DAY_FULL: Record<DayOfWeek, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/** Paris "YYYY-MM-DD" today (en-CA renders ISO order; tz-correct via runtime). */
function parisToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Add `n` days to a "YYYY-MM-DD" string via UTC midnight (DST-immune). */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function BookSessionPage() {
  const { t, i18n } = useTranslation();
  const { tutorUserId } = useParams<{ tutorUserId: string }>();
  const navigate = useNavigate();
  const navState = (useLocation().state ?? null) as BookNavState | null;
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const subject = navState?.subject ?? '';
  const level = navState?.level ?? '';

  const [card, setCard] = useState<CardData | null>(null);
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState(false);
  // permission-denied anywhere → the friendly "request contact first" screen.
  const [accessDenied, setAccessDenied] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  const [sessionLength, setSessionLength] = useState<number | null>(null);
  const [locationPref, setLocationPref] = useState<LocationPref | ''>('');
  const [message, setMessage] = useState('');

  const [pageIndex, setPageIndex] = useState(0);
  const [availability, setAvailability] = useState<AvailabilityDate[] | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [availError, setAvailError] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);

  // ── Weekly (recurring) mode ──
  const { periods: holidayPeriods } = useHolidays();
  const [mode, setMode] = useState<'one_time' | 'weekly'>('one_time');
  const [weeklyDates, setWeeklyDates] = useState<AvailabilityDate[] | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState(false);
  const [weeklySlot, setWeeklySlot] = useState<WeeklyCandidate | null>(null);
  const [schoolWeeksOnly, setSchoolWeeksOnly] = useState(true);
  const [trialFirstSession, setTrialFirstSession] = useState(false);
  const [endDate, setEndDate] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  // ── Resolve the card data: router-state-first, searchTutors fallback ──
  useEffect(() => {
    let cancelled = false;
    async function resolveCard() {
      if (navState?.sessionLengthsMin && navState?.locationPrefs) {
        if (cancelled) return;
        setCard({
          sessionLengthsMin: navState.sessionLengthsMin,
          locationPrefs: navState.locationPrefs,
          tutorName: navState.tutorName ?? '',
          cancellationNoticeHours: navState.cancellationNoticeHours ?? 0,
        });
        setCardLoading(false);
        return;
      }
      // Deep link (requests page): only subject/level are known — re-derive the
      // card by searching and matching this tutor by uid.
      if (!subject || !level) {
        if (!cancelled) {
          setCardError(true);
          setCardLoading(false);
        }
        return;
      }
      try {
        const fn = httpsCallable<
          { subject: string; level: string },
          { results: TutorSearchResult[] }
        >(functions, 'searchTutors');
        const res = await fn({ subject, level });
        if (cancelled) return;
        const row = (res.data.results ?? []).find((r) => r.uid === tutorUserId);
        if (!row) {
          setCardError(true);
        } else {
          setCard({
            sessionLengthsMin: row.sessionLengthsMin,
            locationPrefs: row.locationPrefs,
            tutorName: navState?.tutorName ?? row.firstName,
            cancellationNoticeHours: row.cancellationNoticeHours ?? 0,
          });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if ((err as { code?: string })?.code === 'functions/permission-denied') {
          setAccessDenied(true);
        } else {
          setCardError(true);
        }
      } finally {
        if (!cancelled) setCardLoading(false);
      }
    }
    resolveCard();
    return () => {
      cancelled = true;
    };
    // navState is snapshot at mount; subject/level/tutorUserId are stable per route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorUserId]);

  // Default the length + location once the card resolves.
  useEffect(() => {
    if (!card) return;
    setSessionLength((prev) => prev ?? card.sessionLengthsMin[0] ?? null);
    setLocationPref((prev) => prev || card.locationPrefs[0] || '');
  }, [card]);

  // ── Load the family's kids (like FamilySettingsPage) ──
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getDocs(collection(db, 'families', familyId, 'kids'))
      .then((snap) => {
        if (cancelled) return;
        setStudents(
          snap.docs.map((d) => {
            const k = d.data() as KidDoc;
            return { kidId: d.id, firstName: k.firstName, age: k.age };
          }),
        );
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  // ── Load a 14-day availability page. Reused as the slot-taken refresh. ──
  const loadAvailability = useCallback(
    async (page: number) => {
      if (!tutorUserId) return;
      setAvailLoading(true);
      setAvailError(false);
      const startDate = addDays(parisToday(), page * PAGE_DAYS);
      const endDate = addDays(startDate, PAGE_DAYS - 1);
      try {
        const fn = httpsCallable<
          { tutorUserId: string; startDate: string; endDate: string },
          { dates: AvailabilityDate[] }
        >(functions, 'getTutorAvailability');
        const res = await fn({ tutorUserId, startDate, endDate });
        setAvailability(res.data.dates ?? []);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === 'functions/permission-denied') {
          setAccessDenied(true);
        } else {
          setAvailError(true);
          setAvailability([]);
        }
      } finally {
        setAvailLoading(false);
      }
    },
    [tutorUserId],
  );

  // Fetch availability once the card resolves (and on page change), unless denied.
  useEffect(() => {
    if (!card || accessDenied) return;
    loadAvailability(pageIndex);
  }, [card, accessDenied, pageIndex, loadAvailability]);

  // Chips re-derive whenever the length changes; a length/location change clears
  // any armed slot (the family reconsiders against the new shape).
  const chipsByDate = useMemo(() => {
    if (!availability || !sessionLength) return [] as { date: string; chips: string[] }[];
    return availability.map((d) => ({ date: d.date, chips: deriveStartChips(d.slots, sessionLength) }));
  }, [availability, sessionLength]);

  // ── Weekly: fetch the full 28-day window once when weekly mode is opened ──
  useEffect(() => {
    if (mode !== 'weekly' || !card || accessDenied || weeklyDates !== null) return;
    let cancelled = false;
    (async () => {
      if (!tutorUserId) return;
      setWeeklyLoading(true);
      setWeeklyError(false);
      const startDate = parisToday();
      const finalEndDate = addDays(startDate, WEEKLY_WINDOW_DAYS - 1);
      try {
        const fn = httpsCallable<
          { tutorUserId: string; startDate: string; endDate: string },
          { dates: AvailabilityDate[] }
        >(functions, 'getTutorAvailability');
        const res = await fn({ tutorUserId, startDate, endDate: finalEndDate });
        if (!cancelled) setWeeklyDates(res.data.dates ?? []);
      } catch (err: unknown) {
        if (cancelled) return;
        if ((err as { code?: string })?.code === 'functions/permission-denied') {
          setAccessDenied(true);
        } else {
          setWeeklyError(true);
          setWeeklyDates([]);
        }
      } finally {
        if (!cancelled) setWeeklyLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, card, accessDenied, weeklyDates, tutorUserId]);

  // Offerable weekly slots re-derive with the length (same ≥3-of-4 heuristic).
  const weeklyCandidates = useMemo(() => {
    if (!weeklyDates || !sessionLength) return [] as WeeklyCandidate[];
    return deriveWeeklySlots(weeklyDates, sessionLength);
  }, [weeklyDates, sessionLength]);

  // Projection: the next 8 occurrences of the chosen weekly slot. Expanded with
  // schoolWeeksOnly=false so holiday dates still appear as explicit skip rows;
  // the per-row holiday classification below greys them when the toggle is on.
  const projection = useMemo(() => {
    if (!weeklySlot) return [] as { date: string; holiday: boolean }[];
    const fromDate = addDays(parisToday(), 1); // ~notice buffer; server authoritative
    const dates = expandRecurringDates(
      { day: weeklySlot.day, startTime: weeklySlot.startTime, endTime: '' },
      fromDate,
      PROJECTION_WEEKS,
      endDate || undefined,
      false,
      [],
    );
    return dates.map((date) => ({
      date,
      holiday: holidayPeriods.some((p) => date >= p.startDate && date <= p.endDate),
    }));
  }, [weeklySlot, endDate, holidayPeriods]);

  // ── Locations offerable for the ARMED slot (issue #166): the server's
  // per-range effective sets constrain the select; without an armed slot (or
  // on a stale deploy without locationRanges) the card's profile prefs apply.
  // UX only — bookSession re-validates server-side. ──
  const allowedLocations = useMemo<LocationPref[]>(() => {
    if (!card) return [];
    const fallback = card.locationPrefs;
    if (!sessionLength) return fallback;
    const lengthSlots = sessionLength / 15;
    if (mode === 'one_time' && selectedDate && selectedStart && availability) {
      const day = availability.find((d) => d.date === selectedDate);
      const startIdx = timeToSlotIndex(selectedStart);
      return effectiveLocationsForSlot(
        day?.locationRanges,
        startIdx,
        startIdx + lengthSlots,
        fallback,
      ) as LocationPref[];
    }
    if (mode === 'weekly' && weeklySlot && weeklyDates) {
      const startIdx = timeToSlotIndex(weeklySlot.startTime);
      return effectiveLocationsForWeeklySlot(
        weeklyDates,
        weeklySlot.day,
        startIdx,
        startIdx + lengthSlots,
        fallback,
      ) as LocationPref[];
    }
    return fallback;
  }, [card, sessionLength, mode, selectedDate, selectedStart, availability, weeklySlot, weeklyDates]);

  // An armed slot that excludes the chosen location snaps it to the first
  // allowed one (or clears it when the covered cells' overrides are disjoint).
  useEffect(() => {
    if (locationPref && !allowedLocations.includes(locationPref as LocationPref)) {
      setLocationPref(allowedLocations[0] ?? '');
    }
  }, [allowedLocations, locationPref]);

  const clearArmed = () => {
    setSelectedDate(null);
    setSelectedStart(null);
    setWeeklySlot(null);
  };

  const toggleStudent = (kidId: string) =>
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(kidId)) next.delete(kidId);
      else next.add(kidId);
      return next;
    });

  const formatDateStr = (s: string): string => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const studentIds = students.filter((s) => selectedStudents.has(s.kidId)).map((s) => s.kidId);

  const canBook =
    selectedStudents.size > 0 &&
    !!sessionLength &&
    !!locationPref &&
    !submitting &&
    (mode === 'one_time' ? !!selectedDate && !!selectedStart : !!weeklySlot);

  const handleBook = async () => {
    if (!canBook || !tutorUserId || !sessionLength) return;
    setSubmitting(true);
    setBookError(null);
    const trimmed = message.trim();
    const common = {
      tutorUserId,
      subject,
      level,
      sessionLengthMinutes: sessionLength,
      location: locationPref as LocationPref,
      studentIds,
      ...(trimmed ? { message: trimmed } : {}),
    };
    const payload =
      mode === 'weekly'
        ? {
            ...common,
            type: 'recurring' as const,
            recurringSlot: { day: weeklySlot!.day, startTime: weeklySlot!.startTime },
            schoolWeeksOnly,
            // Omit-when-false (mirrors endDate) so a non-trial request sends no field.
            ...(trialFirstSession ? { trialFirstSession: true } : {}),
            ...(endDate ? { endDate } : {}),
          }
        : { ...common, date: selectedDate!, startTime: selectedStart! };
    try {
      const fn = httpsCallable(functions, 'bookSession');
      await fn(payload);
      setSuccessOpen(true);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code.includes('permission-denied')) {
        setAccessDenied(true);
      } else if (code.includes('invalid-argument')) {
        // The slot was claimed between load and submit (or the recurring window
        // yielded zero candidates) — refresh and ask for another time. We never
        // quote the backend message.
        clearArmed();
        setBookError(t('family.book.error.slotTaken'));
        if (mode === 'weekly') setWeeklyDates(null);
        else loadAvailability(pageIndex);
      } else if (code.includes('already-exists')) {
        setBookError(t('family.book.error.duplicate'));
      } else if (code.includes('failed-precondition')) {
        setBookError(t('family.book.error.cannotBook'));
      } else {
        setBookError(t('family.book.error.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Friendly access-denied screen (no accepted request) ──
  if (accessDenied) {
    return (
      <div>
        <TopNav title={t('family.book.title')} backTo="/family/search" />
        <div className="px-5 pt-4 pb-8">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
            <p className="mb-1 text-sm font-semibold">{t('family.book.denied.title')}</p>
            <p className="mb-3 text-xs text-amber-700">{t('family.book.denied.desc')}</p>
            <Link to="/family/search" className="text-xs font-semibold text-amber-900 underline">
              {t('family.book.denied.cta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cardLoading) {
    return (
      <div>
        <TopNav title={t('family.book.title')} backTo="/family/search" />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </div>
    );
  }

  if (cardError || !card) {
    return (
      <div>
        <TopNav title={t('family.book.title')} backTo="/family/search" />
        <div className="px-5 pt-4 pb-8">
          <p className="py-6 text-center text-sm text-brand-600">{t('family.book.loadError')}</p>
        </div>
      </div>
    );
  }

  const lengthOptions = card.sessionLengthsMin.map((m) => ({
    value: String(m),
    label: t('family.book.lengthOption', { minutes: m }),
  }));
  const locationOptions = allowedLocations.map((p) => ({
    value: p,
    label: t(`family.search.location.${p}`),
  }));

  return (
    <div>
      <TopNav title={t('family.book.title')} backTo="/family/search" />

      <div className="px-5 pt-4 pb-8">
        {/* Subject · level (display-only — booking is per the accepted context) */}
        <Card className="mb-5">
          {card.tutorName && (
            <p className="text-sm font-semibold text-gray-900">{card.tutorName}</p>
          )}
          <p className="text-xs text-gray-500">
            {subject ? t(`tutor.subjects.names.${subject}`) : ''}
            {level ? ` · ${level}` : ''}
          </p>
        </Card>

        {/* Mode toggle — one-time vs weekly recurring. Shared fields below
            (students/length/location/message) persist across the switch. */}
        <div className="mb-5 flex gap-2">
          <Button
            size="sm"
            variant={mode === 'one_time' ? 'primary' : 'ghost'}
            onClick={() => setMode('one_time')}
          >
            {t('family.book.mode.oneTime')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'weekly' ? 'primary' : 'ghost'}
            onClick={() => setMode('weekly')}
          >
            {t('family.book.mode.weekly')}
          </Button>
        </div>

        {/* Students */}
        <p className="mb-2 text-sm font-semibold text-gray-700">{t('family.book.studentsLabel')}</p>
        {students.length === 0 ? (
          <p className="mb-5 text-xs text-gray-500">{t('family.book.noStudents')}</p>
        ) : (
          <div className="mb-5 space-y-2">
            {students.map((s) => (
              <Checkbox
                key={s.kidId}
                checked={selectedStudents.has(s.kidId)}
                onChange={() => toggleStudent(s.kidId)}
                label={`${s.firstName} (${s.age})`}
              />
            ))}
          </div>
        )}

        {/* Session length */}
        <Select
          label={t('family.book.lengthLabel')}
          value={sessionLength ? String(sessionLength) : ''}
          onChange={(e) => {
            setSessionLength(Number(e.target.value));
            clearArmed();
          }}
          options={lengthOptions}
        />

        {/* Location */}
        <Select
          label={t('family.book.locationLabel')}
          value={locationPref}
          onChange={(e) => {
            setLocationPref(e.target.value as LocationPref);
            clearArmed();
          }}
          options={locationOptions}
        />
        {locationPref === 'family_home' && (
          <p className="-mt-3 mb-5 text-xs text-gray-500">{t('family.book.familyHomeNote')}</p>
        )}
        {allowedLocations.length === 0 && (
          <p className="-mt-3 mb-5 text-xs text-brand-600">{t('family.book.noLocationForSlot')}</p>
        )}

        {/* Optional message */}
        <Textarea
          label={t('family.book.messageLabel')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          placeholder={t('family.book.messagePlaceholder')}
        />

        {/* ── One-time: availability calendar ── */}
        {mode === 'one_time' && (
          <>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">{t('family.book.pickTime')}</p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={pageIndex === 0 || availLoading}
              onClick={() => {
                clearArmed();
                setPageIndex((p) => Math.max(0, p - 1));
              }}
            >
              {t('family.book.prevDates')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pageIndex >= MAX_PAGE || availLoading}
              onClick={() => {
                clearArmed();
                setPageIndex((p) => Math.min(MAX_PAGE, p + 1));
              }}
            >
              {t('family.book.nextDates')}
            </Button>
          </div>
        </div>

        {availLoading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}

        {!availLoading && availError && (
          <p className="py-6 text-center text-sm text-brand-600">{t('family.book.availError')}</p>
        )}

        {!availLoading && !availError && chipsByDate.every((d) => d.chips.length === 0) && (
          <Card className="mb-5">
            <p className="py-4 text-center text-sm text-gray-500">{t('family.book.noSlots')}</p>
          </Card>
        )}

        {!availLoading &&
          !availError &&
          chipsByDate.some((d) => d.chips.length > 0) &&
          chipsByDate.map((d) =>
            d.chips.length === 0 ? null : (
              <div key={d.date} className="mb-4">
                <p className="mb-2 text-xs font-semibold text-gray-600">{formatDateStr(d.date)}</p>
                <div className="flex flex-wrap gap-2">
                  {d.chips.map((chip) => (
                    <Chip
                      key={chip}
                      selected={selectedDate === d.date && selectedStart === chip}
                      onClick={() => {
                        setSelectedDate(d.date);
                        setSelectedStart(chip);
                      }}
                    >
                      {chip}
                    </Chip>
                  ))}
                </div>
              </div>
            ),
          )}
          </>
        )}

        {/* ── Weekly: recurring slot picker + projection ── */}
        {mode === 'weekly' && (
          <>
            {weeklyLoading && (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            )}

            {!weeklyLoading && weeklyError && (
              <p className="py-6 text-center text-sm text-brand-600">{t('family.book.availError')}</p>
            )}

            {!weeklyLoading && !weeklyError && (
              <>
                <p className="mb-2 text-sm font-semibold text-gray-700">
                  {t('family.book.weekly.pickSlot')}
                </p>
                {weeklyCandidates.length === 0 ? (
                  <Card className="mb-5">
                    <p className="py-4 text-center text-sm text-gray-500">
                      {t('family.book.weekly.noSlots')}
                    </p>
                  </Card>
                ) : (
                  <div className="mb-5 flex flex-wrap gap-2">
                    {weeklyCandidates.map((c) => (
                      <Chip
                        key={`${c.day}-${c.startTime}`}
                        selected={weeklySlot?.day === c.day && weeklySlot?.startTime === c.startTime}
                        onClick={() => setWeeklySlot(c)}
                      >
                        {t(`days.${DAY_FULL[c.day]}`)} · {c.startTime}
                      </Chip>
                    ))}
                  </div>
                )}

                <Checkbox
                  checked={schoolWeeksOnly}
                  onChange={(e) => setSchoolWeeksOnly(e.target.checked)}
                  label={t('family.book.weekly.schoolWeeksOnly')}
                  className="mb-4"
                />

                {/* Trial first session (V1.1): a labelling opt-in — the first
                    materialized occurrence is badged as a trial for both parties. */}
                <Checkbox
                  checked={trialFirstSession}
                  onChange={(e) => setTrialFirstSession(e.target.checked)}
                  label={t('family.book.trial.toggle')}
                  className="mb-1"
                />
                <p className="mb-4 text-[11px] leading-tight text-gray-500">
                  {t('family.book.trial.explainer')}
                </p>

                <Input
                  label={t('family.book.weekly.endDateLabel')}
                  type="date"
                  value={endDate}
                  min={weeklySlot ? projection[0]?.date : undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />

                {weeklySlot && projection.length > 0 && (
                  <div className="mb-5">
                    <p className="mb-2 text-xs font-semibold text-gray-600">
                      {t('family.book.weekly.projectionTitle')}
                    </p>
                    <ul className="space-y-1">
                      {(() => {
                        // The trial lands on the first occurrence that actually
                        // materializes — i.e. the first NON-greyed (non-skipped) date.
                        const trialDate = trialFirstSession
                          ? projection.find((p) => !(schoolWeeksOnly && p.holiday))?.date
                          : undefined;
                        return projection.map((p) => {
                          const skipped = schoolWeeksOnly && p.holiday;
                          return (
                            <li key={p.date} className="flex items-center justify-between text-xs">
                              <span className={skipped ? 'text-gray-500 line-through' : 'text-gray-700'}>
                                {formatDateStr(p.date)}
                              </span>
                              {skipped ? (
                                <span className="text-gray-500">
                                  {t('family.book.weekly.skippedHoliday')}
                                </span>
                              ) : (
                                p.date === trialDate && (
                                  <Badge variant="blue">{t('family.book.trial.badge')}</Badge>
                                )
                              )}
                            </li>
                          );
                        });
                      })()}
                    </ul>
                    <p className="mt-2 text-[11px] leading-tight text-gray-500">
                      {t('family.book.weekly.conflictNote')}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {card.cancellationNoticeHours > 0 && (
          <p className="mt-4 text-xs text-gray-500">
            {t('family.book.cancellationPolicy', {
              window: humanizeNoticeWindow(card.cancellationNoticeHours, t),
            })}
          </p>
        )}

        {bookError && <p className="mt-4 mb-2 text-sm text-brand-600">{bookError}</p>}

        <Button className="mt-4" disabled={!canBook} onClick={handleBook}>
          {submitting
            ? t('family.book.booking')
            : mode === 'weekly'
              ? t('family.book.weekly.submit')
              : t('family.book.submit')}
        </Button>
      </div>

      {/* ── Success ── */}
      <Dialog open={successOpen} onClose={() => navigate('/family')}>
        <h3 className="mb-2 text-lg font-bold">{t('family.book.success.title')}</h3>
        <p className="mb-5 text-sm text-gray-600">
          {mode === 'weekly' && weeklySlot
            ? t('family.book.weekly.success.desc', {
                name: card.tutorName || t('family.book.theTutor'),
                day: t(`days.${DAY_FULL[weeklySlot.day]}`),
                time: weeklySlot.startTime,
              })
            : t('family.book.success.desc', { name: card.tutorName || t('family.book.theTutor') })}
        </p>
        <Button className="w-full" onClick={() => navigate('/family')}>
          {t('common.done')}
        </Button>
      </Dialog>
    </div>
  );
}
