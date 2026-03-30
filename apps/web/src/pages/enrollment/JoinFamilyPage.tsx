import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth, db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, TopNav, StepIndicator, Spinner } from '@/components/ui';
import { MailIcon } from '@/components/ui/Icons';
import { CodeInput } from '@/components/forms/CodeInput';

export function JoinFamilyPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

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
  const [resendCount, setResendCount] = useState(0);

  // Validate invite token on mount
  useEffect(() => {
    if (!token) { setInvalidToken(true); setLoading(false); return; }
    async function validate() {
      try {
        const inviteSnap = await getDoc(doc(db, 'inviteLinks', token!));
        if (!inviteSnap.exists()) { setInvalidToken(true); setLoading(false); return; }
        const invite = inviteSnap.data();
        if (invite.used) { setInvalidToken(true); setLoading(false); return; }
        const expiresAt = invite.expiresAt?.toDate?.();
        if (expiresAt && expiresAt < new Date()) { setInvalidToken(true); setLoading(false); return; }

        // Read family name from the invite doc (denormalized)
        setFamilyName(invite.familyName || 'your family');
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

  const handleSendCode = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      await verifyEmail({ email });
      setResendCooldown(60);
      setStep(1);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResendCooldown(60);
    setResendCount((c) => c + 1);
    setCodeVerified(false);
    setVerificationCode('');
    try {
      const verifyEmail = httpsCallable(functions, 'verifyParentEmail');
      await verifyEmail({ email });
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

      await signInWithEmailAndPassword(auth, email, password);

      await new Promise<void>((resolve) => {
        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading && state.userDoc) { unsub(); resolve(); }
        });
        const current = useAuthStore.getState();
        if (!current.loading && current.userDoc) { unsub(); resolve(); }
      });

      navigate('/family');
    } catch (err: any) {
      setError(err.message || 'Failed to join family');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-red-600" />
      </div>
    );
  }

  if (invalidToken) {
    return (
      <div>
        <TopNav title="Join Family" backTo="/" />
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-3xl">❌</div>
          <h2 className="mb-2 text-xl font-bold">Invalid invite link</h2>
          <p className="mb-6 text-sm text-gray-500">
            This invite link is invalid, expired, or has already been used.
          </p>
          <Button onClick={() => navigate('/')}>Go to home</Button>
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
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
              <MailIcon className="h-7 w-7 text-red-600" />
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
                <span className="text-red-600">Resend in {resendCooldown}s</span>
              ) : (
                <button type="button" onClick={handleResend} className="font-medium text-red-600 hover:underline">
                  Resend code
                </button>
              )}
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

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
