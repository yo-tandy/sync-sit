import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Checkbox } from '../components/Checkbox.js';
import { InfoBanner } from '../components/InfoBanner.js';
import { PhoneInput } from '../forms/PhoneInput.js';

export interface ContactInfoData {
  contactEmail: string;
  contactPhone: string;
  /** Matches root `User.whatsapp` (a phone string, or `null` when unset) --
   *  same shape as sit's/study's AccountPage write. */
  whatsapp: string | null;
  /**
   * The contact-visibility consent checkbox. Optional-but-consequential
   * (issue #435): leaving it unchecked never blocks submission, it just
   * means the eventual `effectiveSearchable` computed field (a separate
   * PR in this milestone) stays false until the user turns contact
   * visibility on later, from their account settings.
   */
  contactVisibilityConsent: boolean;
}

interface StepContactInfoProps {
  onNext: (data: ContactInfoData) => void;
  /** Previously-entered values, restored on back-navigation. */
  initial?: ContactInfoData | null;
  /**
   * The verified EJM email from `StepEmail`/`StepVerify`, offered as a
   * one-tap autofill for the contact email field -- a pure client-side
   * copy, no callable involved.
   */
  ejemEmail: string;
  /** A submit-time server rejection carried back from a later step. */
  serverError?: string | null;
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Contact-info step of the unified enrollment flow (issue #435 milestone,
 * PR3, step 4b "contact information"): contact email, contact phone,
 * WhatsApp, and the new contact-visibility consent checkbox.
 *
 * The step as a WHOLE requires at least one contact channel (email or
 * phone) -- neither field is individually mandatory, matching the issue's
 * exact wording ("at least phone or email"). The consent checkbox never
 * gates submission; unchecking it only changes the inline warning shown
 * below it.
 *
 * `contactSharingConsent` (the closest existing precedent) lives ONLY in
 * sit's babysitter AccountPage (a post-enrollment settings toggle, not an
 * enrollment step), with copy hardcoded to babysitting
 * ("parents who'd want to contact me for babysitting..."). This component
 * is reached BEFORE the user has picked sit or study, so that copy can't be
 * reused verbatim -- it would be actively wrong for someone about to become
 * a tutor. This is the concept's first real ENROLLMENT-time consumer, with
 * new, role-neutral copy (`unifiedEnrollment.contactVisibilityConsent`).
 *
 * WhatsApp mirrors the exact existing AccountPage pattern: a "same as my
 * phone number" checkbox (default checked) that mirrors the phone field
 * live, with a `PhoneInput` fallback only when unchecked.
 *
 * Presentational only: owns its own field state, calls `onNext` with the
 * finished payload. No callables.
 */
export function StepContactInfo({ onNext, initial = null, ejemEmail, serverError = null }: StepContactInfoProps) {
  const { t } = useTranslation();
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(
    initial ? initial.whatsapp === initial.contactPhone : true,
  );
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? '');
  const [consent, setConsent] = useState(initial?.contactVisibilityConsent ?? false);

  const emailFormatOk = !contactEmail.trim() || EMAIL_FORMAT.test(contactEmail.trim());
  const hasContact = Boolean(contactEmail.trim() || contactPhone.trim());
  const isValid = hasContact && emailFormatOk;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext({
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      whatsapp: whatsappSameAsPhone ? contactPhone.trim() || null : whatsapp.trim() || null,
      contactVisibilityConsent: consent,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('unifiedEnrollment.contactInfoTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('unifiedEnrollment.contactInfoSubtitle')}</p>

      <Input
        label={t('unifiedEnrollment.contactEmail')}
        type="email"
        value={contactEmail}
        onChange={(e) => setContactEmail(e.target.value)}
        error={contactEmail.trim() && !emailFormatOk ? t('unifiedEnrollment.contactEmailInvalid') : undefined}
      />
      {ejemEmail && (
        <button
          type="button"
          onClick={() => setContactEmail(ejemEmail)}
          className="-mt-3 mb-5 text-sm font-medium text-brand-600 hover:underline"
        >
          {t('unifiedEnrollment.autofillEjmEmail', { email: ejemEmail })}
        </button>
      )}

      <PhoneInput
        label={t('unifiedEnrollment.contactPhone')}
        value={contactPhone}
        onChange={(val) => {
          setContactPhone(val);
          if (whatsappSameAsPhone) setWhatsapp(val);
        }}
      />

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('unifiedEnrollment.whatsappLabel')}
        </label>
        <Checkbox
          label={t('unifiedEnrollment.whatsappSameAsPhone')}
          checked={whatsappSameAsPhone}
          onChange={(e) => {
            const same = e.target.checked;
            setWhatsappSameAsPhone(same);
            setWhatsapp(same ? contactPhone : '');
          }}
          className="mb-3"
        />
        {!whatsappSameAsPhone && (
          <PhoneInput label="" value={whatsapp} onChange={setWhatsapp} />
        )}
      </div>

      {!hasContact && (
        <p className="mb-4 text-sm text-error-600">{t('unifiedEnrollment.contactRequired')}</p>
      )}

      <hr className="my-5 border-gray-200" />

      <Checkbox
        label={t('unifiedEnrollment.contactVisibilityConsent')}
        checked={consent}
        onChange={(e) => setConsent(e.target.checked)}
        className="mb-3"
      />
      {!consent && (
        <InfoBanner variant="warning" className="mb-5">
          {t('unifiedEnrollment.contactVisibilityWarning')}
        </InfoBanner>
      )}

      {serverError && <p className="mb-4 text-sm text-error-600">{serverError}</p>}

      <Button type="submit" disabled={!isValid}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
