import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { checkPasswordRequirements } from '@ejm/shared-core';
import { auth, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Card, Input } from '@/components/ui';

/** Machine-readable guardian error code from an HttpsError's details, if any. */
function guardianErrorCode(err: unknown): string | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' ? code : null;
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-500'}`}>
      <span>{met ? '✓' : '○'}</span> {label}
    </p>
  );
}

/**
 * PUBLIC kid-invite redemption page (/kid-invite?token=…). The token from the
 * parent's invite email is the capability — no auth guard wraps this route.
 * The kid chooses a password; redeemKidInvite creates the supervised account
 * and returns the account email, after which the page signs the kid in
 * exactly the way sit enrollment does after account creation
 * (signInWithEmailAndPassword + auth-store wait) and continues to enrollment.
 *
 * Every way a token can be bad (unknown, expired, cancelled, already used) is
 * ONE generic "ask your parent to resend" screen — the backend refuses them
 * indistinguishably, and a missing token renders the same screen locally.
 */
export function KidInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = reqs.minLength && reqs.hasLowercase && reqs.hasUppercase && reqs.hasNumber;
  const passwordsMatch = password === passwordConfirm && passwordConfirm.length > 0;
  const canSubmit = allReqsMet && passwordsMatch && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const fn = httpsCallable<
        { token: string; password: string },
        { success: boolean; uid: string; email: string }
      >(functions, 'redeemKidInvite');
      const res = await fn({ token, password });

      // Sign in with the new account (the enrollment flow's post-callable
      // sign-in, with the email from the callable instead of a typed one).
      await signInWithEmailAndPassword(auth, res.data.email, password);

      // Wait for auth store to load user doc
      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) { unsub(); resolve(); }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) { unsub(); resolve(); }
      });

      navigate('/enroll/babysitter');
    } catch (err) {
      if (guardianErrorCode(err) === 'guardian/invalid-invite') {
        setInvalid(true);
      } else {
        setError(t('kidInvite.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── One generic screen for a missing OR rejected token. ──
  if (!token || invalid) {
    return (
      <div className="px-5 pt-8 pb-8">
        <Card>
          <h2 className="mb-2 text-lg font-bold text-gray-900">{t('kidInvite.invalidTitle')}</h2>
          <p className="text-sm text-gray-600">{t('kidInvite.invalidDesc')}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <h1 className="mb-2 text-xl font-bold">{t('kidInvite.title')}</h1>
      <p className="mb-2 text-sm text-gray-600">{t('kidInvite.intro')}</p>
      <p className="mb-1 text-sm text-gray-600">
        {t('kidInvite.supervisedNote')}{' '}
        <Link to="/supervision-info" className="text-brand-600 hover:underline">
          {t('kidInvite.whatItMeans')}
        </Link>
      </p>
      <p className="mb-6 text-sm text-gray-600">
        {t('kidInvite.docsIntro')}{' '}
        <Link to="/terms" target="_blank" className="text-brand-600 hover:underline">
          {t('enrollment.termsOfService')}
        </Link>{' '}
        {t('enrollment.consentAnd')}{' '}
        <Link to="/privacy" target="_blank" className="text-brand-600 hover:underline">
          {t('enrollment.privacyPolicy')}
        </Link>
        .
      </p>

      <form onSubmit={handleSubmit}>
        <Input
          label={t('common.password')}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Input
          label={t('auth.confirmPassword')}
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          error={
            passwordConfirm && !passwordsMatch ? t('auth.passwordMismatch') : undefined
          }
          autoComplete="new-password"
          required
        />

        {password.length > 0 && (
          <div className="mb-5 space-y-1">
            <Req met={reqs.minLength} label={t('auth.passwordMinLength')} />
            <Req met={reqs.hasLowercase} label={t('auth.passwordHasLowercase')} />
            <Req met={reqs.hasUppercase} label={t('auth.passwordHasUppercase')} />
            <Req met={reqs.hasNumber} label={t('auth.passwordHasNumber')} />
          </div>
        )}

        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {submitting ? t('kidInvite.submitting') : t('kidInvite.submit')}
        </Button>
      </form>
    </div>
  );
}
