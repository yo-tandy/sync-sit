import { createBrowserRouter, Navigate } from 'react-router';

// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';
import { BabysitterLayout } from '@/layouts/BabysitterLayout';
import { FamilyLayout } from '@/layouts/FamilyLayout';
import { AdminLayout } from '@/layouts/AdminLayout';

// Public pages
import { WelcomePage } from '@/pages/public/WelcomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { ForgotPasswordPage } from '@/pages/public/ForgotPasswordPage';
import { AboutPage } from '@/pages/public/AboutPage';
import { PrivacyPage } from '@/pages/public/PrivacyPage';
import { TermsPage } from '@/pages/public/TermsPage';
import { ReportProblemPage } from '@/pages/public/ReportProblemPage';
import { SharePage } from '@/pages/public/SharePage';
import { ParentGuidePage } from '@/pages/public/ParentGuidePage';
import { BabysitterGuidePage } from '@/pages/public/BabysitterGuidePage';

// Enrollment
import { BabysitterEnrollment } from '@/pages/enrollment/BabysitterEnrollment';
import { ParentEnrollment } from '@/pages/enrollment/ParentEnrollment';
import { JoinFamilyPage } from '@/pages/enrollment/JoinFamilyPage';

// Portal dashboards
import { BabysitterDashboard } from '@/pages/babysitter/DashboardPage';
import { BabysitterAccountPage } from '@/pages/babysitter/AccountPage';
import { BabysittingOptionsPage } from '@/pages/babysitter/BabysittingOptionsPage';
import { SchedulePage } from '@/pages/babysitter/SchedulePage';
import { ReferencesPage } from '@/pages/babysitter/ReferencesPage';
import { RequestDetailPage } from '@/pages/babysitter/RequestDetailPage';
import { FamilyDashboard } from '@/pages/family/DashboardPage';
import { FamilySettingsPage } from '@/pages/family/FamilySettingsPage';
import { InvitePage } from '@/pages/family/InvitePage';
import { SubmittedReferencesPage } from '@/pages/family/SubmittedReferencesPage';
import { SearchPage } from '@/pages/family/SearchPage';
import { VerificationPage } from '@/pages/family/VerificationPage';
import { AccountPage } from '@/pages/family/AccountPage';
import { PreferredBabysittersPage } from '@/pages/family/PreferredBabysittersPage';

// Admin pages
import { AdminDashboard } from '@/pages/admin/DashboardPage';
import { AdminUsersPage } from '@/pages/admin/UsersPage';
import { AdminAppointmentsPage } from '@/pages/admin/AppointmentsPage';
import { AdminHolidaysPage } from '@/pages/admin/HolidaysPage';
import { AdminAuditLogPage } from '@/pages/admin/AuditLogPage';
import { AdminGdprExportPage } from '@/pages/admin/GdprExportPage';
import { AdminVerificationsPage } from '@/pages/admin/VerificationsPage';

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
      { path: '/share', element: <SharePage /> },
      { path: '/guide/parents', element: <ParentGuidePage /> },
      { path: '/guide/babysitters', element: <BabysitterGuidePage /> },
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
      { path: '/babysitter/account', element: <BabysitterAccountPage /> },
      { path: '/babysitter/options', element: <BabysittingOptionsPage /> },
      { path: '/babysitter/schedule', element: <SchedulePage /> },
      { path: '/babysitter/references', element: <ReferencesPage /> },
      { path: '/babysitter/request/:appointmentId', element: <RequestDetailPage /> },
      // Backward-compatible redirects
      { path: '/babysitter/profile', element: <Navigate to="/babysitter/options" replace /> },
      { path: '/babysitter/settings', element: <Navigate to="/babysitter/account" replace /> },
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
      { path: '/family/preferred', element: <PreferredBabysittersPage /> },
      { path: '/family/account', element: <AccountPage /> },
      { path: '/family/verification', element: <VerificationPage /> },
    ],
  },

  // Admin portal (auth + role guard)
  {
    element: <AdminLayout />,
    children: [
      { path: '/admin', element: <AdminDashboard /> },
      { path: '/admin/users', element: <AdminUsersPage /> },
      { path: '/admin/appointments', element: <AdminAppointmentsPage /> },
      { path: '/admin/holidays', element: <AdminHolidaysPage /> },
      { path: '/admin/audit-log', element: <AdminAuditLogPage /> },
      { path: '/admin/gdpr-export', element: <AdminGdprExportPage /> },
      { path: '/admin/verifications', element: <AdminVerificationsPage /> },
    ],
  },
]);
