import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import type { TutorSearchResult, StudyContactRequestStatus } from '@ejm/study-core';
import { Card, Button, Badge, Avatar, Dialog, Textarea } from '@ejm/shared-ui';
import { humanizeNoticeWindow } from '@/utils/cancellationPolicy';

/**
 * A single tutor result row with a consent-gated contact CTA.
 *
 * Contact details (email/phone/whatsapp) are projected by the searchTutors
 * callable ONLY once the tutor has approved this family, and are rendered ONLY
 * when `requestStatus === 'accepted'` — study reveals contact strictly after
 * acceptance, unlike the sit flow which reveals on send.
 *
 * The expanded card lazily loads the tutor's approved endorsements from the
 * shared `references` collection (client-readable, index-backed) and lists the
 * reference name + text.
 */
export function TutorCard({ result }: { result: TutorSearchResult }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [endorsements, setEndorsements] = useState<{ refName: string; text: string }[] | null>(
    null,
  );
  // Local, optimistic view of this family's request status toward the tutor.
  const [status, setStatus] = useState<'none' | StudyContactRequestStatus>(result.requestStatus);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);

  const initials =
    `${result.firstName.charAt(0)}${result.lastName.charAt(0)}`.toUpperCase() || '?';

  const toggleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    // Lazy-load approved endorsements the first time the card is opened.
    if (next && endorsements === null && result.endorsementCount > 0) {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'references'),
            where('tutorUserId', '==', result.uid),
            where('status', 'in', ['approved', 'published']),
            limit(10),
          ),
        );
        setEndorsements(
          snap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              refName: (data.submittedByName as string) || (data.refName as string) || '',
              text: (data.referenceText as string) || '',
            };
          }),
        );
      } catch {
        setEndorsements([]);
      }
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Avatar initials={initials} src={result.photoUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                {result.firstName} {result.lastName}
              </p>
              <p className="text-xs text-gray-500">
                {t(`tutor.subjects.names.${result.subject}`)} · {result.level} · {result.classLevel}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold text-gray-900">
              {t('family.search.rate', { rate: result.rate })}
            </p>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            {result.languages.length > 0 && <span>{result.languages.join(', ')}</span>}
            {result.locationPrefs.length > 0 && (
              <span>
                {result.locationPrefs.map((p) => t(`family.search.location.${p}`)).join(' · ')}
              </span>
            )}
            {result.sessionLengthsMin.length > 0 && (
              <span>{t('family.search.card.sessionLengths', {
                lengths: result.sessionLengthsMin.join(', '),
              })}</span>
            )}
            {result.distance !== null && (
              <span>{t('family.search.distance', { km: result.distance.toFixed(1) })}</span>
            )}
            {result.cancellationNoticeHours > 0 && (
              <span>
                {t('family.search.cancellationNotice', {
                  window: humanizeNoticeWindow(result.cancellationNoticeHours, t),
                })}
              </span>
            )}
          </div>

          {result.endorsementCount > 0 && (
            <div className="mt-2">
              <Badge variant="green">
                {t('family.search.endorsements', { count: result.endorsementCount })}
              </Badge>
            </div>
          )}

          {result.aboutMe && (
            <p className={`mt-2 text-xs text-gray-600 ${expanded ? '' : 'line-clamp-2'}`}>
              {result.aboutMe}
            </p>
          )}
        </div>
      </div>

      {/* Expand toggle: reveals the full about + lazily-loaded endorsements. */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-expanded={expanded}
        className="mt-2 text-xs font-medium text-brand-600 hover:underline"
      >
        {expanded ? t('family.search.card.showLess') : t('family.search.card.showMore')}
      </button>

      {expanded && endorsements !== null && endorsements.length > 0 && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-semibold text-gray-700">
            {t('family.search.card.endorsementsTitle')}
          </p>
          <div className="space-y-2">
            {endorsements.map((e, i) => (
              <div key={i}>
                <p className="text-xs font-medium text-gray-700">
                  {e.refName
                    ? t('family.search.card.endorsementFrom', { name: e.refName })
                    : t('family.search.card.endorsementAnon')}
                </p>
                {e.text && <p className="text-xs italic text-gray-600">{e.text}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Consent-gated CTA ── */}
      <div className="mt-3">
        {status === 'none' && (
          <Button onClick={() => setDialogOpen(true)}>{t('family.search.card.request')}</Button>
        )}
        {status === 'pending' && (
          <Button disabled>{t('family.search.card.pending')}</Button>
        )}
        {status === 'declined' && (
          <>
            <Button onClick={() => setDialogOpen(true)}>
              {t('family.search.card.requestAgain')}
            </Button>
            <p className="mt-1 text-xs text-gray-500">{t('family.search.card.declinedHint')}</p>
          </>
        )}
        {status === 'accepted' && (
          <>
            <ContactBlock result={result} />
            {/* Carry the full card context so the booking page can build its
                form + calendar without a refetch (router-state-first). */}
            <Link
              to={`/family/book/${result.uid}`}
              state={{
                subject: result.subject,
                level: result.level,
                rate: result.rate,
                sessionLengthsMin: result.sessionLengthsMin,
                locationPrefs: result.locationPrefs,
                tutorName: result.firstName,
                cancellationNoticeHours: result.cancellationNoticeHours,
              }}
              className="mt-3 block"
            >
              <Button className="w-full">{t('family.search.card.book')}</Button>
            </Link>
          </>
        )}
      </div>

      {dialogOpen && (
        <ContactRequestDialog
          tutor={result}
          onClose={() => setDialogOpen(false)}
          onSent={() => {
            setStatus('pending');
            setDialogOpen(false);
            setSuccessOpen(true);
          }}
        />
      )}

      {successOpen && (
        <Dialog open onClose={() => setSuccessOpen(false)}>
          <h3 className="mb-2 text-lg font-bold">{t('family.search.success.title')}</h3>
          <p className="mb-5 text-sm text-gray-600">
            {t('family.search.success.desc', { name: result.firstName })}
          </p>
          <Button onClick={() => setSuccessOpen(false)}>{t('common.done')}</Button>
        </Dialog>
      )}
    </Card>
  );
}

/** Revealed contact links — rendered only for accepted requests. */
function ContactBlock({ result }: { result: TutorSearchResult }) {
  const { t } = useTranslation();
  const wa = result.whatsapp?.replace(/[^\d+]/g, '').replace('+', '');
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="mb-2 text-xs font-semibold text-green-700">
        {t('family.search.card.contactTitle')}
      </p>
      <div className="space-y-1">
        {result.contactEmail && (
          <a
            href={`mailto:${result.contactEmail}`}
            className="flex items-center gap-1.5 text-xs text-brand-600"
          >
            <span>📧</span> {result.contactEmail}
          </a>
        )}
        {result.contactPhone && (
          <a
            href={`tel:${result.contactPhone}`}
            className="flex items-center gap-1.5 text-xs text-brand-600"
          >
            <span>📞</span> {result.contactPhone}
          </a>
        )}
        {wa && (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-green-600"
          >
            <span>💬</span> {t('family.search.card.whatsapp')}
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Dialog for composing a contact request. Sends `sendTutorContactRequest`
 * ({tutorUserId, subject, level, message?}); the message is trimmed and omitted
 * when empty. Distinct callable errors map to distinct copy.
 */
export function ContactRequestDialog({
  tutor,
  onClose,
  onSent,
}: {
  tutor: TutorSearchResult;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    const trimmed = message.trim();
    const payload = {
      tutorUserId: tutor.uid,
      subject: tutor.subject,
      level: tutor.level,
      ...(trimmed ? { message: trimmed } : {}),
    };
    try {
      const fn = httpsCallable(functions, 'sendTutorContactRequest');
      await fn(payload);
      onSent();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      setError(t(errorKeyForCode(code)));
      setSending(false);
    }
  };

  return (
    <Dialog open onClose={onClose}>
      <h3 className="mb-1 text-lg font-bold">
        {t('family.search.contactDialog.title', { name: tutor.firstName })}
      </h3>
      <p className="mb-4 text-sm text-gray-500">
        {t(`tutor.subjects.names.${tutor.subject}`)} · {tutor.level}
      </p>

      <Textarea
        label={t('family.search.contactDialog.messageLabel')}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        placeholder={t('family.search.contactDialog.messagePlaceholder')}
      />

      {error && <p className="mb-3 text-sm text-brand-600">{error}</p>}

      <div className="flex gap-2">
        <Button onClick={handleSend} disabled={sending} className="flex-1">
          {sending
            ? t('family.search.contactDialog.sending')
            : t('family.search.contactDialog.send')}
        </Button>
        <Button variant="ghost" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Maps a sendTutorContactRequest error code to its i18n key. */
function errorKeyForCode(code: string | undefined): string {
  switch (code) {
    case 'functions/already-exists':
      return 'family.search.contactDialog.errorAlreadyExists';
    case 'functions/resource-exhausted':
      return 'family.search.contactDialog.errorCooldown';
    case 'functions/failed-precondition':
      return 'family.search.contactDialog.errorPrecondition';
    default:
      return 'family.search.error';
  }
}
