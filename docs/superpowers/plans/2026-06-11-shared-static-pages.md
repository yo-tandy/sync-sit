# Shared Static / Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `PrivacyPage`, `TermsPage`, and `ReportProblemPage` from `apps/web/src/pages/public/` into `@ejm/shared-ui/pages/` with identical content across both apps (brand-name interpolated). Extract `AboutPageShell` into `@ejm/shared-ui` and let each app pass its own About content. Replace the four sync-study `StaticPage` placeholder routes with real shared pages. Outcome: one source of truth for legal copy, one component to maintain, no more "coming soon" stubs on sync-study for these four routes.

**Architecture:** Legal content stays as TypeScript `Section[]` arrays (current sync-sit pattern — copy is too dense for i18n flat keys) but lives inside the shared component file. Brand-specific tokens in the copy (`Sync/Sit` → `{{brand}}`, support email → `{{supportEmail}}`) are interpolated at render time. Each component takes `brand` (and `supportEmail` for ReportProblemPage) as required props. **Critical scope note:** the existing sync-sit Privacy/Terms copy is babysitting-specific ("Children's data", "babysitter availability", etc.). Per user direction ("user entity is shared, all info is relevant for both apps"), the copy must be rewritten to describe the combined system (babysitting + tutoring under the same legal entity). This rewrite is part of the plan; the user reviews the final copy before merge.

**Tech Stack:** TypeScript, React 19, react-i18next, Tailwind v4 + shared-ui theme, Vitest + React Testing Library.

---

## File structure

**New files:**
- `packages/shared-ui/src/pages/PrivacyPage.tsx` — full component, brand-interpolated legal sections
- `packages/shared-ui/src/pages/TermsPage.tsx` — same shape as PrivacyPage
- `packages/shared-ui/src/pages/ReportProblemPage.tsx` — uses errorCapture from shared-core
- `packages/shared-ui/src/pages/AboutPageShell.tsx` — layout + TopNav + footer; children prop for body
- `packages/shared-ui/src/pages/index.ts` — barrel
- `packages/shared-core/src/lib/errorCapture.ts` — moved from `apps/web/src/lib/errorCapture.ts`
- `packages/shared-core/src/lib/index.ts` — add `errorCapture` export (or update existing barrel)
- `packages/shared-ui/src/pages/__tests__/PrivacyPage.test.tsx`
- `packages/shared-ui/src/pages/__tests__/TermsPage.test.tsx`
- `packages/shared-ui/src/pages/__tests__/ReportProblemPage.test.tsx`
- `apps/web/src/pages/public/AboutPage.tsx` — REWRITE to thin wrapper around shared `AboutPageShell` (the file exists today as a full implementation; we replace its body)
- `apps/study-web/src/pages/public/AboutPage.tsx` — new thin wrapper using sync-study content

**Modified files:**
- `packages/shared-ui/src/index.ts` — add `export * from './pages/index.js'`
- `apps/web/src/router.tsx` (or wherever sync-sit routes are defined) — `/privacy`, `/terms`, `/report` point at shared components with `brand="Sync/Sit"` and `supportEmail="support@sync-sit.com"`
- `apps/study-web/src/router.tsx` — replace the four `<StaticPage titleKey="..." />` entries for `/about`, `/privacy`, `/terms`, `/report` with real shared components (about wraps `AboutPageShell`); keep `/enroll/parent` and `/forgot-password` on `StaticPage` (out of scope)
- `apps/web/src/i18n/en.ts` + `fr.ts` — extract `privacy.*`, `terms.*`, `report.*`, `about.*` keys; the `report.*` keys move into shared-ui's component file as inline strings (small enough); `privacy.*`/`terms.*` titles stay as i18n. About i18n stays per-app.
- `apps/study-web/src/i18n/en.ts` + `fr.ts` — add the same legal title + report keys that sync-sit has; add per-app About copy

**Deleted files (after migration):**
- `apps/web/src/pages/public/PrivacyPage.tsx`
- `apps/web/src/pages/public/TermsPage.tsx`
- `apps/web/src/pages/public/ReportProblemPage.tsx`
- `apps/web/src/lib/errorCapture.ts` (moved, not deleted — but the apps/web path goes away)

**NOT touched:**
- `apps/study-web/src/pages/public/StaticPage.tsx` — still used by `/enroll/parent` and `/forgot-password`. Out of scope for this plan.
- `apps/web/src/pages/public/{BabysitterGuidePage,ParentGuidePage,AddToHomescreenPage,SharePage}.tsx` — sync-sit specific, no sync-study equivalent yet. Out of scope.
- `apps/web/src/pages/public/{WelcomePage,LoginPage,SignUpRolePage,ForgotPasswordPage}.tsx` — covered by Plan C.

---

## Component signatures

```typescript
// PrivacyPage
interface PrivacyPageProps {
  brand: string;          // "Sync/Sit" | "Sync/Study"
  supportEmail: string;   // shown in §1 "Data Controller"
}

// TermsPage
interface TermsPageProps {
  brand: string;
  supportEmail: string;
}

// ReportProblemPage
interface ReportProblemPageProps {
  brand: string;
  supportEmail: string;   // mailto target
}

// AboutPageShell
interface AboutPageShellProps {
  title: string;          // already-translated string (caller does t())
  children: React.ReactNode;  // body sections — heading + paragraphs
}
```

---

## Content rewrite scope (Privacy + Terms)

The sync-sit Privacy/Terms copy references babysitter-specific concepts:

- "Children's data" (sync-sit has parents with kids; sync-study has parents with high-schoolers and tutors)
- "babysitter availability" / "appointment history" / "babysitters are verified through their @ejm.org school email" / "vouching records"
- "Babysitting" used as a category name

Edits needed (proposed by the implementer; user approves before merge):

| Section | Edit |
|---|---|
| §1 Data Controller | Replace "Sync/Sit" → "{{brand}}". Add: "{{brand}} is part of a suite of platforms (Sync/Sit for babysitting, Sync/Study for tutoring) operated by Tandy SARL for the EJM community." |
| §2 Personal Data Collected | Add: "Tutor data: subjects, session-length preferences, area coverage." Add: "For Sync/Study, parent profiles include their children's school year and subjects of interest (instead of childcare needs)." Keep babysitter/family items unchanged. |
| §3 Purposes of Processing | Add tutor-matching purpose. Generalize "Affiliation verification" to cover tutors too (already done — they use the same @ejm.org verification). |
| §4 Legal Basis | No change. |
| §5 Recipients | No change (Tandy SARL operates both). |
| §6 Data Retention | No change. |
| §7 User Rights | No change. |
| §8 Transfers | No change. |
| §9 Cookies & Storage | No change. |
| §10 Security | No change. |
| §11 Contact | "{{supportEmail}}" interpolation. |

Terms changes are analogous (add tutor user category, generalize "babysitter conduct" clauses).

**Sub-tasks 4 and 5 below produce the rewritten copy as part of the extraction.** The user reads the final rewritten arrays before approving merge.

---

## Task 1: Move errorCapture to shared-core

**Files:**
- Move: `apps/web/src/lib/errorCapture.ts` → `packages/shared-core/src/lib/errorCapture.ts`
- Modify: `packages/shared-core/src/lib/index.ts` (or `packages/shared-core/src/index.ts` if no `lib` barrel exists yet)
- Modify: `apps/web/src/lib/errorCapture.ts` — DELETED
- Modify: all sync-sit imports of `@/lib/errorCapture` switch to `@ejm/shared-core`

- [ ] **Step 1: Find all sync-sit usages**

Run: `grep -rn "lib/errorCapture\|from '\./errorCapture'" apps/web/src/ apps/study-web/src/`
Expected: 2-4 import sites in `apps/web/src/`, none in sync-study.

- [ ] **Step 2: Copy errorCapture.ts into shared-core**

```bash
mkdir -p packages/shared-core/src/lib
cp apps/web/src/lib/errorCapture.ts packages/shared-core/src/lib/errorCapture.ts
```

No code change needed — the file uses only `localStorage` + `Date` + `JSON`, all browser globals available in shared-core's web bundle.

- [ ] **Step 3: Export from shared-core**

Check whether `packages/shared-core/src/lib/index.ts` exists. If yes, append:
```typescript
export * from './errorCapture.js';
```
If no, create it with that line and add `export * from './lib/index.js'` to `packages/shared-core/src/index.ts`.

- [ ] **Step 4: Update sync-sit imports**

For each grep hit from step 1, replace:
```typescript
import { getRecentErrors, formatErrorsForEmail } from '@/lib/errorCapture';
```
with:
```typescript
import { getRecentErrors, formatErrorsForEmail } from '@ejm/shared-core';
```

- [ ] **Step 5: Delete old file**

```bash
rm apps/web/src/lib/errorCapture.ts
```

- [ ] **Step 6: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-core/src/lib/errorCapture.ts packages/shared-core/src/lib/index.ts packages/shared-core/src/index.ts apps/web/src/
git commit -m "refactor(shared-core): move errorCapture from apps/web to shared package"
```

---

## Task 2: Create shared-ui pages subfolder + barrel

**Files:**
- Create: `packages/shared-ui/src/pages/index.ts`
- Modify: `packages/shared-ui/src/index.ts`

- [ ] **Step 1: Create empty barrel**

Create `packages/shared-ui/src/pages/index.ts`:
```typescript
export { PrivacyPage } from './PrivacyPage.js';
export { TermsPage } from './TermsPage.js';
export { ReportProblemPage } from './ReportProblemPage.js';
export { AboutPageShell } from './AboutPageShell.js';
```

This file won't compile until tasks 3-6 land each component. That's fine — we add the components task-by-task, and the barrel updates as we go (or stays as-is and the imports resolve once files exist).

- [ ] **Step 2: Add to top-level shared-ui barrel**

Edit `packages/shared-ui/src/index.ts`, append:
```typescript
export * from './pages/index.js';
```

- [ ] **Step 3: Commit (with placeholder files to keep build green)**

To avoid red CI between Tasks 2 and 3, create empty stub files now:
```typescript
// packages/shared-ui/src/pages/PrivacyPage.tsx
export function PrivacyPage() { return null; }
// (same shape for Terms, ReportProblem, AboutPageShell)
```

Then commit:
```bash
git add packages/shared-ui/src/pages/ packages/shared-ui/src/index.ts
git commit -m "chore(shared-ui): scaffold pages/ subfolder for static pages"
```

(Subsequent tasks replace each stub with the real component.)

---

## Task 3: Extract AboutPageShell

**Files:**
- Modify: `packages/shared-ui/src/pages/AboutPageShell.tsx` (replaces stub from Task 2)
- Test: `packages/shared-ui/src/pages/__tests__/AboutPageShell.test.tsx`

This is the simplest page (no content rewrite — content is passed in by caller), so we do it first.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared-ui/src/pages/__tests__/AboutPageShell.test.tsx
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AboutPageShell } from '../AboutPageShell.js';

describe('AboutPageShell', () => {
  it('renders the title in the top nav and children in the body', () => {
    render(
      <BrowserRouter>
        <AboutPageShell title="About">
          <h2 data-testid="body-heading">About Sync/Sit</h2>
          <p>Body paragraph.</p>
        </AboutPageShell>
      </BrowserRouter>
    );
    expect(screen.getAllByText('About').length).toBeGreaterThan(0);
    expect(screen.getByTestId('body-heading')).toBeInTheDocument();
    expect(screen.getByText('Body paragraph.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ejm/shared-ui test pages/AboutPageShell`
Expected: FAIL (component is the empty stub from Task 2).

- [ ] **Step 3: Implement AboutPageShell**

```typescript
// packages/shared-ui/src/pages/AboutPageShell.tsx
import { TopNav } from '../components/TopNav.js';

interface AboutPageShellProps {
  title: string;
  children: React.ReactNode;
}

export function AboutPageShell({ title, children }: AboutPageShellProps) {
  return (
    <div>
      <TopNav title={title} backTo="back" />
      <div className="px-5 pt-4 pb-20 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ejm/shared-ui test pages/AboutPageShell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/src/pages/AboutPageShell.tsx packages/shared-ui/src/pages/__tests__/AboutPageShell.test.tsx
git commit -m "feat(shared-ui): add AboutPageShell layout component"
```

---

## Task 4: Extract PrivacyPage (with content rewrite)

**Files:**
- Modify: `packages/shared-ui/src/pages/PrivacyPage.tsx` (replaces stub)
- Test: `packages/shared-ui/src/pages/__tests__/PrivacyPage.test.tsx`

**Pre-work — read the source:**
```bash
cat apps/web/src/pages/public/PrivacyPage.tsx
```
Note the `Section[]` array — 11 sections, each with `titleEn`, `titleFr`, `contentEn`, `contentFr`. The full English content is ~3KB; French is a translation of the same.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared-ui/src/pages/__tests__/PrivacyPage.test.tsx
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PrivacyPage } from '../PrivacyPage.js';

describe('PrivacyPage', () => {
  it('interpolates the brand name into the data controller section', () => {
    render(
      <BrowserRouter>
        <PrivacyPage brand="Sync/Study" supportEmail="support@sync-study.com" />
      </BrowserRouter>
    );
    expect(screen.getByText(/Sync\/Study is operated by Tandy SARL/i)).toBeInTheDocument();
    expect(screen.getByText(/support@sync-study\.com/)).toBeInTheDocument();
    // Does NOT mention the other brand
    expect(screen.queryByText(/Sync\/Sit is operated/i)).toBeNull();
  });

  it('renders all 11 numbered sections', () => {
    render(
      <BrowserRouter>
        <PrivacyPage brand="Sync/Sit" supportEmail="support@sync-sit.com" />
      </BrowserRouter>
    );
    expect(screen.getByText(/1\. Data Controller/i)).toBeInTheDocument();
    expect(screen.getByText(/11\. Contact/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @ejm/shared-ui test pages/PrivacyPage`
Expected: FAIL (stub returns null).

- [ ] **Step 3: Author the rewritten content**

Copy the 11 sections from `apps/web/src/pages/public/PrivacyPage.tsx` into the new file. Apply the edits from the "Content rewrite scope" table at the top of this plan:
- Replace literal `Sync/Sit` in all section bodies with `{{brand}}` placeholder
- Replace literal `support@sync-sit.com` with `{{supportEmail}}` placeholder
- Edit §1 to add the suite-of-platforms note
- Edit §2 to add tutor data + sync-study parent data lines
- Edit §3 to add tutor-matching purpose

The file is large (≈250 lines of content). Author it in full — no `// TODO` placeholders.

- [ ] **Step 4: Implement the renderer**

```typescript
// packages/shared-ui/src/pages/PrivacyPage.tsx
import { useTranslation } from 'react-i18next';
import { TopNav } from '../components/TopNav.js';

interface PrivacyPageProps {
  brand: string;
  supportEmail: string;
}

interface Section {
  titleEn: string;
  titleFr: string;
  contentEn: string;
  contentFr: string;
}

const sections: Section[] = [
  // ... 11 rewritten sections (from Step 3)
];

function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

export function PrivacyPage({ brand, supportEmail }: PrivacyPageProps) {
  const { i18n, t } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const vars = { brand, supportEmail };

  return (
    <div>
      <TopNav title={t('privacy.title')} backTo="back" />
      <div className="px-5 pt-4 pb-20">
        {sections.map((s, i) => (
          <section key={i} className="mb-6">
            <h2 className="mb-2 text-base font-semibold text-gray-900">
              {isFr ? s.titleFr : s.titleEn}
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
              {interpolate(isFr ? s.contentFr : s.contentEn, vars)}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pnpm --filter @ejm/shared-ui test pages/PrivacyPage`
Expected: PASS both tests.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/pages/PrivacyPage.tsx packages/shared-ui/src/pages/__tests__/PrivacyPage.test.tsx
git commit -m "feat(shared-ui): add PrivacyPage with brand interpolation, rewritten for both apps"
```

---

## Task 5: Extract TermsPage (with content rewrite)

Same shape as Task 4. The source has 12 sections; rewrite includes adding a "tutor conduct" sub-clause and generalizing "babysitter responsibilities" to "verified user responsibilities."

- [ ] **Step 1: Write failing tests** (mirror PrivacyPage tests but for `terms.title` and Terms-specific sections)
- [ ] **Step 2: Verify fail**
- [ ] **Step 3: Author rewritten content** (12 sections in `Section[]`)
- [ ] **Step 4: Implement renderer** (identical to PrivacyPage except `t('terms.title')`)
- [ ] **Step 5: Verify tests pass**
- [ ] **Step 6: Commit:**
```bash
git commit -m "feat(shared-ui): add TermsPage with brand interpolation, rewritten for both apps"
```

---

## Task 6: Extract ReportProblemPage

**Files:**
- Modify: `packages/shared-ui/src/pages/ReportProblemPage.tsx` (replaces stub)
- Test: `packages/shared-ui/src/pages/__tests__/ReportProblemPage.test.tsx`

The source uses `useAuthStore` to get the current user's UID. Shared-ui can't import an app-specific store. **Decision:** ReportProblemPage takes the userId as an optional prop. Each app's router computes it from its own `useAuthStore` hook.

```typescript
interface ReportProblemPageProps {
  brand: string;
  supportEmail: string;
  userId?: string;  // undefined for unauth users; shown as "Not logged in"
  appVersion?: string;  // defaults to '1.0.0'
}
```

- [ ] **Step 1: Write failing test**

```typescript
// packages/shared-ui/src/pages/__tests__/ReportProblemPage.test.tsx
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { ReportProblemPage } from '../ReportProblemPage.js';

describe('ReportProblemPage', () => {
  it('renders the mailto link with the provided support email and user ID', () => {
    render(
      <BrowserRouter>
        <ReportProblemPage brand="Sync/Study" supportEmail="support@sync-study.com" userId="abc123" />
      </BrowserRouter>
    );
    const link = screen.getByRole('link', { name: /open email/i }) as HTMLAnchorElement;
    expect(link.href).toMatch(/^mailto:support@sync-study\.com/);
    expect(decodeURIComponent(link.href)).toContain('User ID: abc123');
  });

  it('shows "Not logged in" when userId is undefined', () => {
    render(
      <BrowserRouter>
        <ReportProblemPage brand="Sync/Sit" supportEmail="support@sync-sit.com" />
      </BrowserRouter>
    );
    expect(screen.getByText(/Not logged in/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @ejm/shared-ui test pages/ReportProblemPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// packages/shared-ui/src/pages/ReportProblemPage.tsx
import { useTranslation } from 'react-i18next';
import { getRecentErrors, formatErrorsForEmail } from '@ejm/shared-core';
import { TopNav } from '../components/TopNav.js';
import { Card } from '../components/Card.js';
import { Button } from '../components/Button.js';
import { InfoBanner } from '../components/InfoBanner.js';
import { MailIcon } from '../components/Icons.js';

interface ReportProblemPageProps {
  brand: string;
  supportEmail: string;
  userId?: string;
  appVersion?: string;
}

export function ReportProblemPage({
  brand,
  supportEmail,
  userId,
  appVersion = '1.0.0',
}: ReportProblemPageProps) {
  const { t } = useTranslation();
  const resolvedUserId = userId ?? t('report.notLoggedIn');
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const platform = navigator.userAgent.includes('iPhone') ? 'iOS'
    : navigator.userAgent.includes('Android') ? 'Android' : 'Web';

  const recentErrors = getRecentErrors();
  const errorsForEmail = formatErrorsForEmail();
  const errorCount = recentErrors.length;

  const subject = encodeURIComponent(`${brand} Problem Report`);
  const body = encodeURIComponent(
    `User ID: ${resolvedUserId}\nTime: ${timeStr}\nVersion: ${appVersion}\nPlatform: ${platform}\n\nRecent errors (${errorCount}):\n${errorsForEmail}\n\n---\nDescribe your issue:\n`
  );
  const mailtoHref = `mailto:${supportEmail}?subject=${subject}&body=${body}`;

  return (
    <div>
      <TopNav title={t('report.title')} backTo="back" />
      <div className="px-5 pt-4">
        <p className="mb-6 text-sm leading-relaxed text-gray-500">
          {t('report.desc')}
        </p>
        <Card className="mb-6 bg-gray-50">
          <p className="mb-3 text-xs font-medium text-gray-400">
            {t('report.whatIncluded')}
          </p>
          <div className="space-y-2 text-sm text-gray-700">
            <Row label={t('report.userId')} value={resolvedUserId} />
            <Row label={t('report.time')} value={timeStr} />
            <Row label={t('report.version')} value={appVersion} />
            <Row label={t('report.platform')} value={platform} />
            <Row label={t('report.recentErrors')} value={errorCount > 0 ? t('report.errorsFound', { count: errorCount }) : t('report.none')} />
          </div>
        </Card>
        <InfoBanner>{t('report.privacyNote')}</InfoBanner>
        <a href={mailtoHref}>
          <Button className="mt-4 w-full" type="button">
            <MailIcon className="mr-2 h-5 w-5 inline" />
            {t('report.openEmail')}
          </Button>
        </a>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono text-xs text-gray-500">{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @ejm/shared-ui test pages/ReportProblemPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(shared-ui): add ReportProblemPage with brand + supportEmail props"
```

---

## Task 7: Add legal i18n keys to both apps

**Files:**
- Modify: `apps/web/src/i18n/en.ts` + `fr.ts` — `privacy`, `terms`, `report` keys already exist; add `report.notLoggedIn` (sync-sit currently uses inline 'Not logged in' string)
- Modify: `apps/study-web/src/i18n/en.ts` + `fr.ts` — add `privacy.title`, `terms.title`, full `report.*` block, and per-app `about.*` block

- [ ] **Step 1: Add `report.notLoggedIn` key to sync-sit i18n**

Edit `apps/web/src/i18n/en.ts` in the `report:` block:
```typescript
notLoggedIn: 'Not logged in',
```
And `fr.ts`:
```typescript
notLoggedIn: 'Non connecté',
```

- [ ] **Step 2: Add legal keys to sync-study i18n**

Edit `apps/study-web/src/i18n/en.ts`. Insert before `validation:`:
```typescript
privacy: {
  title: 'Privacy Policy',
},
terms: {
  title: 'Terms & Conditions',
},
report: {
  title: 'Report a Problem',
  desc: "If you're experiencing an issue, tap the button below to send us an email. We'll pre-fill some diagnostic info to help us investigate.",
  whatIncluded: 'WHAT WILL BE INCLUDED',
  userId: 'User ID',
  time: 'Time',
  version: 'Version',
  platform: 'Platform',
  recentErrors: 'Recent errors',
  none: 'None',
  errorsFound: '{{count}} error(s) captured',
  privacyNote: 'Only your user ID is included to help us investigate. No personal data is sent automatically.',
  openEmail: 'Open email to support',
  notLoggedIn: 'Not logged in',
},
about: {
  title: 'About',
  heading: 'About Sync/Study',
  body1: 'Sync/Study connects EJM high school students who tutor with EJM families looking for academic support. The app helps families find trusted tutors based on subjects, availability, and location.',
  body2: 'This is a coordination tool — it helps families and tutors connect, but does not handle payment or serve as a booking system of record.',
},
```

And the parallel block in `fr.ts` with French translations (mirror style of existing sync-sit `fr.ts` for `report.*` and adapt `about.*` for Sync/Study).

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "i18n: add privacy/terms/report keys to sync-study, notLoggedIn key to sync-sit"
```

---

## Task 8: Update sync-sit AboutPage to use AboutPageShell

**Files:**
- Modify: `apps/web/src/pages/public/AboutPage.tsx`

- [ ] **Step 1: Read the current implementation**

Run: `cat apps/web/src/pages/public/AboutPage.tsx`
Expected: 172 lines with TopNav, heading, body1, body2 from i18n.

- [ ] **Step 2: Replace body with shell wrapper**

```typescript
// apps/web/src/pages/public/AboutPage.tsx
import { useTranslation } from 'react-i18next';
import { AboutPageShell } from '@ejm/shared-ui';

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <AboutPageShell title={t('about.title')}>
      <h1 className="mb-3 text-xl font-bold text-gray-900">
        {t('about.heading')}
      </h1>
      <p className="mb-4">{t('about.body1')}</p>
      <p className="mb-4">{t('about.body2')}</p>
    </AboutPageShell>
  );
}
```

(If the current sync-sit AboutPage has additional sections beyond body1/body2 — verify in step 1 — add corresponding children here.)

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(web): rewire AboutPage through shared AboutPageShell"
```

---

## Task 9: Replace sync-sit Privacy/Terms/Report routes with shared pages

**Files:**
- Modify: `apps/web/src/router.tsx` (or wherever routes are defined — verify via `grep -rn "PrivacyPage\|TermsPage\|ReportProblemPage" apps/web/src/`)
- Delete: `apps/web/src/pages/public/PrivacyPage.tsx`
- Delete: `apps/web/src/pages/public/TermsPage.tsx`
- Delete: `apps/web/src/pages/public/ReportProblemPage.tsx`

- [ ] **Step 1: Find route definitions**

Run: `grep -rn "PrivacyPage\|TermsPage\|ReportProblemPage" apps/web/src/`
Expected: import + JSX use in router file.

- [ ] **Step 2: Swap imports and JSX**

Change imports:
```typescript
- import { PrivacyPage } from '@/pages/public/PrivacyPage';
- import { TermsPage } from '@/pages/public/TermsPage';
- import { ReportProblemPage } from '@/pages/public/ReportProblemPage';
+ import { PrivacyPage, TermsPage, ReportProblemPage } from '@ejm/shared-ui';
+ import { useAuthStore } from '@/stores/authStore';
```

Replace the JSX route elements. Since ReportProblemPage needs `userId`, wrap it in a tiny adapter (inline, no new file):
```typescript
function SyncSitReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <ReportProblemPage brand="Sync/Sit" supportEmail="support@sync-sit.com" userId={userDoc?.uid} />;
}
```

Or inline the prop:
```typescript
{ path: '/privacy', element: <PrivacyPage brand="Sync/Sit" supportEmail="support@sync-sit.com" /> },
{ path: '/terms', element: <TermsPage brand="Sync/Sit" supportEmail="support@sync-sit.com" /> },
{ path: '/report', element: <SyncSitReportProblemPage /> },
```

- [ ] **Step 3: Delete old page files**

```bash
rm apps/web/src/pages/public/PrivacyPage.tsx
rm apps/web/src/pages/public/TermsPage.tsx
rm apps/web/src/pages/public/ReportProblemPage.tsx
```

- [ ] **Step 4: Verify build + typecheck**

Run: `pnpm --filter web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(web): consume shared PrivacyPage/TermsPage/ReportProblemPage from @ejm/shared-ui"
```

---

## Task 10: Wire sync-study to use shared pages

**Files:**
- Modify: `apps/study-web/src/router.tsx`
- Create: `apps/study-web/src/pages/public/AboutPage.tsx`

- [ ] **Step 1: Create sync-study AboutPage**

```typescript
// apps/study-web/src/pages/public/AboutPage.tsx
import { useTranslation } from 'react-i18next';
import { AboutPageShell } from '@ejm/shared-ui';

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <AboutPageShell title={t('about.title')}>
      <h1 className="mb-3 text-xl font-bold text-gray-900">
        {t('about.heading')}
      </h1>
      <p className="mb-4">{t('about.body1')}</p>
      <p className="mb-4">{t('about.body2')}</p>
    </AboutPageShell>
  );
}
```

(Body content comes from the sync-study i18n keys added in Task 7.)

- [ ] **Step 2: Update sync-study router**

Edit `apps/study-web/src/router.tsx`:
```typescript
- import { StaticPage } from '@/pages/public/StaticPage';
+ import { StaticPage } from '@/pages/public/StaticPage';
+ import { AboutPage } from '@/pages/public/AboutPage';
+ import { PrivacyPage, TermsPage, ReportProblemPage } from '@ejm/shared-ui';
+ import { useAuthStore } from '@/stores/authStore';
+
+ function SyncStudyReportProblemPage() {
+   const { userDoc } = useAuthStore();
+   return <ReportProblemPage brand="Sync/Study" supportEmail="support@sync-study.com" userId={userDoc?.uid} />;
+ }

// Replace these four route entries:
- { path: '/about', element: <StaticPage titleKey="welcome.about" /> },
- { path: '/privacy', element: <StaticPage titleKey="welcome.privacy" /> },
- { path: '/terms', element: <StaticPage titleKey="welcome.terms" /> },
- { path: '/report', element: <StaticPage titleKey="welcome.help" /> },
+ { path: '/about', element: <AboutPage /> },
+ { path: '/privacy', element: <PrivacyPage brand="Sync/Study" supportEmail="support@sync-study.com" /> },
+ { path: '/terms', element: <TermsPage brand="Sync/Study" supportEmail="support@sync-study.com" /> },
+ { path: '/report', element: <SyncStudyReportProblemPage /> },
```

Keep the `/enroll/parent` and `/forgot-password` `StaticPage` entries as-is (out of scope).

- [ ] **Step 3: Verify build + typecheck**

Run: `pnpm --filter study-web build && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(study-web): wire Privacy/Terms/Report/About to shared components"
```

---

## Task 11: Smoke + final verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: PASS — including new shared-ui page tests.

- [ ] **Step 2: Run both builds**

Run: `pnpm --filter web build && pnpm --filter study-web build`
Expected: PASS.

- [ ] **Step 3: Smoke sync-sit pages**

- Start dev: `pnpm --filter web dev` (port 5173)
- Navigate to `/about` → see About heading + body
- Navigate to `/privacy` → see "Sync/Sit is operated by Tandy SARL" in §1 with `support@sync-sit.com`
- Navigate to `/terms` → see brand interpolation in §1
- Navigate to `/report` → mailto link points to `mailto:support@sync-sit.com` and body includes user ID (when authed) or "Not logged in" (when not)

- [ ] **Step 4: Smoke sync-study pages**

- Start dev: `pnpm --filter study-web dev` (port 5174)
- Same four routes — expect "Sync/Study" interpolation, `support@sync-study.com` mailto, sync-study About body

- [ ] **Step 5: Visual diff check**

Open `/privacy` on both apps side-by-side. Confirm: layout identical, only brand name + support email differ. Confirm: no "Sync/Sit" text leaked into sync-study and vice versa.

- [ ] **Step 6: User reads the rewritten Privacy + Terms copy**

This is the gate before merge. The implementer pastes the rewritten English Privacy + Terms sections in chat for the user to review. User approves or sends back edits.

- [ ] **Step 7: Create PR**

```bash
gh pr create --title "Shared static pages: Privacy / Terms / Report / About" --body "..."
```

PR body includes: scope summary, links to the rewritten copy commits, screenshots from steps 3-4.

---

## Test coverage analysis

- **Covered:** Brand interpolation correctness (PrivacyPage, ReportProblemPage), section count (PrivacyPage), userId fallback (ReportProblemPage), AboutPageShell renders title + children.
- **Not covered:** Visual layout regressions (requires screenshot diffs — not in scope), French translation correctness (translation accuracy is a human-review concern, not unit-testable), the rewritten legal copy's compliance/legal soundness (requires user/counsel review per Step 6).
- **Gaps the implementer should flag:** if Card / InfoBanner / Button / MailIcon imports don't resolve cleanly inside `pages/`, the tests catch it. If react-router's `BrowserRouter` integration in shared-ui has any surprises, tests catch it.

## Security risks

- Brand-name interpolation uses a regex on `{{varName}}` placeholders. The brand and supportEmail strings come from the router config (compile-time constants), not user input, so XSS via interpolation is not a real attack surface. Tests cover the interpolation explicitly.
- `mailto:` link encoding uses `encodeURIComponent` — unchanged from sync-sit's current impl. No new exposure.
- `errorCapture` moves files but its behavior is unchanged (localStorage, no network). No new risk.

## Future upgrades / refactoring

- Plan C (shared public auth pages) follows next. Same extraction pattern; LoginPage will be the most complex due to role-based routing.
- The `interpolate` helper currently lives inline in PrivacyPage. If TermsPage and ReportProblemPage both end up using the same helper, move to `packages/shared-ui/src/pages/_shared/interpolate.ts` (do this in Task 5 if convenient).
- Long-term: legal copy in TypeScript arrays is awkward to diff. If/when the copy needs frequent legal-review cycles, consider extracting to `.md` files in `packages/shared-core/content/legal/` and rendering via `react-markdown`. Not worth doing yet.
- After Plan D (portable user entity) lands, `userId` for ReportProblemPage will come from the same shared auth context; the per-app router adapter goes away.
