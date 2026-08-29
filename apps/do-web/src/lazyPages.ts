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

// Doer portal (plan §13 PR8) — the board at /home is the app's home
// screen (§9.2).
export const BoardPage = lazy(() =>
  import('@/pages/doer/BoardPage').then((m) => ({ default: m.BoardPage })),
);
export const DoerTaskDetailPage = lazy(() =>
  import('@/pages/doer/DoerTaskDetailPage').then((m) => ({ default: m.DoerTaskDetailPage })),
);
export const OfferPage = lazy(() =>
  import('@/pages/doer/OfferPage').then((m) => ({ default: m.OfferPage })),
);
export const MyOffersPage = lazy(() =>
  import('@/pages/doer/MyOffersPage').then((m) => ({ default: m.MyOffersPage })),
);
export const MyWorkPage = lazy(() =>
  import('@/pages/doer/MyWorkPage').then((m) => ({ default: m.MyWorkPage })),
);
export const MyEndorsementsPage = lazy(() =>
  import('@/pages/doer/MyEndorsementsPage').then((m) => ({ default: m.MyEndorsementsPage })),
);

// Family portal (plan §13 PR7)
export const MyTasksPage = lazy(() =>
  import('@/pages/family/MyTasksPage').then((m) => ({ default: m.MyTasksPage })),
);
export const PostTaskPage = lazy(() =>
  import('@/pages/family/post/PostTaskPage').then((m) => ({ default: m.PostTaskPage })),
);
export const TaskDetailPage = lazy(() =>
  import('@/pages/family/TaskDetailPage').then((m) => ({ default: m.TaskDetailPage })),
);
