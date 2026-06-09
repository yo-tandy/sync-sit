import { createBrowserRouter, Navigate } from 'react-router';

// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';

// Public pages
import { WelcomePage } from '@/pages/public/WelcomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { SignUpRolePage } from '@/pages/public/SignUpRolePage';
import { StaticPage } from '@/pages/public/StaticPage';

// Enrollment
import { TutorEnrollment } from '@/pages/enrollment/tutor/TutorEnrollment';
import { TutorSuccessPage } from '@/pages/enrollment/tutor/TutorSuccessPage';

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignUpRolePage /> },
      { path: '/enroll/tutor', element: <TutorEnrollment /> },
      { path: '/enroll/tutor/success', element: <TutorSuccessPage /> },
      { path: '/about', element: <StaticPage titleKey="welcome.about" /> },
      { path: '/privacy', element: <StaticPage titleKey="welcome.privacy" /> },
      { path: '/terms', element: <StaticPage titleKey="welcome.terms" /> },
      { path: '/report', element: <StaticPage titleKey="welcome.help" /> },
      { path: '/enroll/parent', element: <StaticPage titleKey="welcome.signUpParent" /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
