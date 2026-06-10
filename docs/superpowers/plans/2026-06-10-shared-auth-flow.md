# Shared Auth Flow (Step Components → shared-ui) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the three identical pre-account-creation enrollment steps (`StepEmail`, `StepVerify`, `StepPassword`) out of `apps/web/src/pages/enrollment/babysitter/` and `apps/study-web/src/pages/enrollment/tutor/` and into `@ejm/shared-ui/enrollment/*`. Both apps consume the shared components; orchestrators stay app-specific. Closes the visible duplication that surfaced in PR #57's hand-aligned fixes (welcome/login/signup/step-email all needed to be re-done page-by-page).

**Architecture:** New `packages/shared-ui/src/enrollment/` subfolder holds three components with a unified prop interface — callback-based, no app-specific Firestore/functions imports inside the components. Each orchestrator (`BabysitterEnrollment.tsx` in `apps/web`, `TutorEnrollment.tsx` in `apps/study-web`) wraps the callable invocations and passes `onSubmit` / `onResend` handlers as props. This is a pure refactor — no behavior change for either app. Portable-user-entity work (`profiles.{sit,study}` schema, cross-app skip) is a follow-up plan that builds on this one.

**Tech Stack:** TypeScript, React 19, react-i18next, Firebase Functions Web SDK, Tailwind v4 + shared-ui theme, Vitest.

---

## File structure

**New files:**
- `packages/shared-ui/src/enrollment/StepVerify.tsx`
- `packages/shared-ui/src/enrollment/StepPassword.tsx`
- `packages/shared-ui/src/enrollment/StepEmail.tsx`
- `packages/shared-ui/src/enrollment/index.ts` — barrel
- `packages/shared-ui/src/index.ts` — add `export * from './enrollment/index.js'`

**Modified files:**
- `apps/web/src/pages/enrollment/BabysitterEnrollment.tsx` — switch to shared step imports; wrap the previously-internal calls with `onSubmit`/`onResend` callbacks. Local helpers stay (form-data shape) but the email/verify/password rows now go through shared components.
- `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx` — same switch as sync-sit.

**Deleted files (after migration):**
- `apps/web/src/pages/enrollment/babysitter/StepEmail.tsx`
- `apps/web/src/pages/enrollment/babysitter/StepVerify.tsx`
- `apps/web/src/pages/enrollment/babysitter/StepPassword.tsx`
- `apps/study-web/src/pages/enrollment/tutor/StepEmail.tsx`
- `apps/study-web/src/pages/enrollment/tutor/StepVerify.tsx`
- `apps/study-web/src/pages/enrollment/tutor/StepPassword.tsx`

**NOT touched:**
- `apps/web/src/pages/enrollment/babysitter/StepProfile.tsx` and `StepPreferences.tsx` — babysitter-specific fields (kid age range, hourly rate, area). Stay local.
- `apps/study-web/src/pages/enrollment/tutor/StepProfile.tsx` and `StepPrefs.tsx` — tutor-specific fields (session lengths, padding). Stay local.
- Any callable file under `apps/functions/` or `apps/study-functions/` — wire format unchanged.
- `firestore.rules`, `firestore.indexes.json`, deploy bundling scripts.

---

## Unified prop interfaces

Each shared step takes ONLY the data + callbacks it needs to render and emit an event. No app-specific imports inside the components.

```typescript
// StepEmail
interface StepEmailProps {
  ejemEmail: string;
  onChange: (email: string) => void;
  onSubmit: () => Promise<void>;     // orchestrator calls verifyEjmEmail
  loading: boolean;
  error: string | null;
  isInvite?: boolean;                // default false; sync-sit flag — relaxes EJM domain check + uses 'your@email.com' placeholder
}

// StepVerify
interface StepVerifyProps {
  ejemEmail: string;
  onVerify: (code: string) => Promise<void>;  // orchestrator calls verifyCode; throws on bad code
  onResend: () => Promise<void>;              // orchestrator calls verifyEjmEmail again
  error: string | null;                       // surfaced from previous step (e.g. resend failure)
}

// StepPassword
interface StepPasswordProps {
  onSubmit: (password: string, consentVersion: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}
```

**Why callbacks instead of importing `firebase/functions`:** keeps `@ejm/shared-ui` free of any Firebase dependency in this layer, lets each app choose which callable name to invoke (`verifyCode` vs a future variant), and makes the components straightforward to test with stubs.

---

## Background — read first

- The two existing `StepVerify` files are already nearly identical. Diff them once: `diff apps/web/src/pages/enrollment/babysitter/StepVerify.tsx apps/study-web/src/pages/enrollment/tutor/StepVerify.tsx` — the only differences are the import path for `functions` and `MailIcon`, and the emoji-vs-SVG envelope.
- `apps/web` `StepPassword` exposes `onCreateAccount` (it currently creates the babysitter account mid-flow). `apps/study-web` `StepPassword` exposes `onNext` (it stores the password locally and creates the tutor account at the end). Both shapes collapse to `onSubmit(password, consentVersion)`; the orchestrator decides what `onSubmit` means.
- `apps/web` `StepEmail` takes a full `BabysitterFormData` plus a partial `onChange`. This is over-coupled. Unify on `{ ejemEmail, onChange(email), onSubmit, ... }` — `apps/web`'s orchestrator wraps the partial onChange in a one-liner adapter inside its `renderStep` case.
- The `MailIcon` in shared-ui (`packages/shared-ui/src/components/Icons.tsx`) is already exported; both apps' `StepVerify` will use it directly from shared-ui.
- All i18n keys the shared components reference exist with matching values in both apps' locale files after PR #57. Specifically: `enrollment.verifySchool`, `enrollment.verifySchoolDesc`, `enrollment.ejemEmailLabel`, `enrollment.ejemEmailHint`, `enrollment.emailLabel`, `auth.sending`, `auth.sendCode`, `auth.checkEmail`, `auth.codeSentTo`, `auth.didntReceive`, `auth.resendIn`, `auth.resendCode`, `auth.verifying`, `auth.invalidCode`. Verify with `grep -E "verifySchool|sendCode|codeSentTo" apps/web/src/i18n/en.ts apps/study-web/src/i18n/en.ts` before starting.

---

## Task 1: Extract StepVerify into shared-ui

**Files:**
- Create: `packages/shared-ui/src/enrollment/StepVerify.tsx`
- Create: `packages/shared-ui/src/enrollment/index.ts`
- Modify: `packages/shared-ui/src/index.ts`

- [ ] **Step 1: Create the shared StepVerify component**

Create `packages/shared-ui/src/enrollment/StepVerify.tsx` verbatim with:

```tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MailIcon } from '../components/Icons.js';
import { CodeInput } from '../forms/CodeInput.js';

interface StepVerifyProps {
  ejemEmail: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  error: string | null;
}

export function StepVerify({ ejemEmail, onVerify, onResend, error }: StepVerifyProps) {
  const { t } = useTranslation();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [resendCount, setResendCount] = useState(0);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleCodeComplete = async (code: string) => {
    setCodeError(null);
    setVerifying(true);
    try {
      await onVerify(code);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('auth.invalidCode');
      setCodeError(message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setResendCooldown(60);
    setResendCount((c) => c + 1);
    setCodeError(null);
    try {
      await onResend();
    } catch { /* silent — surface via error prop if orchestrator wants */ }
  };

  return (
    <div className="px-6 text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
        <MailIcon className="h-7 w-7 text-red-600" />
      </div>
      <h2 className="mb-2 text-xl font-bold">{t('auth.checkEmail')}</h2>
      <p className="mb-8 text-sm text-gray-500">
        {t('auth.codeSentTo')}
        <br />
        <strong className="text-gray-950">{ejemEmail}</strong>
      </p>

      <CodeInput
        key={resendCount}
        onComplete={handleCodeComplete}
        error={codeError ?? error ?? undefined}
      />

      {verifying && (
        <p className="mt-3 text-sm text-gray-500">{t('auth.verifying')}</p>
      )}

      <p className="mt-4 text-sm text-gray-500">
        {t('auth.didntReceive')}{' '}
        {resendCooldown > 0 ? (
          <span className="text-red-600">{t('auth.resendIn', { seconds: resendCooldown })}</span>
        ) : (
          <button type="button" onClick={handleResend} className="font-medium text-red-600 hover:underline">
            {t('auth.resendCode')}
          </button>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Create the enrollment barrel**

Create `packages/shared-ui/src/enrollment/index.ts`:

```typescript
export { StepVerify } from './StepVerify.js';
```

- [ ] **Step 3: Re-export from root barrel**

Append to `packages/shared-ui/src/index.ts`:

```typescript
export * from './enrollment/index.js';
```

- [ ] **Step 4: Build + typecheck shared-ui**

Run:
```bash
pnpm --filter @ejm/shared-ui build  # if a build script exists; otherwise:
pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/src/enrollment/StepVerify.tsx \
        packages/shared-ui/src/enrollment/index.ts \
        packages/shared-ui/src/index.ts
git commit -m "feat(shared-ui): extract StepVerify enrollment component

Lifts the post-email-send code-verification step out of the two app-
specific implementations (apps/web/src/pages/enrollment/babysitter/
and apps/study-web/src/pages/enrollment/tutor/) into shared-ui. Both
apps will import { StepVerify } from '@ejm/shared-ui'. Prop interface
is callback-based — orchestrator wraps the verifyCode + resend
callable invocations. Component itself has zero Firebase dependency."
```

---

## Task 2: Extract StepPassword into shared-ui

**Files:**
- Create: `packages/shared-ui/src/enrollment/StepPassword.tsx`
- Modify: `packages/shared-ui/src/enrollment/index.ts`

- [ ] **Step 1: Create the shared StepPassword component**

Create `packages/shared-ui/src/enrollment/StepPassword.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { checkPasswordRequirements } from '@ejm/shared';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';

interface StepPasswordProps {
  onSubmit: (password: string, consentVersion: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

function Req({ met, label }: { met: boolean; label: string }) {
  return (
    <p className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}>
      <span>{met ? '✓' : '○'}</span> {label}
    </p>
  );
}

const CONSENT_VERSION = '2025-12-01';

export function StepPassword({ onSubmit, loading, error }: StepPasswordProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [consent, setConsent] = useState(false);

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = reqs.minLength && reqs.hasLetter && reqs.hasNumber;
  const passwordsMatch = password === passwordConfirm && password.length > 0;
  const canSubmit = allReqsMet && passwordsMatch && consent && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit(password, CONSENT_VERSION);
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mb-2 text-xl font-bold">{t('auth.createPassword')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('auth.createPasswordDesc')}</p>

      <Input
        label={t('common.password')}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
      />

      <div className="mb-5 space-y-1.5">
        <Req met={reqs.minLength} label={t('auth.req8Chars')} />
        <Req met={reqs.hasLetter} label={t('auth.reqLetter')} />
        <Req met={reqs.hasNumber} label={t('auth.reqNumber')} />
      </div>

      <Input
        label={t('auth.confirmPassword')}
        type="password"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        error={passwordConfirm.length > 0 && !passwordsMatch ? t('auth.passwordsDontMatch') : undefined}
        autoComplete="new-password"
        required
      />

      <label className="mb-6 flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300"
        />
        <span>
          {t('auth.consentText')}{' '}
          <Link to="/terms" className="text-red-600 hover:underline">{t('auth.terms')}</Link>
          {' '}{t('auth.consentAnd')}{' '}
          <Link to="/privacy" className="text-red-600 hover:underline">{t('auth.privacy')}</Link>
        </span>
      </label>

      {error && <p className="mb-4 text-sm text-error-600">{error}</p>}

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('common.loading') : t('common.continue')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Add to barrel**

Update `packages/shared-ui/src/enrollment/index.ts`:

```typescript
export { StepVerify } from './StepVerify.js';
export { StepPassword } from './StepPassword.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/enrollment/StepPassword.tsx \
        packages/shared-ui/src/enrollment/index.ts
git commit -m "feat(shared-ui): extract StepPassword enrollment component

Same shape in both apps post-extraction. Consent version is hard-
coded as '2025-12-01' in the shared component — both apps used this
value at the time of extraction. When consent version bumps, change
it here in one place. Uses error-600 color token (PR #57) for the
inline error so error styling stays red regardless of brand palette."
```

---

## Task 3: Extract StepEmail into shared-ui

**Files:**
- Create: `packages/shared-ui/src/enrollment/StepEmail.tsx`
- Modify: `packages/shared-ui/src/enrollment/index.ts`

- [ ] **Step 1: Create the shared StepEmail component**

Create `packages/shared-ui/src/enrollment/StepEmail.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { validateEjmEmail } from '@ejm/shared';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { InfoBanner } from '../components/InfoBanner.js';

interface StepEmailProps {
  ejemEmail: string;
  onChange: (email: string) => void;
  onSubmit: () => Promise<void>;
  loading: boolean;
  error: string | null;
  /**
   * When true, relax EJM domain validation (invite-link flow). Sync-sit
   * sets this from a `?invite=true` query param via its orchestrator.
   */
  isInvite?: boolean;
  /**
   * Optional logo to render centered above the title. When omitted, the
   * logo block is not rendered. Each app passes its own /logo.png so the
   * shared component stays brand-agnostic.
   */
  logoSrc?: string;
  logoAlt?: string;
}

export function StepEmail({
  ejemEmail,
  onChange,
  onSubmit,
  loading,
  error,
  isInvite = false,
  logoSrc,
  logoAlt,
}: StepEmailProps) {
  const { t } = useTranslation();

  const email = ejemEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = emailRegex.test(email);
  const ejmValidation = !isInvite && email ? validateEjmEmail(email) : null;

  let validationError: string | undefined;
  if (email && !isValidEmail) {
    validationError = t('validation.validEmail');
  } else if (ejmValidation && !ejmValidation.valid) {
    validationError = ejmValidation.error;
  }

  const displayError =
    error === 'Must be logged in' || error === 'UNAUTHENTICATED'
      ? t('enrollment.serverError')
      : error;

  const canSubmit =
    isValidEmail && (isInvite || ejmValidation?.valid === true) && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) await onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      {logoSrc && (
        <div className="mb-6 flex justify-center">
          <img src={logoSrc} alt={logoAlt ?? 'logo'} className="h-20 w-20 rounded-2xl object-cover" />
        </div>
      )}
      <h2 className="mb-2 text-xl font-bold">{t('enrollment.verifySchool')}</h2>
      <p className="mb-8 text-sm leading-relaxed text-gray-500">
        {t('enrollment.verifySchoolDesc')}
      </p>

      <Input
        label={isInvite ? t('enrollment.emailLabel') : t('enrollment.ejemEmailLabel')}
        type="email"
        value={ejemEmail}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isInvite ? 'your@email.com' : 'name@ejm.org'}
        error={validationError || displayError || undefined}
        required
      />

      {!isInvite && (
        <InfoBanner className="mb-6">
          {t('enrollment.ejemEmailHint')}
        </InfoBanner>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {loading ? t('auth.sending') : t('auth.sendCode')}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Add to barrel**

Update `packages/shared-ui/src/enrollment/index.ts`:

```typescript
export { StepVerify } from './StepVerify.js';
export { StepPassword } from './StepPassword.js';
export { StepEmail } from './StepEmail.js';
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/enrollment/StepEmail.tsx \
        packages/shared-ui/src/enrollment/index.ts
git commit -m "feat(shared-ui): extract StepEmail enrollment component

Generalizes the form-data-coupled prop shape sync-sit used into a
simple { ejemEmail, onChange(string), onSubmit, ... } interface. The
isInvite flag carries the babysitter invite-link branch (relaxes EJM
domain validation, switches placeholder to your@email.com). Logo is
prop-driven (logoSrc/logoAlt) so the shared component stays brand-
agnostic — each app passes its own /logo.png."
```

---

## Task 4: Migrate sync-sit BabysitterEnrollment to shared steps

**Files:**
- Modify: `apps/web/src/pages/enrollment/BabysitterEnrollment.tsx`

- [ ] **Step 1: Swap imports**

In `apps/web/src/pages/enrollment/BabysitterEnrollment.tsx`, replace these three lines:

```typescript
import { StepEmail } from './babysitter/StepEmail';
import { StepVerify } from './babysitter/StepVerify';
import { StepPassword } from './babysitter/StepPassword';
```

with one line:

```typescript
import { StepEmail, StepVerify, StepPassword } from '@ejm/shared-ui';
```

- [ ] **Step 2: Rewrite the three step cases in renderStep()**

Replace the existing `case 0:` (StepEmail), `case 1:` (StepVerify), `case 2:` (StepPassword) blocks with these adapter wrappers that translate the orchestrator's existing state into the shared components' callback shape:

```tsx
case 0:
  return (
    <StepEmail
      ejemEmail={ejemEmail}
      onChange={(email) => setEjemEmail(email)}
      onSubmit={handleSendCode}
      loading={loading}
      error={error}
      isInvite={isInvite}
      logoSrc="/logo.png"
      logoAlt="Sync/Sit"
    />
  );
case 1:
  return (
    <StepVerify
      ejemEmail={ejemEmail}
      onVerify={async (code) => {
        const verifyFn = httpsCallable(functions, 'verifyCode');
        await verifyFn({ email: ejemEmail, code });
        handleCodeVerified(code);
      }}
      onResend={async () => {
        const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
        await verifyEjmEmail({ email: ejemEmail });
      }}
      error={error}
    />
  );
case 2:
  return (
    <StepPassword
      onSubmit={async (password, consentVersion) => {
        await handleCreateAccount(password, consentVersion);
      }}
      loading={loading}
      error={error}
    />
  );
```

The orchestrator may need an `isInvite` value — that already exists in the babysitter file (read from `useSearchParams()`). If your local file doesn't surface it at orchestrator level (it may currently be inside the deleted `StepEmail`), lift it: add `const [searchParams] = useSearchParams();` and `const isInvite = searchParams.get('invite') === 'true';` at the top of the component.

- [ ] **Step 3: Drop the `formDataForEmail` adapter object**

The orchestrator currently builds a fake `formDataForEmail` blob to feed the old StepEmail's full-form-data prop. With the shared StepEmail accepting just `ejemEmail`, that adapter is dead. Remove the `formDataForEmail` const entirely.

- [ ] **Step 4: Verify typecheck + build**

```bash
pnpm --filter @ejm/shared-ui build
pnpm --filter web typecheck
pnpm --filter web build
```
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/enrollment/BabysitterEnrollment.tsx
git commit -m "refactor(web): consume shared StepEmail/Verify/Password in babysitter enrollment

Drops the three duplicated step files for the pre-account-creation
phase of babysitter enrollment. Sources from @ejm/shared-ui. The
orchestrator now wraps the verifyEjmEmail / verifyCode / enrollBabysitter
callables in async handlers passed as onSubmit / onVerify / onResend
props. No behavior change — same callables, same payload, same
post-step navigation."
```

---

## Task 5: Migrate sync-study TutorEnrollment to shared steps

**Files:**
- Modify: `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx`

- [ ] **Step 1: Swap imports**

In `apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx`, replace these three lines:

```typescript
import { StepEmail } from './StepEmail';
import { StepVerify } from './StepVerify';
import { StepPassword } from './StepPassword';
```

with:

```typescript
import { StepEmail, StepVerify, StepPassword } from '@ejm/shared-ui';
```

- [ ] **Step 2: Rewrite the three step cases**

Replace the existing `case 0:`, `case 1:`, `case 2:` blocks in `renderStep()`:

```tsx
case 0:
  return (
    <StepEmail
      ejemEmail={ejemEmail}
      onChange={(email) => setEjemEmail(email)}
      onSubmit={handleSendCode}
      loading={loading}
      error={error}
      logoSrc="/logo.png"
      logoAlt="Sync/Study"
    />
  );
case 1:
  return (
    <StepVerify
      ejemEmail={ejemEmail}
      onVerify={async (code) => {
        const verifyFn = httpsCallable(functions, 'verifyCode');
        await verifyFn({ email: ejemEmail, code });
        handleCodeVerified(code);
      }}
      onResend={async () => {
        const verifyEjmEmail = httpsCallable(functions, 'verifyEjmEmail');
        await verifyEjmEmail({ email: ejemEmail });
      }}
      error={error}
    />
  );
case 2:
  return (
    <StepPassword
      onSubmit={async (password, _consentVersion) => {
        handlePasswordNext(password);
      }}
      loading={loading}
      error={error}
    />
  );
```

Note: tutor's `handlePasswordNext` does NOT call a server callable — it just stores the password locally because tutor's account creation happens at the end via `enrollTutor`. That's why the consentVersion argument is unused here. (Future portable-user-entity work may consume it.)

- [ ] **Step 3: Verify typecheck + build**

```bash
pnpm --filter @ejm/shared-ui build
pnpm --filter study-web typecheck
pnpm --filter study-web build
```
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/study-web/src/pages/enrollment/tutor/TutorEnrollment.tsx
git commit -m "refactor(study-web): consume shared StepEmail/Verify/Password in tutor enrollment

Mirrors sync-sit's migration in the previous commit. Tutor enrollment
now sources Email/Verify/Password from @ejm/shared-ui; orchestrator
keeps the verifyEjmEmail + verifyCode callable invocations local.
Password step still just stores locally (no callable until prefs step
creates the tutor via enrollTutor). consentVersion is ignored at this
step; portable-user-entity follow-up will wire it through."
```

---

## Task 6: Delete the now-dead app-local step files + smoke test

**Files:**
- Delete: `apps/web/src/pages/enrollment/babysitter/StepEmail.tsx`
- Delete: `apps/web/src/pages/enrollment/babysitter/StepVerify.tsx`
- Delete: `apps/web/src/pages/enrollment/babysitter/StepPassword.tsx`
- Delete: `apps/study-web/src/pages/enrollment/tutor/StepEmail.tsx`
- Delete: `apps/study-web/src/pages/enrollment/tutor/StepVerify.tsx`
- Delete: `apps/study-web/src/pages/enrollment/tutor/StepPassword.tsx`

- [ ] **Step 1: Confirm no stragglers**

```bash
grep -rn "from.*babysitter/StepEmail\|from.*babysitter/StepVerify\|from.*babysitter/StepPassword" apps/
grep -rn "from.*tutor/StepEmail\|from.*tutor/StepVerify\|from.*tutor/StepPassword" apps/
```
Expected: zero matches in each.

- [ ] **Step 2: Delete the six files**

```bash
rm apps/web/src/pages/enrollment/babysitter/StepEmail.tsx \
   apps/web/src/pages/enrollment/babysitter/StepVerify.tsx \
   apps/web/src/pages/enrollment/babysitter/StepPassword.tsx \
   apps/study-web/src/pages/enrollment/tutor/StepEmail.tsx \
   apps/study-web/src/pages/enrollment/tutor/StepVerify.tsx \
   apps/study-web/src/pages/enrollment/tutor/StepPassword.tsx
```

- [ ] **Step 3: Final clean-sweep verification**

```bash
pnpm typecheck
pnpm -r lint
pnpm --filter web build
pnpm --filter study-web build
```
Expected: typecheck clean across all 9 workspaces; lint 0 errors (existing 7 warnings unchanged); both web builds clean.

- [ ] **Step 4: Emulator smoke (manual — optional but recommended)**

Start the dev environment per `docs/sync-study-status-2026-05-20.md` or the README:

```bash
pnpm emulators       # terminal 1 — both codebases load
node apps/functions/seed-test-data.cjs  # terminal 2
pnpm --filter web dev          # terminal 3 — sync-sit on 5173
pnpm --filter study-web dev    # terminal 4 — sync-study on 5174/5175
```

For sync-sit (`http://localhost:5173/enroll/babysitter`):
- Reach Step Email (logo + EJM hint banner render).
- Submit a fresh `@ejm.org` email ending in a valid graduation year.
- Reach Step Verify (envelope SVG icon renders, code input row).
- Enter the code from `verificationCodes/{email}` Firestore doc.
- Reach Step Password — fill, accept consent, submit.
- Confirm Step Profile renders (this is babysitter-local, unchanged).

For sync-study (`http://localhost:5174/enroll/tutor` or whichever port Vite picked):
- Same path. Steps 0-2 should look identical to sync-sit, just with the sync-study logo on Step Email.
- Reach Step Profile (sync-study-local; unchanged).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete duplicated enrollment step files

Removes the six dead step files (StepEmail, StepVerify, StepPassword
in each of apps/web/.../babysitter/ and apps/study-web/.../tutor/).
Their behavior is now provided by @ejm/shared-ui's enrollment barrel.
Verified clean: typecheck + lint across all workspaces; both web
builds; emulator smoke walked both flows through Step Profile."
```

---

## Final verification (after all 6 tasks)

- [ ] **Run the full check suite**

```bash
pnpm -r --filter './packages/**' build
pnpm typecheck
pnpm -r lint
pnpm --filter web build
pnpm --filter study-web build
pnpm --filter functions build
pnpm --filter study-functions build
```

Expected outcomes:
- typecheck: clean across all 9 packages
- lint: 0 errors (7 pre-existing apps/web warnings unchanged)
- all builds: clean
- emulator smoke: both enrollment flows reach their respective Step Profile correctly

- [ ] **Push branch and open PR**

```bash
git push -u origin feature/shared-auth-flow
gh pr create --title "Shared auth-flow step components (sync-sit + sync-study)" --body "..."
```

PR body should:
- Reference PR #57 as the prerequisite (introduced the error-600 token + theme palette this refactor relies on).
- Call out that this is a refactor — no behavior change — and that the portable-user-entity follow-up (`profiles.{sit,study}` schema + cross-app skip) is a separate plan that builds on this.
- List the 6 deleted files and the 3 added shared-ui files.
- Note: smoke testing covered Email → Verify → Password → Profile transitions in both apps against the same emulator.

---

## Self-review notes

- **Spec coverage:** the spec was "lift shared step components into shared-ui." Tasks 1-3 create them; tasks 4-5 migrate consumers; task 6 cleans up. ✓
- **Portable user entity / cross-app skip:** explicitly out of scope; named in the doc header and the final task's PR body. Follow-up plan. ✓
- **No placeholders:** the only `...` is in the `gh pr create --body` invocation, which the engineer writes at PR-open time. Every code block in a step is complete. ✓
- **Type consistency:** prop names — `onSubmit` / `onVerify` / `onResend` — match across all three components' definitions and their orchestrator wrappers. ✓
- **One known prop-rename caveat:** sync-sit's old `StepPassword` exposed `onCreateAccount`, sync-study's exposed `onNext`. Both become `onSubmit` in the shared component. Task 4 and Task 5 step bodies show the orchestrator wrapper that bridges to each app's existing `handleCreateAccount` / `handlePasswordNext`. No `handleCreateAccount` etc. names are renamed in the orchestrator — only the prop the StepPassword expects. ✓

Out of scope (deferred to a follow-up plan):
- `profiles.{sit,study}` schema in `users/{uid}` docs.
- `enrollBabysitter` and `enrollTutor` callable updates to write under `profiles.{app}`.
- Cross-app login: detect existing user → skip Email/Verify/Password → route to app-specific profile/preferences.
- Migration of existing production user docs from top-level `role` to `profiles.{app}.role`.
