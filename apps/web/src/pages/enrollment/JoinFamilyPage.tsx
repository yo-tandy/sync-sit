import { useState, useEffect, useRef } from 'react';
import { useClientConfigValue } from '@/lib/adminConfigClient';
import { ADMIN_CONFIG_DEFS } from '@ejm/shared-core';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation, Trans } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { getParentProfile } from '@ejm/sit-core';
import { enrollmentErrorReason } from '@ejm/shared-ui';
import { auth, functions } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { Button, Input, TopNav, StepIndicator, Spinner } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';

export function JoinFamilyPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { firebaseUser, userDoc, loading: authLoading, refreshUserDoc } = useAuthStore();

  // Admin-configurable resend window (issue #250) -- must match the
  // server's, whose repeat path answers with a decoy success.
  const resendCooldownS = useClientConfigValue(
    'verificationCodeCooldownS',
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS.default,
    ADMIN_CONFIG_DEFS.verificationCodeCooldownS,
  );

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [familyName, setFamilyName] = useState('');
  const [invalidToken, setInvalidToken] = useState(false);

  // Form state
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Value the running countdown was armed with (round-7 review): the
  // countdown here is armed at CLICK time from whatever resendCooldownS
  // held, so a submit racing the config read arms at 60 against a longer
  // server window. The sync effect below extends (never shortens) a
  // running countdown when the configured value lands -- same guard as
  // StepVerify / StepParentVerify.
  const armedWithRef = useRef(resendCooldownS);

  useEffect(() => {
    const armedWith = armedWithRef.current;
    armedWithRef.current = resendCooldownS;
    setResendCooldown((c) => (c <= 0 ? c : Math.max(c, resendCooldownS - (armedWith - c))));
  }, [resendCooldownS]);
  const [resendCount, setResendCount] = useState(0);

  // Validate invite token on mount
  useEffect(() => {
    if (!token) { setInvalidToken(true); setLoading(false); return; }
    async function validate() {
      try {
        const validateInvite = httpsCallable<{ token: string }, { familyName: string }>(functions, 'validateInviteLink');
        const result = await validateInvite({ token: token! });
        setFamilyName(result.data.familyName || 'your family');
        setLoading(false);
      } catch {
        setInvalidToken(true);
        setLoading(false);
      }
    }
    validate();
  }, [token]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Maps a callable error to the right UI state; returns true if it produced a
  // specialised message (already-in-family or role-exclusive notice). There is
  // NO account-exists branch: signup with an existing email is silent (issue
  // #148) — the backend responds like a fresh signup and emails the owner.
  const applyEnrollmentError = (err: unknown): boolean => {
    const reason = enrollmentErrorReason(err);
    if (reason === 'profile-exists') {
      setError(t('enrollment.alreadyInFamily'));
      return true;
    }
    if (reason === 'role-exclusive') {
      // A signed-in provider (babysitter/tutor) followed a family invite —
      // provider and parent roles are mutually exclusive (issue #116).
      setError(t('enrollment.roleExclusiveJoin'));
      return true;
    }
    return false;
  };

  // Authed add-profile confirm: the user is already signed in but has no parent
  // profile. Join with the token alone (no credentials), refresh the user doc so
  // profiles.parent is present, then navigate to the family dashboard.
  const handleConfirmJoin = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const joinFamilyFn = httpsCallable(functions, 'joinFamily');
      await joinFamilyFn({ token });
      await refreshUserDoc();
      navigate('/family');
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to join family');
      }
      setSubmitting(false);
    }
  };

  const handleSendCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      // `app` only selects the copy of the silent account-exists email.
      await verifyEmail({ email, app: 'sit' });
      armedWithRef.current = resendCooldownS;
      setResendCooldown(resendCooldownS);
      setStep(1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send verification code';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    armedWithRef.current = resendCooldownS;
    setResendCooldown(resendCooldownS);
    setResendCount((c) => c + 1);
    setCodeVerified(false);
    setVerificationCode('');
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      await verifyEmail({ email, app: 'sit' });
    } catch {
      // silent
    }
  };

  const handleComplete = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const joinFamilyFn = httpsCallable(functions, 'joinFamily');
      await joinFamilyFn({
        token,
        email: email.toLowerCase(),
        verificationCode,
        password,
        firstName,
        lastName,
      });

      // Fresh, deliberate sign-in: capture the session epoch anew (issue #181).
      markNextSignInFresh();
      await signInWithEmailAndPassword(auth, email, password);

      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) { unsub(); resolve(); }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) { unsub(); resolve(); }
      });

      navigate('/family');
    } catch (err: unknown) {
      if (!applyEnrollmentError(err)) {
        setError(err instanceof Error ? err.message : 'Failed to join family');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Wait for auth resolution before deciding which view to render: this keeps
  // the authed-confirm vs. credential-wizard decision from being made against a
  // not-yet-known auth state.
  if (authLoading) return null;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (invalidToken) {
    return (
      <div>
        <TopNav title="Join Family" backTo="/" />
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-3xl">❌</div>
          <h2 className="mb-2 text-xl font-bold">Invalid invite link</h2>
          <p className="mb-6 text-sm text-gray-500">
            This invite link is invalid, expired, or has already been used.
          </p>
          <Button onClick={() => navigate('/')}>Go to home</Button>
        </div>
      </div>
    );
  }

  // Authed with a parent profile already: nothing to join here.
  if (firebaseUser && getParentProfile(userDoc)) {
    return (
      <div>
        <TopNav title="Join Family" backTo="/" />
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <h2 className="mb-6 text-xl font-bold">{t('enrollment.alreadyInFamily')}</h2>
          <Link
            to="/family"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-6 font-semibold text-white"
          >
            Go to my family
          </Link>
        </div>
      </div>
    );
  }

  // Authed without a parent profile: skip the credential steps and offer a
  // single confirm button that joins with the token alone.
  if (firebaseUser) {
    return (
      <div>
        <TopNav title="Join Family" backTo="/" />
        <div className="px-6 py-8">
          <h2 className="mb-2 text-xl font-bold">Join the {familyName} family</h2>
          <p className="mb-8 text-sm text-gray-500">
            You've been invited to join as a parent.
          </p>
          {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}
          <Button onClick={handleConfirmJoin} disabled={submitting}>
            {submitting ? 'Joining...' : t('enrollment.joinFamilyConfirm', { familyName })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav
        title="Join Family"
        backTo={step === 0 ? '/' : undefined}
        rightAction={
          step > 0 && step < 2 ? (
            <button onClick={() => setStep(step - 1)} className="text-sm font-medium text-gray-500">
              Back
            </button>
          ) : undefined
        }
      />
      <StepIndicator totalSteps={3} currentStep={step} />

      {/* Step 0: Email */}
      {step === 0 && (
        <div className="px-6">
          <h2 className="mb-2 text-xl font-bold">Join the {familyName} family</h2>
          <p className="mb-8 text-sm text-gray-500">
            You've been invited to join as a parent. Enter your email to get started.
          </p>
          <Input
            label="Email address *"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            placeholder="your@email.com"
            error={error ?? undefined}
            required
          />
          <Button onClick={handleSendCode} disabled={submitting || !email}>
            {submitting ? 'Sending...' : 'Send verification code'}
          </Button>
        </div>
      )}

      {/* Step 1: Verify + Password */}
      {step === 1 && (
        <div className="px-6">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <MailIcon className="h-7 w-7 text-brand-600" />
            </div>
            <h2 className="mb-2 text-xl font-bold">Check your email</h2>
            <p className="mb-8 text-sm text-gray-500">
              We sent a 6-digit code to <strong className="text-gray-950">{email}</strong>
            </p>
            <CodeInput
              key={resendCount}
              onComplete={(code) => { setVerificationCode(code); setCodeVerified(true); }}
              error={error ?? undefined}
            />
            <p className="mt-4 text-sm text-gray-500">
              Didn't receive it?{' '}
              {resendCooldown > 0 ? (
                <span className="text-brand-600">Resend in {resendCooldown}s</span>
              ) : (
                <button type="button" onClick={handleResend} className="font-medium text-brand-600 hover:underline">
                  Resend code
                </button>
              )}
            </p>
            {/* Always rendered, on BOTH the fresh and silent existing-account
                paths (issue #148) — a static, non-distinguishing exit for
                users whose account already exists and never get a code. */}
            <p className="mt-2 text-sm text-gray-500">
              <Trans
                i18nKey="enrollment.verifyNoCodeHint"
                components={{
                  loginLink: <Link to="/login" className="font-medium text-brand-600 hover:underline" />,
                }}
              />
            </p>
          </div>

          {codeVerified && (
            <div className="border-t border-gray-200 pt-6">
              <h3 className="mb-4 text-lg font-semibold">Create your password</h3>
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                error={password && password.length < 8 ? 'Password must be at least 8 characters' : undefined}
              />
              <Input
                label="Confirm password"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Re-enter your password"
                error={passwordConfirm && password !== passwordConfirm ? "Passwords don't match" : undefined}
              />
              <Button
                onClick={() => setStep(2)}
                disabled={password.length < 8 || password !== passwordConfirm}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Name */}
      {step === 2 && (
        <div className="px-6">
          <h2 className="mb-2 text-xl font-bold">About you</h2>
          <p className="mb-6 text-sm text-gray-500">
            Tell us your name so the family can identify you.
          </p>
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label="First name *"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="flex-1">
              <Input
                label="Last name *"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

          <Button
            onClick={handleComplete}
            disabled={submitting || !firstName.trim() || !lastName.trim()}
          >
            {submitting ? 'Joining...' : `Join the ${familyName} family`}
          </Button>
        </div>
      )}
    </div>
  );
}
