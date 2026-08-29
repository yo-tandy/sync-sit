import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import {
  DO_ENDORSEMENT_TEXT_MAX,
  DO_ENDORSEMENT_TEXT_MIN,
  DO_ENDORSEMENT_REF_NAME_MAX,
} from '@ejm/do-core';
import { Button, Dialog, Input, Textarea } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';

/**
 * The family's endorsement form (plan §9.1's post-completion prompt,
 * decision 12) — study's `EndorseTutorDialog` with sync-do's differences:
 *
 * - no subject picker: sync-do's server copies the `category` off the
 *   qualifying completed task, so there is nothing for the family to pick;
 * - the bounds come from do-core (`DO_ENDORSEMENT_*`), the same constants
 *   the callable validates against — the frontend pre-empts the round trip
 *   rather than re-deriving numbers (plan §8's rule for every do form).
 *
 * The endorsement is PRIVATE until the student accepts it, so the success
 * state says so rather than implying it is already live. `already-exists`
 * (one endorsement per family+student) is surfaced as its own friendly
 * message AND settles the caller via `onEndorsed`, since retrying can only
 * hit the same refusal.
 */
export function EndorseDoerDialog({
  doerUserId,
  doerName,
  defaultRefName,
  onClose,
  onEndorsed,
}: {
  doerUserId: string;
  doerName: string;
  defaultRefName: string;
  onClose: () => void;
  onEndorsed: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [refName, setRefName] = useState(defaultRefName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < DO_ENDORSEMENT_TEXT_MIN) {
      setError(t('family.endorse.errorTooShort', { min: DO_ENDORSEMENT_TEXT_MIN }));
      return;
    }
    if (!refName.trim()) {
      setError(t('family.endorse.errorNameRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await httpsCallable(functions, 'doSubmitEndorsement')({
        doerUserId,
        referenceText: trimmed,
        refName: refName.trim(),
      });
      setDone(true);
      onEndorsed();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
      if (code === 'functions/already-exists') onEndorsed();
      setError(t(errorKeyFor(code, reason)));
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      ariaLabel={done ? t('family.endorse.successTitle') : t('family.endorse.title', { name: doerName })}
    >
      {done ? (
        <>
          <h3 className="mb-2 text-lg font-bold">{t('family.endorse.successTitle')}</h3>
          <p className="mb-5 text-sm text-gray-600">
            {t('family.endorse.successBody', { name: doerName })}
          </p>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </>
      ) : (
        <>
          <h3 className="mb-1 text-lg font-bold">{t('family.endorse.title', { name: doerName })}</h3>
          <p className="mb-4 text-sm text-gray-500">{t('family.endorse.intro')}</p>

          <Textarea
            label={t('family.endorse.textLabel')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={DO_ENDORSEMENT_TEXT_MAX}
            placeholder={t('family.endorse.textPlaceholder')}
          />

          <Input
            label={t('family.endorse.refNameLabel')}
            value={refName}
            onChange={(e) => setRefName(e.target.value)}
            maxLength={DO_ENDORSEMENT_REF_NAME_MAX}
          />

          {error && <p className="mb-3 text-sm text-error-600">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
              {submitting ? t('family.endorse.submitting') : t('family.endorse.submit')}
            </Button>
            <Button variant="ghost" onClick={onClose} className="flex-1">
              {t('common.back')}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/**
 * Maps a doSubmitEndorsement refusal to its copy. `no_completed_task` gets
 * its own line rather than the generic one: it is the eligibility gate, and
 * "you can endorse a student once a task with them is completed" tells the
 * family what to do, where "something went wrong" leaves them retrying a
 * form that cannot succeed.
 */
function errorKeyFor(code: string | undefined, reason: string | undefined): string {
  if (reason === 'no_completed_task') return 'family.endorse.errorNoCompletedTask';
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
