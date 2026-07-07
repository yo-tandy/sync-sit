import { createBrowserRouter, Navigate } from 'react-router';

// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';
import { TutorLayout } from '@/layouts/TutorLayout';

// Public pages
import { WelcomePage } from '@/pages/public/WelcomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { SignUpRolePage } from '@/pages/public/SignUpRolePage';
import { StaticPage } from '@/pages/public/StaticPage';
import { AboutPage } from '@/pages/public/AboutPage';
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage';
import { PrivacyPage, TermsPage, ReportProblemPage } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';

// Enrollment
import { TutorEnrollment } from '@/pages/enrollment/tutor/TutorEnrollment';
import { TutorSuccessPage } from '@/pages/enrollment/tutor/TutorSuccessPage';

// Tutor portal (stubs in this PR — real pages land in Tasks 2-5)
import { DashboardPage } from '@/pages/tutor/DashboardPage';
import { AccountPage } from '@/pages/tutor/AccountPage';
import { SubjectsPage } from '@/pages/tutor/SubjectsPage';
import { SchedulePage } from '@/pages/tutor/SchedulePage';
import { VerificationPage } from '@/pages/tutor/VerificationPage';

const SUPPORT_EMAIL = 'support@sync-study.com';
const BRAND = 'Sync/Study';

function SyncStudyReportProblemPage() {
  const { userDoc } = useAuthStore();
  return <ReportProblemPage brand={BRAND} supportEmail={SUPPORT_EMAIL} userId={userDoc?.uid} />;
}

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
      { path: '/report', element: <SyncStudyReportProblemPage /> },
      { path: '/enroll/parent', element: <StaticPage titleKey="welcome.signUpParent" /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
  {
    element: <TutorLayout />,
    children: [
      { path: '/tutor', element: <DashboardPage /> },
      { path: '/tutor/account', element: <AccountPage /> },
      { path: '/tutor/subjects', element: <SubjectsPage /> },
      { path: '/tutor/schedule', element: <SchedulePage /> },
      { path: '/tutor/verification', element: <VerificationPage /> },
    ],
  },
]);
