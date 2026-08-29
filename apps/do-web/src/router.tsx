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
  DoerDashboardPage,
  BoardPage,
  DoerTaskDetailPage,
  OfferPage,
  MyOffersPage,
  MyWorkPage,
  MyEndorsementsPage,
  FamilyDashboardPage,
  MyTasksPage,
  PostTaskPage,
  TaskDetailPage,
} from '@/lazyPages';
import { LegacyDoerTaskRedirect } from '@/components/routing/LegacyDoerTaskRedirect';
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
    // Doer portal, namespaced under /doer/* (issue #296). §9.0 makes flow
    // parity with the siblings a build rule and both of them namespace the
    // provider portal — sit under /babysitter/*, study under /tutor/* — so
    // these routes moved off the root, where they were inconsistent with the
    // siblings AND with sync-do's own /family/*. Old paths still resolve; see
    // the legacy branch at the bottom of this table. Behind the doer-role
    // guard in DoerLayout.
    element: <DoerLayout />,
    children: [
      // The portal index is the DASHBOARD (§9.0's route table, issue #360) —
      // sit's /babysitter and study's /tutor shape. It replaced the temporary
      // forward to /doer/board that the namespace move (issue #296) left
      // here; the board keeps its own path and the dashboard's quick action
      // links to it.
      { path: '/doer', element: <DoerDashboardPage /> },
      { path: '/doer/board', element: <BoardPage /> },
      { path: '/doer/tasks/:taskId', element: <DoerTaskDetailPage /> },
      { path: '/doer/tasks/:taskId/offer', element: <OfferPage /> },
      { path: '/doer/offers', element: <MyOffersPage /> },
      { path: '/doer/work', element: <MyWorkPage /> },
      { path: '/doer/endorsements', element: <MyEndorsementsPage /> },
    ],
  },
  {
    element: <FamilyLayout />,
    children: [
      // The portal index is the DASHBOARD (§9.0's route table, issue #360) —
      // sit's and study's /family shape. It replaced the temporary forward to
      // /family/tasks that the namespace move (issue #296) left here; the
      // LIST keeps /family/tasks (study names its family lists
      // /family/requests, /family/sessions; the task detail already nested
      // under this path).
      { path: '/family', element: <FamilyDashboardPage /> },
      { path: '/family/tasks', element: <MyTasksPage /> },
      { path: '/family/post', element: <PostTaskPage /> },
      { path: '/family/tasks/:taskId', element: <TaskDetailPage /> },
    ],
  },
  {
    // Pre-namespace doer paths (issue #296). The app is LIVE and PR9's
    // notification mail deep-links five of these, so every one of them keeps
    // resolving — mail already in inboxes must not 404. Pathless branch (no
    // layout, no guard): a redirect has nothing to render and nothing to
    // protect, and forwarding BEFORE the guard keeps the destination's own
    // guard the single place that decides who may see it.
    children: [
      { path: '/home', element: <Navigate to="/doer/board" replace /> },
      { path: '/offers', element: <Navigate to="/doer/offers" replace /> },
      { path: '/work', element: <Navigate to="/doer/work" replace /> },
      { path: '/endorsements', element: <Navigate to="/doer/endorsements" replace /> },
      { path: '/tasks/:taskId', element: <LegacyDoerTaskRedirect /> },
      { path: '/tasks/:taskId/offer', element: <LegacyDoerTaskRedirect suffix="/offer" /> },
    ],
  },
]);
