import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { SUBJECTS } from '@ejm/study-core';
import { Dialog, Button, Input, Textarea, Select } from '@ejm/shared-ui';

/** Client mirror of the zod min-length gate (referenceText.trim().min(10)). */
const MIN_TEXT_LENGTH = 10;

/**
 * Dialog for a family to endorse a tutor they have an accepted contact request
 * with. Submits `submitTutorEndorsement({tutorUserId, referenceText, refName,
 * subject?})` — referenceText is trimmed and gated at >= 10 chars client-side
 * (mirroring the server zod message), refName prefills from the caller's display
 * name (editable), and subject prefills from the request's subject but can be
 * cleared (omitted from the payload when empty).
 *
 * The endorsement is private until the tutor accepts it, so the success state
 * says so explicitly. `already-exists` (one endorsement per family+tutor) is
 * mapped to a friendly "already endorsed" message rather than hidden, and — like
 * success — notifies the parent via onEndorsed so the originating row settles
 * into its "Endorsed" state.
 */
export function EndorseTutorDialog({
  tutorUserId,
  tutorName,
  subject: initialSubject,
  defaultRefName,
  onClose,
  onEndorsed,
}: {
  tutorUserId: string;
  tutorName: string;
  subject?: string;
  defaultRefName: string;
  onClose: () => void;
  onEndorsed: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [refName, setRefName] = useState(defaultRefName);
  const [subject, setSubject] = useState(initialSubject ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const subjectOptions = SUBJECTS.map((s) => ({
    value: s,
    label: t(`tutor.subjects.names.${s}`),
  }));

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_TEXT_LENGTH) {
      setError(t('family.endorse.errorTooShort'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const payload = {
      tutorUserId,
      referenceText: trimmed,
      refName: refName.trim(),
      ...(subject ? { subject } : {}),
    };
    try {
      const fn = httpsCallable(functions, 'submitTutorEndorsement');
      await fn(payload);
      setDone(true);
      onEndorsed();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // already-exists means this family has already endorsed the tutor — surface
      // it as a friendly state AND settle the row (onEndorsed), since re-trying
      // would only hit the same error.
      if (code === 'functions/already-exists') onEndorsed();
      setError(t(errorKeyForCode(code)));
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={onClose} ariaLabel={done ? t('family.endorse.successTitle') : t('family.endorse.title', { name: tutorName })}>
      {done ? (
        <>
          <h3 className="mb-2 text-lg font-bold">{t('family.endorse.successTitle')}</h3>
          <p className="mb-5 text-sm text-gray-600">
            {t('family.endorse.successDesc', { name: tutorName })}
          </p>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </>
      ) : (
        <>
          <h3 className="mb-1 text-lg font-bold">
            {t('family.endorse.title', { name: tutorName })}
          </h3>
          <p className="mb-4 text-sm text-gray-500">{t('family.endorse.intro')}</p>

          <Textarea
            label={t('family.endorse.textLabel')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder={t('family.endorse.textPlaceholder')}
          />

          <Input
            label={t('family.endorse.refNameLabel')}
            value={refName}
            onChange={(e) => setRefName(e.target.value)}
            maxLength={80}
          />

          <Select
            label={t('family.endorse.subjectLabel')}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            options={[{ value: '', label: t('family.endorse.subjectNone') }, ...subjectOptions]}
          />

          {error && <p className="mb-3 text-sm text-brand-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
              {submitting ? t('family.endorse.submitting') : t('family.endorse.submit')}
            </Button>
            <Button variant="ghost" onClick={onClose} className="flex-1">
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Maps a submitTutorEndorsement error code to its i18n key. */
function errorKeyForCode(code: string | undefined): string {
  switch (code) {
    case 'functions/already-exists':
      return 'family.endorse.errorAlreadyExists';
    case 'functions/permission-denied':
      return 'family.endorse.errorPermission';
    case 'functions/invalid-argument':
      return 'family.endorse.errorInvalid';
    default:
      return 'family.endorse.error';
  }
}
