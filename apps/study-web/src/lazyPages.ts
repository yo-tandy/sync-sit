import { lazy } from 'react';

/**
 * Route-level code-split page components. Each is a dynamic import(), so its JS
 * becomes a separate chunk fetched only when its route is visited — this carves
 * the heavy portal/enrollment pages out of the initial bundle. Each lazy() infers
 * the page's own prop types from its import.
 *
 * These live apart from router.tsx so that file exports only the `router` object
 * (no component definitions) and router.tsx stays clean for fast-refresh; this
 * module in turn exports only components. The Suspense fallback lives in each
 * layout (around <Outlet>).
 */

// Public
export const WelcomePage = lazy(() =>
  import('@/pages/public/WelcomePage').then((m) => ({ default: m.WelcomePage })),
);
export const LoginPage = lazy(() =>
  import('@/pages/public/LoginPage').then((m) => ({ default: m.LoginPage })),
);
export const SignUpRolePage = lazy(() =>
  import('@/pages/public/SignUpRolePage').then((m) => ({ default: m.SignUpRolePage })),
);
export const StaticPage = lazy(() =>
  import('@/pages/public/StaticPage').then((m) => ({ default: m.StaticPage })),
);
export const AboutPage = lazy(() =>
  import('@/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })),
);
export const ForgotPasswordPage = lazy(() =>
  import('@/pages/public/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
export const ReportProblemPage = lazy(() =>
  import('@/pages/public/ReportProblemPage').then((m) => ({ default: m.ReportProblemPage })),
);

// Enrollment (wizard — heavy)
export const TutorEnrollment = lazy(() =>
  import('@/pages/enrollment/tutor/TutorEnrollment').then((m) => ({ default: m.TutorEnrollment })),
);
export const TutorSuccessPage = lazy(() =>
  import('@/pages/enrollment/tutor/TutorSuccessPage').then((m) => ({
    default: m.TutorSuccessPage,
  })),
);

// Tutor portal
export const TutorDashboardPage = lazy(() =>
  import('@/pages/tutor/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
export const TutorAccountPage = lazy(() =>
  import('@/pages/tutor/AccountPage').then((m) => ({ default: m.AccountPage })),
);
export const SubjectsPage = lazy(() =>
  import('@/pages/tutor/SubjectsPage').then((m) => ({ default: m.SubjectsPage })),
);
export const TutorAreaPage = lazy(() =>
  import('@/pages/tutor/AreaPage').then((m) => ({ default: m.AreaPage })),
);
export const SchedulePage = lazy(() =>
  import('@/pages/tutor/SchedulePage').then((m) => ({ default: m.SchedulePage })),
);
export const VerificationPage = lazy(() =>
  import('@/pages/tutor/VerificationPage').then((m) => ({ default: m.VerificationPage })),
);
export const TutorRequestsPage = lazy(() =>
  import('@/pages/tutor/RequestsPage').then((m) => ({ default: m.RequestsPage })),
);
export const TutorEndorsementsPage = lazy(() =>
  import('@/pages/tutor/EndorsementsPage').then((m) => ({ default: m.EndorsementsPage })),
);
export const TutorSessionsPage = lazy(() =>
  import('@/pages/tutor/SessionsPage').then((m) => ({ default: m.SessionsPage })),
);
export const TutorProposeSessionPage = lazy(() =>
  import('@/pages/tutor/ProposeSessionPage').then((m) => ({ default: m.ProposeSessionPage })),
);

// Family portal
export const FamilyDashboardPage = lazy(() =>
  import('@/pages/family/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
export const FamilyAccountPage = lazy(() =>
  import('@/pages/family/AccountPage').then((m) => ({ default: m.AccountPage })),
);
export const FamilySettingsPage = lazy(() =>
  import('@/pages/family/FamilySettingsPage').then((m) => ({ default: m.FamilySettingsPage })),
);
export const FamilySearchPage = lazy(() =>
  import('@/pages/family/SearchPage').then((m) => ({ default: m.SearchPage })),
);
export const FamilyRequestsPage = lazy(() =>
  import('@/pages/family/RequestsPage').then((m) => ({ default: m.RequestsPage })),
);
export const BookSessionPage = lazy(() =>
  import('@/pages/family/BookSessionPage').then((m) => ({ default: m.BookSessionPage })),
);
export const FamilySessionsPage = lazy(() =>
  import('@/pages/family/SessionsPage').then((m) => ({ default: m.SessionsPage })),
);
export const GovernancePage = lazy(() =>
  import('@/pages/family/GovernancePage').then((m) => ({ default: m.GovernancePage })),
);
export const GovernedChildPage = lazy(() =>
  import('@/pages/family/GovernedChildPage').then((m) => ({ default: m.GovernedChildPage })),
);
export const CreateKidInvitePage = lazy(() =>
  import('@/pages/family/CreateKidInvitePage').then((m) => ({ default: m.CreateKidInvitePage })),
);

// Public governance documents
export const HandoffPage = lazy(() =>
  import('@/pages/public/HandoffPage').then((m) => ({ default: m.HandoffPage })),
);
export const CrossAppWelcomePage = lazy(() =>
  import('@/pages/public/CrossAppWelcomePage').then((m) => ({ default: m.CrossAppWelcomePage })),
);
export const SupervisionAgreementPage = lazy(() =>
  import('@/pages/public/SupervisionAgreementPage').then((m) => ({
    default: m.SupervisionAgreementPage,
  })),
);
export const SupervisionInfoPage = lazy(() =>
  import('@/pages/public/SupervisionInfoPage').then((m) => ({ default: m.SupervisionInfoPage })),
);

export const AdminInfoPage = lazy(() =>
  import('@/pages/public/AdminInfoPage').then((m) => ({
    default: m.AdminInfoPage,
  })),
);
