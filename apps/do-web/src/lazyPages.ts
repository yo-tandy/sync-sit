import { lazy } from 'react';

/**
 * Route-level code-split page components (mirrors apps/study-web/src/
 * lazyPages.ts): each is a dynamic import(), its own chunk fetched on first
 * visit. These live apart from router.tsx so that file exports only the
 * `router` object (fast-refresh) and this module exports only components.
 * The Suspense fallback lives in each layout (around <Outlet>).
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
export const ForgotPasswordPage = lazy(() =>
  import('@/pages/public/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
export const AboutPage = lazy(() =>
  import('@/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })),
);
export const ReportProblemPage = lazy(() =>
  import('@/pages/public/ReportProblemPage').then((m) => ({ default: m.ReportProblemPage })),
);
export const ComingSoonPage = lazy(() =>
  import('@/pages/public/ComingSoonPage').then((m) => ({ default: m.ComingSoonPage })),
);

// Enrollment
export const DoerEnrollment = lazy(() =>
  import('@/pages/enrollment/doer/DoerEnrollment').then((m) => ({ default: m.DoerEnrollment })),
);

// Authenticated shell
export const HomePage = lazy(() =>
  import('@/pages/home/HomePage').then((m) => ({ default: m.HomePage })),
);

// Family portal (plan §13 PR7)
export const MyTasksPage = lazy(() =>
  import('@/pages/family/MyTasksPage').then((m) => ({ default: m.MyTasksPage })),
);
