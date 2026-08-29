import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  DO_AVAILABILITY_NOTE_MAX,
  DO_OFFER_MESSAGE_MAX,
  DO_PRICE_MAX,
  DO_PRICE_MIN,
  getDoerProfile,
  getSubCategoryDef,
  requiresGuardianConsent,
  validateAvailabilityNote,
  validateOfferHelper,
  validateOfferMessage,
  validatePrice,
  type OfferDoc,
  type TaskDoc,
} from '@ejm/do-core';
import { Button, Checkbox, InfoBanner, Input, Spinner, Textarea, TopNav, useToast } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary } from '@/lib/taskDisplay';
import { REFUSAL_KEYS, type Refusal } from './offerRefusals';

/**
 * Make / update an offer (plan §9.2): price + basis, message, the optional
 * §11.3 +1 helper (first/last/age with the not-a-verified-member copy),
 * and an availability note for deadline/recurring/ongoing tasks.
 *
 * THE GUARDIAN GATE IS SHOWN UP FRONT (§6.2): when the sub-category is
 * flagged AND the caller is supervised (userDoc.governedBy — the same
 * check the enrollment wizard uses), the form opens with the
 * approval-first banner so the wait is expected rather than mysterious.
 * The banner is client-side UX; `doSubmitOffer` re-resolves the gate
 * authoritatively against the ACTIVE guardianLinks doc.
 *
 * Validation pre-empts the round trip with do-core's own validators
 * against the shared bounds (§6.3's "the two sides must share the same
 * numbers"). Refusals map per REFUSAL_KEYS; a decision-18
 * `family_declined` re-offer is ALLOWED and runs this same path with no
 * special copy.
 *
 * Editing: a `pending` offer is edited in place via `doUpdateOffer`.
 * `pending_guardian` is deliberately NOT editable (the §4.2 laundering
 * hole in miniature — the parent approved a specific price and message);
 * terminal statuses run the full submit path again (resurrection).
 */
export function OfferPage() {
  const { t } = useTranslation();
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { firebaseUser, userDoc } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [task, setTask] = useState<TaskDoc | null>(null);
  const [existing, setExisting] = useState<OfferDoc | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'not_open' | 'error'>('loading');

  const [price, setPrice] = useState('');
  const [basis, setBasis] = useState<'flat' | 'hourly'>('flat');
  const [message, setMessage] = useState('');
  const [helperOn, setHelperOn] = useState(false);
  const [helperFirst, setHelperFirst] = useState('');
  const [helperLast, setHelperLast] = useState('');
  const [helperAge, setHelperAge] = useState('');
  const [availability, setAvailability] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!taskId || !uid) return;
    let stale = false;
    void (async () => {
      try {
        const [taskSnap, offerSnap] = await Promise.all([
          getDoc(doc(db, 'doTasks', taskId)),
          getDocs(query(collection(db, 'taskOffers'), where('doerUserId', '==', uid), where('taskId', '==', taskId))),
        ]);
        if (stale) return;
        if (!taskSnap.exists()) {
          setLoadState('not_open');
          return;
        }
        const taskDoc = { ...(taskSnap.data() as TaskDoc), taskId: taskSnap.id };
        if (taskDoc.status !== 'open') {
          setLoadState('not_open');
          return;
        }
        setTask(taskDoc);
        setExisting(
          offerSnap.docs.length > 0
            ? { ...(offerSnap.docs[0].data() as OfferDoc), offerId: offerSnap.docs[0].id }
            : null,
        );
        setLoadState('ready');
      } catch {
        if (!stale) setLoadState('error');
      }
    })();
    return () => {
      stale = true;
    };
  }, [taskId, uid]);

  // Prefill ONCE when the load settles: from the existing offer (edit or
  // resurrection), else the profile's defaultRate ("only pre-fills your
  // offer form", §3.3).
  useEffect(() => {
    if (loadState !== 'ready' || prefilled) return;
    setPrefilled(true);
    if (existing) {
      setPrice(String(existing.price));
      setBasis(existing.priceBasis);
      setMessage(existing.message);
      if (existing.helper) {
        setHelperOn(true);
        setHelperFirst(existing.helper.firstName);
        setHelperLast(existing.helper.lastName);
        setHelperAge(String(existing.helper.age));
      }
      setAvailability(existing.availabilityNote ?? '');
    } else {
      const defaultRate = getDoerProfile(userDoc)?.defaultRate;
      if (typeof defaultRate === 'number') setPrice(String(defaultRate));
    }
  }, [loadState, prefilled, existing, userDoc]);

  const editing = existing?.status === 'pending';
  // §6.2 up front: flagged sub-category + supervised caller (the
  // enrollment wizard's governedBy check).
  const gated = task !== null && requiresGuardianConsent(task.subCategory) && !!userDoc?.governedBy;
  const subDef = task === null ? undefined : getSubCategoryDef(task.subCategory);

  const validate = (): { price: number; helper: { firstName: string; lastName: string; age: number } | null } | null => {
    const errors: Record<string, string> = {};
    const priceNum = price.trim() === '' ? NaN : Number(price);
    if (validatePrice(priceNum) !== null) {
      errors.price = t('doer.offerForm.priceError', { min: DO_PRICE_MIN, max: DO_PRICE_MAX });
    }
    if (message.trim().length === 0) {
      errors.message = t('doer.offerForm.messageRequired');
    } else if (validateOfferMessage(message) !== null) {
      errors.message = t('doer.offerForm.messageTooLong', { max: DO_OFFER_MESSAGE_MAX });
    }
    const helper = helperOn
      ? { firstName: helperFirst.trim(), lastName: helperLast.trim(), age: Number(helperAge) }
      : null;
    if (validateOfferHelper(helper) !== null) {
      errors.helper = t('doer.offerForm.helperError');
    }
    const availabilityNote = availability.trim() === '' ? null : availability.trim();
    if (validateAvailabilityNote(availabilityNote) !== null) {
      errors.availability = t('doer.offerForm.availabilityTooLong', { max: DO_AVAILABILITY_NOTE_MAX });
    }
    setFieldErrors(errors);
    return Object.keys(errors).length > 0 ? null : { price: priceNum, helper };
  };

  const submit = async () => {
    if (!task) return;
    const valid = validate();
    if (valid === null) return;
    setBusy(true);
    setSubmitError(null);
    const payload = {
      price: valid.price,
      priceBasis: basis,
      message: message.trim(),
      helper: valid.helper,
      availabilityNote: availability.trim() === '' ? null : availability.trim(),
    };
    try {
      if (editing && existing) {
        await httpsCallable(functions, 'doUpdateOffer')({ ...payload, offerId: existing.offerId });
        toast(t('doer.offerForm.updated'));
        navigate('/offers');
      } else {
        const res = await httpsCallable<Record<string, unknown>, { status: string }>(
          functions,
          'doSubmitOffer',
        )({ ...payload, taskId: task.taskId });
        toast(
          t(
            res.data.status === 'pending_guardian'
              ? 'doer.offerForm.submittedGuardian'
              : 'doer.offerForm.submittedPending',
          ),
        );
        navigate('/offers');
      }
    } catch (err: unknown) {
      const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
      setSubmitError(t(REFUSAL_KEYS[reason as Refusal] ?? 'doer.offerForm.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  if (loadState === 'loading') {
    return (
      <div>
        <TopNav title={t('doer.offerForm.title')} backTo={`/tasks/${taskId}`} />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </div>
    );
  }
  if (loadState === 'not_open' || loadState === 'error' || task === null) {
    return (
      <div>
        <TopNav title={t('doer.offerForm.title')} backTo="/home" />
        <p className="px-6 py-10 text-center text-sm text-gray-500">
          {t(loadState === 'error' ? 'doer.offerForm.loadError' : 'doer.offerForm.taskNotOpen')}
        </p>
      </div>
    );
  }
  // A live gated offer cannot be edited (§4.2): point back at the detail.
  if (existing?.status === 'pending_guardian' || existing?.status === 'accepted') {
    return (
      <div>
        <TopNav title={t('doer.offerForm.title')} backTo={`/tasks/${task.taskId}`} />
        <p className="px-6 py-10 text-center text-sm text-gray-500">
          {t(
            existing.status === 'pending_guardian'
              ? 'doer.taskDetail.awaitingParentHint'
              : 'doer.offerForm.errorOfferExists',
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <TopNav
        title={t(editing ? 'doer.offerForm.editTitle' : 'doer.offerForm.title')}
        backTo={`/tasks/${task.taskId}`}
      />
      <div className="px-6 pt-4 pb-8">
        <h1 className="mb-1 text-lg font-bold text-gray-950">{task.title}</h1>
        <p className="mb-4 text-xs text-gray-500">
          {t(`categories.${task.category}`)} · {t(`subcategories.${task.subCategory}`)} ·{' '}
          {formatTimingSummary(t, task)}
        </p>

        {/* §6.2: the gate is announced BEFORE the student writes a word. */}
        {gated && (
          <InfoBanner variant="warning" className="mb-4">
            <span className="font-semibold">{t('doer.offerForm.guardianGateTitle')}</span>{' '}
            {t('doer.offerForm.guardianGateBody')}
          </InfoBanner>
        )}

        {subDef?.flags.handlesFamilyMoney && (
          <InfoBanner variant="warning" className="mb-4">
            {t('doer.offerForm.moneyNotice')}
          </InfoBanner>
        )}

        <Input
          type="number"
          label={t('doer.offerForm.priceLabel')}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={fieldErrors.price}
          min={DO_PRICE_MIN}
          max={DO_PRICE_MAX}
        />
        {task.suggestedBudget !== null && (
          <p className="-mt-3 mb-4 text-xs text-gray-500">
            {t('doer.offerForm.priceHint', { amount: task.suggestedBudget })}
          </p>
        )}

        <p className="mb-2 text-sm font-medium text-gray-700">{t('doer.offerForm.basisLabel')}</p>
        <div className="mb-5 flex gap-2" role="radiogroup" aria-label={t('doer.offerForm.basisLabel')}>
          {(['flat', 'hourly'] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={basis === b}
              onClick={() => setBasis(b)}
              className={`flex-1 rounded-lg border-[1.5px] px-3 py-2.5 text-sm font-medium transition-colors ${
                basis === b ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-300 text-gray-700'
              }`}
            >
              {t(b === 'flat' ? 'doer.offerForm.basisFlat' : 'doer.offerForm.basisHourly')}
            </button>
          ))}
        </div>

        <Textarea
          label={t('doer.offerForm.messageLabel')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('doer.offerForm.messagePlaceholder')}
          error={fieldErrors.message}
          rows={5}
          maxLength={DO_OFFER_MESSAGE_MAX + 1}
        />

        <div className="mb-5">
          <Checkbox
            checked={helperOn}
            onChange={(e) => setHelperOn(e.target.checked)}
            label={t('doer.offerForm.helperToggle')}
          />
          {helperOn && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3">
              {/* §11.3: the disclosure is ON the form, where the helper is
                  declared. */}
              <p className="mb-3 text-xs leading-relaxed text-amber-700">{t('doer.offerForm.helperNotice')}</p>
              <Input
                label={t('doer.offerForm.helperFirstName')}
                value={helperFirst}
                onChange={(e) => setHelperFirst(e.target.value)}
              />
              <Input
                label={t('doer.offerForm.helperLastName')}
                value={helperLast}
                onChange={(e) => setHelperLast(e.target.value)}
              />
              <Input
                type="number"
                label={t('doer.offerForm.helperAge')}
                value={helperAge}
                onChange={(e) => setHelperAge(e.target.value)}
                min={1}
                max={120}
              />
              {fieldErrors.helper && <p className="text-sm text-error-600">{fieldErrors.helper}</p>}
            </div>
          )}
        </div>

        {task.timing !== 'fixed' && (
          <Textarea
            label={t('doer.offerForm.availabilityLabel')}
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            placeholder={t('doer.offerForm.availabilityPlaceholder')}
            error={fieldErrors.availability}
            rows={2}
            maxLength={DO_AVAILABILITY_NOTE_MAX + 1}
          />
        )}

        {submitError && <p className="mb-3 text-sm text-error-600">{submitError}</p>}

        <Button onClick={submit} disabled={busy}>
          {busy
            ? t('doer.offerForm.submitting')
            : t(editing ? 'doer.offerForm.updateCta' : 'doer.offerForm.submitCta')}
        </Button>
      </div>
    </div>
  );
}
