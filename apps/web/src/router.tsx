import { createBrowserRouter } from 'react-router';

// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';
import { BabysitterLayout } from '@/layouts/BabysitterLayout';
import { FamilyLayout } from '@/layouts/FamilyLayout';

// Public pages
import { WelcomePage } from '@/pages/public/WelcomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage';
import { AboutPage } from '@/pages/public/AboutPage';
import { PrivacyPage } from '@/pages/public/PrivacyPage';
import { TermsPage } from '@/pages/public/TermsPage';
import { ReportProblemPage } from '@/pages/public/ReportProblemPage';
import { SharePage } from '@/pages/public/SharePage';

// Enrollment
import { BabysitterEnrollment } from '@/pages/enrollment/BabysitterEnrollment';
import { ParentEnrollment } from '@/pages/enrollment/ParentEnrollment';
import { JoinFamilyPage } from '@/pages/enrollment/JoinFamilyPage';

// Portal dashboards
import { BabysitterDashboard } from '@/pages/babysitter/DashboardPage';
import { ProfilePage } from '@/pages/babysitter/ProfilePage';
import { SchedulePage } from '@/pages/babysitter/SchedulePage';
import { ReferencesPage } from '@/pages/babysitter/ReferencesPage';
import { RequestDetailPage } from '@/pages/babysitter/RequestDetailPage';
import { NotificationPrefsPage } from '@/pages/babysitter/NotificationPrefsPage';
import { FamilyDashboard } from '@/pages/family/DashboardPage';
import { FamilySettingsPage } from '@/pages/family/FamilySettingsPage';
import { InvitePage } from '@/pages/family/InvitePage';
import { SubmittedReferencesPage } from '@/pages/family/SubmittedReferencesPage';
import { SearchPage } from '@/pages/family/SearchPage';

export const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/report', element: <ReportProblemPage /> },
      { path: '/enroll/babysitter', element: <BabysitterEnrollment /> },
      { path: '/enroll/parent', element: <ParentEnrollment /> },
      { path: '/invite/:token', element: <JoinFamilyPage /> },
    ],
  },

  // Babysitter portal (auth + role guard)
  {
    element: <BabysitterLayout />,
    children: [
      { path: '/babysitter', element: <BabysitterDashboard /> },
      { path: '/babysitter/profile', element: <ProfilePage /> },
      { path: '/babysitter/schedule', element: <SchedulePage /> },
      { path: '/babysitter/references', element: <ReferencesPage /> },
      { path: '/babysitter/request/:appointmentId', element: <RequestDetailPage /> },
      { path: '/babysitter/settings', element: <NotificationPrefsPage /> },
    ],
  },

  // Family portal (auth + role guard)
  {
    element: <FamilyLayout />,
    children: [
      { path: '/family', element: <FamilyDashboard /> },
      { path: '/family/settings', element: <FamilySettingsPage /> },
      { path: '/family/invite', element: <InvitePage /> },
      { path: '/family/references', element: <SubmittedReferencesPage /> },
      { path: '/family/search', element: <SearchPage /> },
      { path: '/family/settings/preferences', element: <NotificationPrefsPage /> },
    ],
  },

  // TODO Phase 7: Admin portal routes
]);
