import { createBrowserRouter, Navigate } from 'react-router';

// Layouts
import { PublicLayout } from '@/layouts/PublicLayout';

// Public pages
import { WelcomePage } from '@/pages/public/WelcomePage';
import { LoginPage } from '@/pages/public/LoginPage';
import { SignUpRolePage } from '@/pages/public/SignUpRolePage';

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
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
