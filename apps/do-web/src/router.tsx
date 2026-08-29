import { createBrowserRouter, Navigate } from 'react-router';
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';

// Layouts stay EAGER — the shell (AuthGuard, chrome) renders on every route,
// so deferring it would only put a spinner in front of itself.
import { PublicLayout } from '@/layouts/PublicLayout';
import { DoerLayout } from '@/layouts/DoerLayout';
import { FamilyLayout } from '@/layouts/FamilyLayout';

// Route pages are code-split — each is a lazy() dynamic import (its own
// chunk, fetched on first visit). See lazyPages.ts.
import {
  WelcomePage,
  LoginPage,
  SignUpRolePage,
  ForgotPasswordPage,
  AboutPage,
  ReportProblemPage,
  ComingSoonPage,
  DoerEnrollment,
  BoardPage,
  DoerTaskDetailPage,
  OfferPage,
  MyOffersPage,
  MyWorkPage,
  MyTasksPage,
  PostTaskPage,
  TaskDetailPage,
} from '@/lazyPages';
import { BRAND, SUPPORT_EMAIL } from '@/constants/brand';

// NOTE (copy accuracy): the shared Privacy/Terms copy is written for the
// sit product and needs the suite-wide rewrite tracked as issue #308 before
// the brand-prop substitution reads correctly for sync-do. Wired regardless
// so the shell's footer links resolve (plan §12).
export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignUpRolePage /> },
      { path: '/enroll/doer', element: <DoerEnrollment /> },
      // Parent enrollment stays a placeholder until the family UI PR
      // (plan §13 PR7; see ComingSoonPage).
      { path: '/enroll/parent', element: <ComingSoonPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/privacy', element: <PrivacyPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/terms', element: <TermsPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/report', element: <ReportProblemPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  {
    // Doer portal (plan §13 PR8): the board at /home is the app's home
    // screen (§9.2); routes sit behind the doer-role guard in DoerLayout.
    element: <DoerLayout />,
    children: [
      { path: '/home', element: <BoardPage /> },
      { path: '/tasks/:taskId', element: <DoerTaskDetailPage /> },
      { path: '/tasks/:taskId/offer', element: <OfferPage /> },
      { path: '/offers', element: <MyOffersPage /> },
      { path: '/work', element: <MyWorkPage /> },
    ],
  },
  {
    element: <FamilyLayout />,
    children: [
      { path: '/family', element: <MyTasksPage /> },
      { path: '/family/post', element: <PostTaskPage /> },
      { path: '/family/tasks/:taskId', element: <TaskDetailPage /> },
    ],
  },
]);
