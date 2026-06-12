# Shared Public Auth Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `WelcomePage`, `LoginPage`, `SignUpRolePage`, `ForgotPasswordPage` from each app into `@ejm/shared-ui/pages/` as shared components. Each app's router renders a thin wrapper that injects per-app auth/role bindings as props. Closes the largest remaining "two files, one design" duplication in the public surface.

**Architecture:** Shared components take handlers + data as props — they never import an app-specific `useAuthStore` or hard-code role→path routing. Per-app wrappers (one each in `apps/web/src/pages/public/` and `apps/study-web/src/pages/public/`) read their own `useAuthStore`, compute the post-login redirect path from the user's role, and pass everything down. After Plan D (portable user entity) lands, only the wrappers change — the shared components don't.

**Tech Stack:** TypeScript, React 19, react-i18next, react-router v7, Tailwind v4 + shared-ui theme.

---

## File structure

**New shared components:**
- `packages/shared-ui/src/pages/WelcomePage.tsx`
- `packages/shared-ui/src/pages/LoginPage.tsx`
- `packages/shared-ui/src/pages/SignUpRolePage.tsx`
- `packages/shared-ui/src/pages/ForgotPasswordPage.tsx`

**Modified:**
- `packages/shared-ui/src/pages/index.ts` — barrel exports add the four new pages
- `apps/web/src/pages/public/{WelcomePage,LoginPage,SignUpRolePage,ForgotPasswordPage}.tsx` — REWRITE to thin wrappers (~10–20 lines each) that import the shared component and inject sync-sit's auth bindings + role list
- `apps/study-web/src/pages/public/{WelcomePage,LoginPage,SignUpRolePage}.tsx` — same rewrite for sync-study
- `apps/study-web/src/pages/public/ForgotPasswordPage.tsx` — NEW thin wrapper (file doesn't exist yet on sync-study)
- `apps/study-web/src/router.tsx` — replace `/forgot-password` `StaticPage` stub with real `ForgotPasswordPage`
- `apps/web/src/i18n/en.ts` + `fr.ts` — add `auth.forgotPasswordTitle`, `auth.forgotPasswordHeading`, `auth.forgotPasswordDesc`, `auth.checkEmailHeading`, `auth.checkEmailDesc`, `auth.checkEmailHint`, `auth.sendResetLink` keys (currently hard-coded English in sync-sit's ForgotPasswordPage)
- `apps/study-web/src/i18n/en.ts` + `fr.ts` — add the same forgotPassword keys

**NOT touched:**
- `useAuthStore` files in either app — only consumed by the new wrappers.
- Any callable or Firestore code.
- `/enroll/parent` — still a `StaticPage` stub on sync-study (out of scope).
- Plan D schema work — `userDoc.role` typing stays as-is for this PR.

---

## Shared component prop interfaces

### WelcomePage

```typescript
interface WelcomePageProps {
  /** Logo image source, e.g. "/logo.png" */
  logoSrc: string;
  /** Alt text — defaults to t('welcome.title') if omitted */
  logoAlt?: string;
  /** When set, redirects to this path on mount if userDoc indicates a logged-in user.
   *  Caller computes the path; null/undefined = no redirect. */
  redirectPath?: string | null;
  /** True while caller's auth store is still loading initial state. */
  authLoading?: boolean;
}
```

The per-app wrapper subscribes to its own authStore and computes redirectPath as a side effect; the component just renders + navigates when redirectPath is set.

### LoginPage

```typescript
interface LoginPageProps {
  logoSrc: string;
  logoAlt?: string;
  /** Calls the per-app login(). Returns the resolved userDoc.role on success
   *  (or undefined if the post-login userDoc wasn't fetched). */
  onLogin: (email: string, password: string) => Promise<string | undefined>;
  /** Caller maps role → app path for navigation after successful login. */
  postLoginRouter: (role: string | undefined) => string;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}
```

### SignUpRolePage

```typescript
interface RoleOption {
  /** Stable key, used for React reconciliation. */
  key: string;
  /** i18n key for the label, e.g. "welcome.signUpBabysitter" */
  labelKey: string;
  /** i18n key for the description. */
  descKey: string;
  /** Icon component, e.g. UserIcon. Caller chooses. */
  icon: React.ComponentType<{ className?: string }>;
  /** Link target — usually an /enroll/* path. */
  href: string;
}

interface SignUpRolePageProps {
  logoSrc: string;
  logoAlt?: string;
  /** Roles displayed as cards in the order given. */
  roles: RoleOption[];
}
```

### ForgotPasswordPage

```typescript
interface ForgotPasswordPageProps {
  /** Calls the per-app resetPassword(). */
  onSubmit: (email: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}
```

---

## Task 1: WelcomePage extraction

**Files:**
- Create: `packages/shared-ui/src/pages/WelcomePage.tsx`
- Modify: `packages/shared-ui/src/pages/index.ts`
- Modify: `apps/web/src/pages/public/WelcomePage.tsx` (REWRITE)
- Modify: `apps/study-web/src/pages/public/WelcomePage.tsx` (REWRITE)

- [ ] **Step 1: Create shared component**

```typescript
// packages/shared-ui/src/pages/WelcomePage.tsx
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../components/LanguageSelector.js';

interface WelcomePageProps {
  logoSrc: string;
  logoAlt?: string;
  redirectPath?: string | null;
  authLoading?: boolean;
}

export function WelcomePage({ logoSrc, logoAlt, redirectPath, authLoading }: WelcomePageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (redirectPath) navigate(redirectPath);
  }, [authLoading, redirectPath, navigate]);

  return (
    <div className="flex h-[100svh] flex-col px-6 py-3">
      <div className="flex shrink-0 justify-end">
        <LanguageSelector />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <img
          src={logoSrc}
          alt={logoAlt ?? t('welcome.title')}
          className="mb-3 h-32 w-32 rounded-2xl object-cover sm:h-40 sm:w-40"
        />
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-950">
          {t('welcome.title')}
        </h1>
        <p className="max-w-[260px] text-center text-sm leading-relaxed text-gray-500">
          {t('welcome.subtitle')}
        </p>
      </div>

      <div className="shrink-0">
        <Link to="/login" className="mb-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90">
          {t('welcome.logIn')}
        </Link>
        <Link to="/signup" className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950">
          {t('welcome.signUp')}
        </Link>
        <div className="flex justify-center gap-4 pb-1 pt-1">
          <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.about')}</Link>
          <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.privacy')}</Link>
          <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.terms')}</Link>
          <Link to="/report" className="text-xs text-gray-400 hover:text-gray-600">{t('welcome.help')}</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from pages barrel**

Append to `packages/shared-ui/src/pages/index.ts`:
```typescript
export { WelcomePage } from './WelcomePage.js';
```

- [ ] **Step 3: Rewrite sync-sit WelcomePage as wrapper**

```typescript
// apps/web/src/pages/public/WelcomePage.tsx
import { useAuthStore } from '@/stores/authStore';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';

function computeRedirect(userDoc: ReturnType<typeof useAuthStore.getState>['userDoc']): string | null {
  if (!userDoc) return null;
  if (userDoc.role === 'babysitter') {
    return userDoc.enrollmentComplete === false ? '/enroll/babysitter' : '/babysitter';
  }
  if (userDoc.role === 'parent') return '/family';
  if (userDoc.role === 'admin') return '/admin';
  return null;
}

export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const redirectPath = firebaseUser && userDoc ? computeRedirect(userDoc) : null;
  return <SharedWelcomePage logoSrc="/logo.png" logoAlt="Sync/Sit" authLoading={loading} redirectPath={redirectPath} />;
}
```

- [ ] **Step 4: Rewrite sync-study WelcomePage as wrapper**

```typescript
// apps/study-web/src/pages/public/WelcomePage.tsx
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';

// Sync-study does not auto-redirect logged-in users from welcome yet —
// no per-role dashboards exist. Leaving redirectPath unset until Plan D
// + tutor dashboard land.
export function WelcomePage() {
  return <SharedWelcomePage logoSrc="/logo.png" logoAlt="Sync/Study" />;
}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm --filter study-web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/pages/WelcomePage.tsx packages/shared-ui/src/pages/index.ts apps/web/src/pages/public/WelcomePage.tsx apps/study-web/src/pages/public/WelcomePage.tsx
git commit -m "feat(shared-ui): extract WelcomePage; both apps wrap with per-app redirect"
```

---

## Task 2: SignUpRolePage extraction

**Files:**
- Create: `packages/shared-ui/src/pages/SignUpRolePage.tsx`
- Modify: `packages/shared-ui/src/pages/index.ts`
- Modify: `apps/web/src/pages/public/SignUpRolePage.tsx` (REWRITE)
- Modify: `apps/study-web/src/pages/public/SignUpRolePage.tsx` (REWRITE)

- [ ] **Step 1: Create shared component**

```typescript
// packages/shared-ui/src/pages/SignUpRolePage.tsx
import type { ComponentType } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '../components/Icons.js';

export interface SignUpRoleOption {
  key: string;
  labelKey: string;
  descKey: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

interface SignUpRolePageProps {
  logoSrc: string;
  logoAlt?: string;
  roles: SignUpRoleOption[];
}

export function SignUpRolePage({ logoSrc, logoAlt, roles }: SignUpRolePageProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[100dvh] flex-col px-6 py-4">
      <div className="flex h-[52px] items-center justify-between">
        <Link to="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200">
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t('welcome.signUp')}</span>
        <div className="w-9" />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-8">
        <div className="mb-6 flex justify-center">
          <img src={logoSrc} alt={logoAlt ?? t('welcome.title')} className="h-20 w-20 rounded-2xl object-cover" />
        </div>

        <h2 className="mb-2 text-center text-2xl font-bold text-gray-950">{t('welcome.signUpRole')}</h2>
        <p className="mb-8 text-center text-sm text-gray-500">{t('welcome.subtitle')}</p>

        {roles.map((role) => {
          const Icon = role.icon;
          return (
            <Link
              key={role.key}
              to={role.href}
              className="mb-4 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 transition-colors hover:border-red-300 hover:bg-red-50 active:bg-red-50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <Icon className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-950">{t(role.labelKey)}</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-gray-500">{t(role.descKey)}</p>
            </Link>
          );
        })}

        <div className="text-center">
          <span className="text-sm text-gray-500">{t('welcome.alreadyHaveAccount')}{' '}</span>
          <Link to="/login" className="text-sm font-semibold text-red-600 hover:underline">{t('welcome.logIn')}</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to pages barrel**

Append to `packages/shared-ui/src/pages/index.ts`:
```typescript
export { SignUpRolePage, type SignUpRoleOption } from './SignUpRolePage.js';
```

- [ ] **Step 3: Rewrite sync-sit SignUpRolePage**

```typescript
// apps/web/src/pages/public/SignUpRolePage.tsx
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';

const ROLES: SignUpRoleOption[] = [
  { key: 'babysitter', labelKey: 'welcome.signUpBabysitter', descKey: 'welcome.signUpBabysitterDesc', icon: UserIcon, href: '/enroll/babysitter' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Sit" roles={ROLES} />;
}
```

- [ ] **Step 4: Rewrite sync-study SignUpRolePage**

```typescript
// apps/study-web/src/pages/public/SignUpRolePage.tsx
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';

const ROLES: SignUpRoleOption[] = [
  { key: 'tutor', labelKey: 'welcome.signUpTutor', descKey: 'welcome.signUpTutorDesc', icon: UserIcon, href: '/enroll/tutor' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Study" roles={ROLES} />;
}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm --filter study-web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(shared-ui): extract SignUpRolePage with prop-driven role list"
```

---

## Task 3: LoginPage extraction

**Files:**
- Create: `packages/shared-ui/src/pages/LoginPage.tsx`
- Modify: `packages/shared-ui/src/pages/index.ts`
- Modify: `apps/web/src/pages/public/LoginPage.tsx` (REWRITE)
- Modify: `apps/study-web/src/pages/public/LoginPage.tsx` (REWRITE)

- [ ] **Step 1: Create shared component**

```typescript
// packages/shared-ui/src/pages/LoginPage.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from '../components/Icons.js';

interface LoginPageProps {
  logoSrc: string;
  logoAlt?: string;
  /** Calls the per-app login(). Resolves with the role for routing, or undefined. */
  onLogin: (email: string, password: string) => Promise<string | undefined>;
  /** Caller maps a role string → app path. */
  postLoginRouter: (role: string | undefined) => string;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function LoginPage({ logoSrc, logoAlt, onLogin, postLoginRouter, loading, error, clearError }: LoginPageProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const role = await onLogin(email, password);
      navigate(postLoginRouter(role));
    } catch {
      // Error is set by the caller
    }
  };

  return (
    <div>
      <div className="flex h-[52px] items-center justify-between px-5">
        <Link to="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200">
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t('auth.login')}</span>
        <div className="w-9" />
      </div>

      <div className="px-6 pt-8">
        <div className="mb-6 flex justify-center">
          <img src={logoSrc} alt={logoAlt ?? t('welcome.title')} className="h-20 w-20 rounded-2xl object-cover" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">{t('auth.loginTitle')}</h2>
        <p className="mb-8 text-sm text-gray-500">{t('auth.loginSubtitle')}</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">{t('common.email')}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError(); }}
              placeholder="your@email.com"
              className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
              required
            />
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">{t('common.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError(); }}
              placeholder="Enter your password"
              className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
              required
            />
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <div className="mb-6 text-right">
            <Link to="/forgot-password" className="text-sm font-medium text-red-600 hover:underline">{t('auth.forgotPassword')}</Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
          >
            {loading ? t('auth.signingIn') : t('auth.login')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <span className="text-sm text-gray-500">{t('auth.noAccount')}{' '}</span>
          <Link to="/signup" className="text-sm font-semibold text-red-600 hover:underline">{t('auth.signUp')}</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to pages barrel**

Append:
```typescript
export { LoginPage } from './LoginPage.js';
```

- [ ] **Step 3: Rewrite sync-sit LoginPage**

```typescript
// apps/web/src/pages/public/LoginPage.tsx
import { useAuthStore } from '@/stores/authStore';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';

function postLoginRouter(role: string | undefined): string {
  if (role === 'babysitter') return '/babysitter';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  return '/';
}

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    return useAuthStore.getState().userDoc?.role;
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Sit"
      onLogin={handleLogin}
      postLoginRouter={postLoginRouter}
      loading={loading}
      error={error}
      clearError={clearError}
    />
  );
}
```

- [ ] **Step 4: Rewrite sync-study LoginPage**

```typescript
// apps/study-web/src/pages/public/LoginPage.tsx
import { useAuthStore } from '@/stores/authStore';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';

function postLoginRouter(role: string | undefined): string {
  if (role === 'tutor') return '/tutor';
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  return '/';
}

export function LoginPage() {
  const { login, loading, error, clearError } = useAuthStore();

  const handleLogin = async (email: string, password: string): Promise<string | undefined> => {
    await login(email, password);
    return useAuthStore.getState().userDoc?.role as string | undefined;
  };

  return (
    <SharedLoginPage
      logoSrc="/logo.png"
      logoAlt="Sync/Study"
      onLogin={handleLogin}
      postLoginRouter={postLoginRouter}
      loading={loading}
      error={error}
      clearError={clearError}
    />
  );
}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm --filter study-web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(shared-ui): extract LoginPage with prop-driven auth + postLoginRouter"
```

---

## Task 4: i18n keys for ForgotPasswordPage

Hard-coded English strings in sync-sit's current ForgotPasswordPage need to move to i18n before the component is shared.

**Files:**
- Modify: `apps/web/src/i18n/en.ts` + `fr.ts`
- Modify: `apps/study-web/src/i18n/en.ts` + `fr.ts`

- [ ] **Step 1: Add keys to sync-sit en.ts**

In the `auth:` block, add:
```typescript
forgotPasswordTitle: 'Reset Password',
forgotPasswordHeading: 'Forgot your password?',
forgotPasswordDesc: "Enter your email and we'll send you a link to reset it.",
forgotPasswordSubmit: 'Send reset link',
checkEmailHeading: 'Check your email',
checkEmailDesc: 'We sent a password reset link to',
checkEmailHint: "Check your inbox for a link to reset your password. If you don't see it, check your spam folder.",
```

- [ ] **Step 2: Add same keys to sync-sit fr.ts** (translate)

```typescript
forgotPasswordTitle: 'Réinitialiser le mot de passe',
forgotPasswordHeading: 'Mot de passe oublié ?',
forgotPasswordDesc: "Saisissez votre email et nous vous enverrons un lien pour le réinitialiser.",
forgotPasswordSubmit: 'Envoyer le lien',
checkEmailHeading: 'Vérifiez votre email',
checkEmailDesc: 'Nous avons envoyé un lien de réinitialisation à',
checkEmailHint: "Consultez votre boîte de réception pour le lien. Si vous ne le voyez pas, vérifiez votre dossier spam.",
```

- [ ] **Step 3: Add same keys to sync-study en.ts + fr.ts**

Same English text in `en.ts`; same French text in `fr.ts`. The keys live in the `auth:` block in both files.

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "i18n: add forgotPassword keys to both apps for shared component"
```

---

## Task 5: ForgotPasswordPage extraction + sync-study wire-up

**Files:**
- Create: `packages/shared-ui/src/pages/ForgotPasswordPage.tsx`
- Modify: `packages/shared-ui/src/pages/index.ts`
- Modify: `apps/web/src/pages/public/ForgotPasswordPage.tsx` (REWRITE)
- Create: `apps/study-web/src/pages/public/ForgotPasswordPage.tsx` (NEW)
- Modify: `apps/study-web/src/router.tsx` (swap StaticPage stub → real ForgotPasswordPage)

- [ ] **Step 1: Verify sync-study authStore has resetPassword**

Run: `grep -n "resetPassword" apps/study-web/src/stores/authStore.ts`
Expected: at least one match. If absent, add a thin wrapper around Firebase `sendPasswordResetEmail` matching sync-sit's signature (`async (email: string) => Promise<void>`).

If `resetPassword` is missing, add it in this step before continuing:
```typescript
// apps/study-web/src/stores/authStore.ts (within the store definition)
resetPassword: async (email: string): Promise<void> => {
  set({ error: null });
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (e) {
    set({ error: (e as Error).message });
    throw e;
  }
},
```

- [ ] **Step 2: Create shared component**

```typescript
// packages/shared-ui/src/pages/ForgotPasswordPage.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '../components/TopNav.js';
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { InfoBanner } from '../components/InfoBanner.js';

interface ForgotPasswordPageProps {
  onSubmit: (email: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
}

export function ForgotPasswordPage({ onSubmit, error, clearError }: ForgotPasswordPageProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit(email);
      setSent(true);
    } catch {
      // error set by caller
    }
  };

  if (sent) {
    return (
      <div>
        <TopNav title={t('auth.forgotPasswordTitle')} backTo="/login" />
        <div className="px-6 pt-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <span className="text-2xl">✉️</span>
          </div>
          <h2 className="mb-2 text-xl font-bold">{t('auth.checkEmailHeading')}</h2>
          <p className="mb-6 text-sm text-gray-500">
            {t('auth.checkEmailDesc')} <strong className="text-gray-950">{email}</strong>
          </p>
          <InfoBanner icon="ℹ️">{t('auth.checkEmailHint')}</InfoBanner>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('auth.forgotPasswordTitle')} backTo="/login" />
      <div className="px-6 pt-8">
        <h2 className="mb-2 text-2xl font-bold">{t('auth.forgotPasswordHeading')}</h2>
        <p className="mb-8 text-sm text-gray-500">{t('auth.forgotPasswordDesc')}</p>

        <form onSubmit={handleSubmit}>
          <Input
            label={t('common.email')}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearError(); }}
            placeholder="your@email.com"
            error={error ?? undefined}
            required
          />
          <Button type="submit">{t('auth.forgotPasswordSubmit')}</Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add to pages barrel**

Append:
```typescript
export { ForgotPasswordPage } from './ForgotPasswordPage.js';
```

- [ ] **Step 4: Rewrite sync-sit ForgotPasswordPage**

```typescript
// apps/web/src/pages/public/ForgotPasswordPage.tsx
import { useAuthStore } from '@/stores/authStore';
import { ForgotPasswordPage as SharedForgotPasswordPage } from '@ejm/shared-ui';

export function ForgotPasswordPage() {
  const { resetPassword, error, clearError } = useAuthStore();
  return <SharedForgotPasswordPage onSubmit={resetPassword} error={error} clearError={clearError} />;
}
```

- [ ] **Step 5: Create sync-study ForgotPasswordPage**

```typescript
// apps/study-web/src/pages/public/ForgotPasswordPage.tsx
import { useAuthStore } from '@/stores/authStore';
import { ForgotPasswordPage as SharedForgotPasswordPage } from '@ejm/shared-ui';

export function ForgotPasswordPage() {
  const { resetPassword, error, clearError } = useAuthStore();
  return <SharedForgotPasswordPage onSubmit={resetPassword} error={error} clearError={clearError} />;
}
```

- [ ] **Step 6: Update sync-study router**

```typescript
// apps/study-web/src/router.tsx
+ import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage';

// Replace:
- { path: '/forgot-password', element: <StaticPage titleKey="auth.forgotPassword" /> },
+ { path: '/forgot-password', element: <ForgotPasswordPage /> },
```

- [ ] **Step 7: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm --filter study-web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: extract ForgotPasswordPage; sync-study replaces StaticPage stub"
```

---

## Task 6: Smoke test + PR

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 2: Smoke sync-sit**

- Start dev: `pnpm --filter web dev`
- Visit `/` → Welcome (logo + login/signup CTAs + footer links visible)
- Visit `/login` → form renders, error path works (submit invalid creds, error appears)
- Visit `/signup` → see Babysitter + Parent cards
- Visit `/forgot-password` → form renders; submit sends reset email; success view shows "Check your email"

- [ ] **Step 3: Smoke sync-study**

- Start dev: `pnpm --filter study-web dev`
- Same four routes — expect identical layout with sync-study branding (Sync/Study title, Tutor + Parent on signup, blue theme via CSS tokens)

- [ ] **Step 4: Verify no `StaticPage` still wired to `/forgot-password` on sync-study**

Run: `grep -n "forgot-password" apps/study-web/src/router.tsx`
Expected: One match, pointing at the real component (not `StaticPage`).

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feature/shared-public-auth-pages
gh pr create --title "Shared public auth pages: Welcome / Login / SignUpRole / ForgotPassword" --body "..."
```

PR body summarizes scope, names the prop interfaces, calls out the post-Plan-D simplification path.

---

## Test coverage analysis

- **Covered by build/typecheck:** prop typing, import resolution, role list typing.
- **Covered by smoke:** UI rendering, login form happy path, password reset send + success view, role list display.
- **Not covered:** the actual login → role-based-routing happy path requires emulator + valid creds. Manual smoke is the verification.
- **Gaps:** no unit tests for the shared components (consistent with Plans A and B; vitest setup in shared-ui is still a deferred follow-up).

## Security risks

- None new. Login + password reset still go through each app's authStore; the shared components are pure UI.
- `postLoginRouter` is a per-app function — caller controls every possible navigation target. No prop is user-controlled.

## Future upgrades / refactoring

- Plan D (portable user entity): the per-app `postLoginRouter` and `redirectPath` computation will both move to a shared utility that reads `userDoc.profiles.{sit,study}.role`. Plan D landing will simplify both wrappers to ~3 lines each.
- After Plan E (shared app shells) the welcome auto-redirect logic can be lifted further — likely into the `PublicLayout`.
- Logo image (`/logo.png`) and brand alt are still per-app props. If the brand-theme split ever needs more presets (`/logo-light.png`, etc.), a brand-config object on the layout could replace per-page props.
