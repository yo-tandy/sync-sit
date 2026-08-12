import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import {
  PRIVACY_POLICY_VERSION,
  SUPERVISION_AGREEMENT_VERSION,
  TOS_VERSION,
  validateEjmEmail,
} from '@ejm/shared-core';
import { functions } from '@/config/firebase';
import { Button, Card, Input, TopNav } from '@/components/ui';

/** Machine-readable guardian error code from an HttpsError's details, if any. */
function guardianErrorCode(err: unknown): string | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Full-page create-kid-invite form: the kid's EJM identity plus the consent
 * trio (ToS / privacy / Supervision Agreement), whose versions are sent
 * VERBATIM from the shared-core constants.
 *
 * ANTI-ENUMERATION UX: the success screen is rendered from static i18n copy
 * only — nothing from the callable's resolution reaches it, so it is pixel-
 * identical whether the backend created an invite, converted to a claim, or
 * silently alerted an admin. The only user-visible rejections are ones that
 * say nothing about the kid's account state (auth, input, consent versions).
 * Copy-adapted from sync-study's CreateKidInvitePage, pin test included.
 */
export function CreateKidInvitePage() {
  const { t } = useTranslation();

  const [kidEmail, setKidEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tosChecked, setTosChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [supervisionChecked, setSupervisionChecked] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  // 'needs-family' gets its own explainer; anything else is a generic message.
  const [error, setError] = useState<'needs-family' | 'generic' | null>(null);

  // Client-side EJM format check for fast feedback — safe to surface (it says
  // nothing about whether an account exists). The backend re-validates.
  const emailCheck = kidEmail.trim() ? validateEjmEmail(kidEmail) : null;
  const emailInvalid = emailCheck !== null && !emailCheck.valid;

  const fieldsValid =
    kidEmail.trim() !== '' &&
    !emailInvalid &&
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    dateOfBirth !== '';
  const consentsChecked = tosChecked && privacyChecked && supervisionChecked;
  const canSubmit = fieldsValid && consentsChecked && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const fn = httpsCallable(functions, 'createKidInvite');
      await fn({
        kidEmail: kidEmail.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dateOfBirth,
        consent: {
          tosVersion: TOS_VERSION,
          privacyVersion: PRIVACY_POLICY_VERSION,
          supervisionAgreementVersion: SUPERVISION_AGREEMENT_VERSION,
        },
      });
      setSent(true);
    } catch (err) {
      setError(guardianErrorCode(err) === 'guardian/not-a-family-parent' ? 'needs-family' : 'generic');
    } finally {
      setSubmitting(false);
    }
  };

  const consentRow = (
    checked: boolean,
    onChange: (checked: boolean) => void,
    docLabel: string,
    docTo: string,
    version: string,
  ) => (
    <label className="flex items-start gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <span>
        {t('governance.invite.consentAgree')}{' '}
        <Link to={docTo} target="_blank" className="text-brand-600 hover:underline">
          {docLabel}
        </Link>{' '}
        {t('governance.invite.consentVersion', { version })}
      </span>
    </label>
  );

  // ── Uniform success screen: static i18n copy only, BY DESIGN. ──
  if (sent) {
    return (
      <div>
        <TopNav title={t('governance.invite.title')} backTo="/family/governance" />
        <div className="px-5 pt-4 pb-8">
          <Card>
            <h2 className="mb-2 text-lg font-bold text-gray-900">{t('governance.inviteSent')}</h2>
            <p className="mb-2 text-sm text-gray-600">{t('governance.inviteSentDesc')}</p>
            <p className="mb-5 text-sm text-gray-500">{t('governance.inviteSentNeutral')}</p>
            <Link to="/family/governance" className="block">
              <Button className="w-full">{t('governance.inviteSentBack')}</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('governance.invite.title')} backTo="/family/governance" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-5 text-sm text-gray-500">{t('governance.invite.intro')}</p>

        {error === 'needs-family' && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-800">
            <p className="mb-1 text-sm font-semibold">{t('governance.invite.needsFamilyTitle')}</p>
            <p className="text-xs text-amber-700">{t('governance.invite.needsFamilyDesc')}</p>
          </div>
        )}
        {error === 'generic' && (
          <p className="mb-4 text-sm text-brand-600">{t('governance.actionError')}</p>
        )}

        <form onSubmit={handleSubmit}>
          <Input
            label={t('governance.invite.emailLabel')}
            type="email"
            value={kidEmail}
            onChange={(e) => setKidEmail(e.target.value)}
            error={emailInvalid ? t('governance.invite.emailInvalid') : undefined}
            hint={t('governance.invite.emailHint')}
          />
          <Input
            label={t('governance.invite.firstName')}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <Input
            label={t('governance.invite.lastName')}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <Input
            label={t('governance.invite.dateOfBirth')}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />

          {/* ── The consent trio — all three are required. ── */}
          <p className="mb-2 text-sm font-semibold text-gray-700">
            {t('governance.invite.consentTitle')}
          </p>
          <div className="mb-6 space-y-3">
            {consentRow(tosChecked, setTosChecked, t('governance.invite.tos'), '/terms', TOS_VERSION)}
            {consentRow(
              privacyChecked,
              setPrivacyChecked,
              t('governance.invite.privacy'),
              '/privacy',
              PRIVACY_POLICY_VERSION,
            )}
            {consentRow(
              supervisionChecked,
              setSupervisionChecked,
              t('governance.invite.supervision'),
              '/supervision-agreement',
              SUPERVISION_AGREEMENT_VERSION,
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? t('governance.invite.submitting') : t('governance.invite.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
