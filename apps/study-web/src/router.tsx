import { createBrowserRouter, Navigate } from 'react-router';
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';

// Layouts stay EAGER — the shell (AuthGuard, app bars) renders on every route, so
// deferring it would only put a spinner in front of itself.
import { PublicLayout } from '@/layouts/PublicLayout';
import { TutorLayout } from '@/layouts/TutorLayout';
import { FamilyLayout } from '@/layouts/FamilyLayout';

// Route pages are code-split — each is a lazy() dynamic import (its own chunk,
// fetched on first visit). Defined in a dedicated module so this file exports
// only `router` (no component definitions), keeping fast-refresh happy. The
// Suspense fallback lives in each layout (around <Outlet>).
import {
  WelcomePage,
  LoginPage,
  SignUpRolePage,
  AboutPage,
  ForgotPasswordPage,
  ReportProblemPage,
  SharePage,
  AddToHomescreenPage,
  TutorEnrollment,
  TutorSuccessPage,
  ParentEnrollment,
  TutorDashboardPage,
  TutorAccountPage,
  SubjectsPage,
  TutorAreaPage,
  SchedulePage,
  TutorRequestsPage,
  TutorFamiliesPage,
  TutorPublishedSearchesPage,
  TutorEndorsementsPage,
  TutorSessionsPage,
  TutorProposeSessionPage,
  FamilyDashboardPage,
  FamilyAccountPage,
  FamilySettingsPage,
  FamilySearchPage,
  FamilyRequestsPage,
  FamilySubmittedEndorsementsPage,
  BookSessionPage,
  FamilySessionsPage,
  GovernancePage,
  GovernedChildPage,
  CreateKidInvitePage,
  FamilyVerificationPage,
  SupervisionAgreementPage,
  AdminInfoPage,
  SupervisionInfoPage,
  HandoffPage,
  CrossAppWelcomePage,
  NotificationsPage,
} from '@/lazyPages';

const SUPPORT_EMAIL = 'support@sync-study.com';
const BRAND = 'Sync/Study';

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignUpRolePage /> },
      { path: '/enroll/tutor', element: <TutorEnrollment /> },
      { path: '/enroll/tutor/success', element: <TutorSuccessPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/privacy', element: <PrivacyPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/terms', element: <TermsPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/report', element: <ReportProblemPage /> },
      { path: '/enroll/parent', element: <ParentEnrollment /> },
      { path: '/share', element: <SharePage /> },
      { path: '/install', element: <AddToHomescreenPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/supervision-agreement', element: <SupervisionAgreementPage /> },
      { path: '/admin', element: <AdminInfoPage /> },
      { path: '/supervision-info', element: <SupervisionInfoPage /> },
      // PUBLIC by design: arrival point of the cross-app switch — the one-time
      // fragment code is the capability; the page signs the user in itself.
      { path: '/handoff', element: <HandoffPage /> },
      { path: '/welcome-study', element: <CrossAppWelcomePage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  {
    element: <TutorLayout />,
    children: [
      { path: '/tutor', element: <TutorDashboardPage /> },
      { path: '/tutor/account', element: <TutorAccountPage /> },
      { path: '/tutor/subjects', element: <SubjectsPage /> },
      { path: '/tutor/area', element: <TutorAreaPage /> },
      { path: '/tutor/schedule', element: <SchedulePage /> },
      { path: '/tutor/requests', element: <TutorRequestsPage /> },
      { path: '/tutor/families', element: <TutorFamiliesPage /> },
      { path: '/tutor/published-searches', element: <TutorPublishedSearchesPage /> },
      { path: '/tutor/sessions', element: <TutorSessionsPage /> },
      { path: '/tutor/propose/:familyId', element: <TutorProposeSessionPage /> },
      { path: '/tutor/endorsements', element: <TutorEndorsementsPage /> },
      { path: '/tutor/notifications', element: <NotificationsPage /> },
    ],
  },
  {
    element: <FamilyLayout />,
    children: [
      { path: '/family', element: <FamilyDashboardPage /> },
      { path: '/family/account', element: <FamilyAccountPage /> },
      { path: '/family/settings', element: <FamilySettingsPage /> },
      { path: '/family/search', element: <FamilySearchPage /> },
      { path: '/family/requests', element: <FamilyRequestsPage /> },
      { path: '/family/endorsements', element: <FamilySubmittedEndorsementsPage /> },
      { path: '/family/verification', element: <FamilyVerificationPage /> },
      { path: '/family/sessions', element: <FamilySessionsPage /> },
      { path: '/family/book/:tutorUserId', element: <BookSessionPage /> },
      { path: '/family/governance', element: <GovernancePage /> },
      // Static 'new' outranks the :childUid dynamic segment (route ranking).
      { path: '/family/governance/new', element: <CreateKidInvitePage /> },
      { path: '/family/governance/:childUid', element: <GovernedChildPage /> },
      { path: '/family/notifications', element: <NotificationsPage /> },
    ],
  },
]);
