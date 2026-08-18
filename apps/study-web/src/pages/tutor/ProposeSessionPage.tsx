import { useState, useMemo, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getTutorProfile } from '@ejm/study-core';
import type { LocationPref } from '@ejm/study-core';
import { dayOfWeek, resolveEffectiveLocations, sanitizeDayLocations } from '@ejm/study-core';
import type { DayOfWeek } from '@ejm/shared-core';
import { timeToSlotIndex } from '@ejm/shared-core';
import { useSchedule } from '@/hooks/useSchedule';
import { Button, Select, Textarea, Input, Chip, Card, TopNav, Dialog } from '@ejm/shared-ui';
import { deriveStartChips } from '@/pages/family/bookingSlots';

/**
 * Tutor "Propose a session" page (V1.1 feature 3). The tutor proposes a concrete
 * one-time session to an APPROVED family (entered from RequestsPage accepted rows
 * or SessionsPage completed cards, which carry familyId/familyName/subject/level).
 * The FAMILY accepts (picking students) or declines — proposeSession writes a
 * pending `proposedBy:'provider'` doc that claims nothing until they confirm.
 *
 * The form's session-length + location options come from the tutor's OWN profile.
 * The date+time picker HINTS from useSchedule's weekly grid (client-side only):
 * getTutorAvailability is PARENT-gated — the tutor must never call it — so the
 * server (proposeSession's availability pre-check) is the authority and a
 * genuinely-taken slot surfaces as 'slot not available' on submit, exactly like
 * BookSessionPage. The weekly grid over-offers (it ignores overrides/confirmed
 * blocks/notice); that is deliberate and safe — the callable rejects a bad time.
 */

/** Router state carried from the entry point (accepted request / completed card). */
interface ProposeNavState {
  familyName?: string;
  subject?: string;
  level?: string;
}

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

export function ProposeSessionPage() {
  const { t, i18n } = useTranslation();
  const { familyId } = useParams<{ familyId: string }>();
  const navigate = useNavigate();
  const navState = (useLocation().state ?? null) as ProposeNavState | null;
  const { userDoc } = useAuthStore();
  const tutor = getTutorProfile(userDoc);
  const { weekly, weeklyLocations } = useSchedule();

  const familyName = navState?.familyName ?? '';
  const subject = navState?.subject ?? '';
  const level = navState?.level ?? '';

  const lengths = tutor?.sessionLengthsMin ?? [];
  const locations = tutor?.locationPrefs ?? [];

  const [sessionLength, setSessionLength] = useState<number | null>(lengths[0] ?? null);
  const [locationPref, setLocationPref] = useState<LocationPref | ''>(locations[0] ?? '');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [selectedStart, setSelectedStart] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  // Client-side start-time hints for the chosen date, from the tutor's weekly
  // grid (base availability only — the server re-checks authoritatively).
  const startChips = useMemo(() => {
    if (!date || !sessionLength) return [] as string[];
    const dow: DayOfWeek = dayOfWeek(date);
    const daySlots = weekly[dow];
    if (!daySlots) return [];
    return deriveStartChips(daySlots, sessionLength);
  }, [date, sessionLength, weekly]);

  // ── Locations offerable for the ARMED start (issue #166): the tutor's own
  // per-slot tags on that weekday constrain the select. Client hint from the
  // WEEKLY cells (like the start chips above — override dates resolve to
  // profile prefs server-side, so this can only hide options, never offer one
  // proposeSession would reject on a weekly-base date). ──
  const allowedLocations = useMemo<LocationPref[]>(() => {
    const fallback = tutor?.locationPrefs ?? [];
    if (!date || !selectedStart || !sessionLength) return fallback;
    const dow: DayOfWeek = dayOfWeek(date);
    const startIdx = timeToSlotIndex(selectedStart);
    return resolveEffectiveLocations(
      sanitizeDayLocations(weeklyLocations?.[dow]),
      startIdx,
      startIdx + sessionLength / 15,
      fallback,
    );
  }, [tutor?.locationPrefs, date, selectedStart, sessionLength, weeklyLocations]);

  // No `locationPref &&` guard: an emptied selection must RE-FILL when a
  // bookable start is re-armed (PR #185 r3 review) — same fix as
  // BookSessionPage's snap effect.
  useEffect(() => {
    if (!allowedLocations.includes(locationPref as LocationPref)) {
      setLocationPref(allowedLocations[0] ?? '');
    }
  }, [allowedLocations, locationPref]);

  // The armed start narrowed the offer relative to the profile prefs — make
  // the constraint legible next to the select.
  const slotNarrowed =
    !!date &&
    !!selectedStart &&
    allowedLocations.length > 0 &&
    allowedLocations.length < (tutor?.locationPrefs ?? []).length;

  const canPropose =
    !!familyId && !!subject && !!level && !!sessionLength && !!locationPref && !!date &&
    !!selectedStart && !submitting;

  const handlePropose = async () => {
    if (!canPropose || !familyId || !sessionLength) return;
    setSubmitting(true);
    setProposeError(null);
    const trimmed = message.trim();
    try {
      const fn = httpsCallable(functions, 'proposeSession');
      await fn({
        familyId,
        subject,
        level,
        date,
        startTime: selectedStart,
        sessionLengthMinutes: sessionLength,
        location: locationPref as LocationPref,
        ...(trimmed ? { message: trimmed } : {}),
      });
      setSuccessOpen(true);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      const details = (err as { details?: { reason?: string } })?.details;
      if (code.includes('invalid-argument')) {
        // details.reason distinguishes a per-slot location constraint
        // (reachable when the tutor submits before the schedule snapshot
        // lands) from a taken slot — never quote the backend message.
        setSelectedStart(null);
        setProposeError(
          details?.reason === 'location_not_offered'
            ? t('tutor.sessions.propose.noLocationForSlot')
            : t('tutor.sessions.propose.error.slotTaken'),
        );
      } else if (code.includes('already-exists')) {
        setProposeError(t('tutor.sessions.propose.error.duplicate'));
      } else if (code.includes('failed-precondition') || code.includes('permission-denied')) {
        setProposeError(t('tutor.sessions.propose.error.cannotPropose'));
      } else {
        setProposeError(t('tutor.sessions.propose.error.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateStr = (s: string): string => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  // Guard: entered without the family context (a hard refresh loses router state).
  if (!familyId || !subject || !level || !tutor) {
    return (
      <div>
        <TopNav title={t('tutor.sessions.propose.title')} backTo="/tutor/sessions" />
        <div className="px-5 pt-4 pb-8">
          <p className="py-6 text-center text-sm text-brand-600">
            {t('tutor.sessions.propose.loadError')}
          </p>
        </div>
      </div>
    );
  }

  const lengthOptions = lengths.map((m) => ({
    value: String(m),
    label: t('tutor.sessions.propose.lengthOption', { minutes: m }),
  }));
  const locationOptions = allowedLocations.map((p) => ({
    value: p,
    label: t(`tutor.sessions.location.${p}`),
  }));

  return (
    <div>
      <TopNav title={t('tutor.sessions.propose.title')} backTo="/tutor/sessions" />

      <div className="px-5 pt-4 pb-8">
        <Card className="mb-5">
          <p className="text-sm font-semibold text-gray-900">
            {t('tutor.sessions.propose.forFamily', { family: familyName })}
          </p>
          <p className="text-xs text-gray-500">
            {t(`tutor.subjects.names.${subject}`)} · {level}
          </p>
        </Card>

        <Select
          label={t('tutor.sessions.propose.lengthLabel')}
          value={sessionLength ? String(sessionLength) : ''}
          onChange={(e) => {
            setSessionLength(Number(e.target.value));
            setSelectedStart(null);
          }}
          options={lengthOptions}
        />

        <Select
          label={t('tutor.sessions.propose.locationLabel')}
          value={locationPref}
          onChange={(e) => setLocationPref(e.target.value as LocationPref)}
          options={locationOptions}
        />
        {allowedLocations.length === 0 && (
          <p className="-mt-3 mb-5 text-xs text-brand-600">
            {t('tutor.sessions.propose.noLocationForSlot')}
          </p>
        )}
        {slotNarrowed && (
          <p className="-mt-3 mb-5 text-xs text-gray-500">
            {t('tutor.sessions.propose.slotAllows', {
              locations: allowedLocations
                .map((p) => t(`tutor.sessions.location.${p}`))
                .join(', '),
            })}
          </p>
        )}

        <Input
          label={t('tutor.sessions.propose.dateLabel')}
          type="date"
          value={date}
          min={addDays(parisToday(), 1)}
          onChange={(e) => {
            setDate(e.target.value);
            setSelectedStart(null);
          }}
        />

        <Textarea
          label={t('tutor.sessions.propose.messageLabel')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={1000}
          placeholder={t('tutor.sessions.propose.messagePlaceholder')}
        />

        {/* ── Start-time hints for the chosen date ── */}
        <p className="mt-4 mb-2 text-sm font-semibold text-gray-700">
          {t('tutor.sessions.propose.pickTime')}
        </p>
        {!date ? (
          <Card className="mb-5">
            <p className="py-4 text-center text-sm text-gray-500">
              {t('tutor.sessions.propose.chooseDateFirst')}
            </p>
          </Card>
        ) : startChips.length === 0 ? (
          <Card className="mb-5">
            <p className="py-4 text-center text-sm text-gray-500">
              {t('tutor.sessions.propose.noSlots')}
            </p>
          </Card>
        ) : (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold text-gray-600">{formatDateStr(date)}</p>
            <div className="flex flex-wrap gap-2">
              {startChips.map((chip) => (
                <Chip
                  key={chip}
                  selected={selectedStart === chip}
                  onClick={() => setSelectedStart(chip)}
                >
                  {chip}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {proposeError && <p className="mt-2 mb-2 text-sm text-brand-600">{proposeError}</p>}

        <Button className="mt-2" disabled={!canPropose} onClick={handlePropose}>
          {submitting ? t('tutor.sessions.propose.sending') : t('tutor.sessions.propose.submit')}
        </Button>
      </div>

      {/* ── Success ── */}
      <Dialog open={successOpen} onClose={() => navigate('/tutor/sessions')}>
        <h3 className="mb-2 text-lg font-bold">{t('tutor.sessions.propose.success.title')}</h3>
        <p className="mb-5 text-sm text-gray-600">
          {t('tutor.sessions.propose.success.desc', { family: familyName })}
        </p>
        <Button className="w-full" onClick={() => navigate('/tutor/sessions')}>
          {t('common.done')}
        </Button>
      </Dialog>
    </div>
  );
}
