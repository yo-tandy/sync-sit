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
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';
import { BRAND, SUPPORT_EMAIL } from '@/constants/brand';
import { SyncSitReportProblemPage } from '@/pages/public/SyncSitReportProblemPage';

import { SharePage } from '@/pages/public/SharePage';
import { SignUpRolePage } from '@/pages/public/SignUpRolePage';
import { ParentGuidePage } from '@/pages/public/ParentGuidePage';
import { BabysitterGuidePage } from '@/pages/public/BabysitterGuidePage';
import { AddToHomescreenPage } from '@/pages/public/AddToHomescreenPage';
import { KidInvitePage } from '@/pages/public/KidInvitePage';
import { HandoffPage } from '@/pages/public/HandoffPage';
import { CrossAppWelcomePage } from '@/pages/public/CrossAppWelcomePage';
import { SupervisionInfoPage } from '@/pages/public/SupervisionInfoPage';
import { SupervisionAgreementPage } from '@/pages/public/SupervisionAgreementPage';

// Enrollment
import { BabysitterEnrollment } from '@/pages/enrollment/BabysitterEnrollment';
import { ParentEnrollment } from '@/pages/enrollment/ParentEnrollment';
import { JoinFamilyPage } from '@/pages/enrollment/JoinFamilyPage';

// Portal dashboards
import { BabysitterDashboard } from '@/pages/babysitter/DashboardPage';
import { BabysitterAccountPage } from '@/pages/babysitter/AccountPage';
import { BabysittingOptionsPage } from '@/pages/babysitter/BabysittingOptionsPage';
import { SchedulePage } from '@/pages/babysitter/SchedulePage';
import { EndorsementsPage } from '@/pages/babysitter/EndorsementsPage';
import { FamiliesPage } from '@/pages/babysitter/FamiliesPage';
import { PublishedSearchesPage } from '@/pages/babysitter/PublishedSearchesPage';
import { RequestDetailPage } from '@/pages/babysitter/RequestDetailPage';
import { FamilyDashboard } from '@/pages/family/DashboardPage';
import { FamilySettingsPage } from '@/pages/family/FamilySettingsPage';
import { InvitePage } from '@/pages/family/InvitePage';
import { SubmittedEndorsementsPage } from '@/pages/family/SubmittedEndorsementsPage';
import { SearchPage } from '@/pages/family/SearchPage';
import { VerificationPage } from '@/pages/family/VerificationPage';
import { AccountPage } from '@/pages/family/AccountPage';
import { PreferredBabysittersPage } from '@/pages/family/PreferredBabysittersPage';
import { GovernancePage } from '@/pages/family/GovernancePage';
import { CreateKidInvitePage } from '@/pages/family/CreateKidInvitePage';
import { GovernedChildPage } from '@/pages/family/GovernedChildPage';
import { NotificationsPage } from '@/pages/NotificationsPage';

// Admin pages
import { AdminDashboard } from '@/pages/admin/DashboardPage';
import { AdminUsersPage } from '@/pages/admin/UsersPage';
import { AdminEnrollmentAccessPage } from '@/pages/admin/EnrollmentAccessPage';
import { AdminFamiliesPage } from '@/pages/admin/FamiliesPage';
import { AdminAppointmentsPage } from '@/pages/admin/AppointmentsPage';
import { AdminHolidaysPage } from '@/pages/admin/HolidaysPage';
import { AdminConfigurationPage } from '@/pages/admin/ConfigurationPage';
import { AdminAuditLogPage } from '@/pages/admin/AuditLogPage';
import { AdminGdprExportPage } from '@/pages/admin/GdprExportPage';
import { AdminVerificationsPage } from '@/pages/admin/VerificationsPage';
import { AdminGovernancePage } from '@/pages/admin/GovernancePage';

export const router = createBrowserRouter([
  // Public routes
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignUpRolePage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/privacy', element: <PrivacyPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/terms', element: <TermsPage brand={BRAND} supportEmail={SUPPORT_EMAIL} /> },
      { path: '/report', element: <SyncSitReportProblemPage /> },
      { path: '/share', element: <SharePage /> },
      { path: '/guide/parents', element: <ParentGuidePage /> },
      { path: '/guide/babysitters', element: <BabysitterGuidePage /> },
      { path: '/install', element: <AddToHomescreenPage /> },
      { path: '/enroll/babysitter', element: <BabysitterEnrollment /> },
      { path: '/enroll/parent', element: <ParentEnrollment /> },
      { path: '/invite/:token', element: <JoinFamilyPage /> },
      // PUBLIC by design: the kid redeems with the emailed token, no account yet.
      { path: '/kid-invite', element: <KidInvitePage /> },
      // PUBLIC by design: arrival point of the cross-app switch — the one-time
      // fragment code is the capability; the page signs the user in itself.
      { path: '/handoff', element: <HandoffPage /> },
      { path: '/welcome-sit', element: <CrossAppWelcomePage /> },
      { path: '/supervision-info', element: <SupervisionInfoPage /> },
      { path: '/supervision-agreement', element: <SupervisionAgreementPage /> },
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
      { path: '/babysitter/endorsements', element: <EndorsementsPage /> },
      { path: '/babysitter/families', element: <FamiliesPage /> },
      { path: '/babysitter/references', element: <Navigate to="/babysitter/endorsements" replace /> },
      { path: '/babysitter/published-searches', element: <PublishedSearchesPage /> },
      { path: '/babysitter/request/:appointmentId', element: <RequestDetailPage /> },
      { path: '/babysitter/notifications', element: <NotificationsPage /> },
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
      { path: '/family/endorsements', element: <SubmittedEndorsementsPage /> },
      { path: '/family/references', element: <Navigate to="/family/endorsements" replace /> },
      { path: '/family/search', element: <SearchPage /> },
      { path: '/family/preferred', element: <PreferredBabysittersPage /> },
      { path: '/family/account', element: <AccountPage /> },
      { path: '/family/verification', element: <VerificationPage /> },
      { path: '/family/governance', element: <GovernancePage /> },
      { path: '/family/governance/new', element: <CreateKidInvitePage /> },
      { path: '/family/governance/:childUid', element: <GovernedChildPage /> },
      { path: '/family/notifications', element: <NotificationsPage /> },
    ],
  },

  // Admin portal (auth + role guard)
  {
    element: <AdminLayout />,
    children: [
      { path: '/admin', element: <AdminDashboard /> },
      { path: '/admin/users', element: <AdminUsersPage /> },
      { path: '/admin/enrollment-access', element: <AdminEnrollmentAccessPage /> },
      { path: '/admin/families', element: <AdminFamiliesPage /> },
      { path: '/admin/appointments', element: <AdminAppointmentsPage /> },
      { path: '/admin/holidays', element: <AdminHolidaysPage /> },
      { path: '/admin/configuration', element: <AdminConfigurationPage /> },
      { path: '/admin/audit-log', element: <AdminAuditLogPage /> },
      { path: '/admin/gdpr-export', element: <AdminGdprExportPage /> },
      { path: '/admin/verifications', element: <AdminVerificationsPage /> },
      { path: '/admin/governance', element: <AdminGovernancePage /> },
      { path: '/admin/notifications', element: <NotificationsPage /> },
    ],
  },
]);
