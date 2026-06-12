import { useAuthStore } from '@/stores/authStore';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';

function computeRedirect(userDoc: ReturnType<typeof useAuthStore.getState>['userDoc']): string | null {
  if (!userDoc) return null;
  if (userDoc.role === 'babysitter') {
    return userDoc.enrollmentComplete === false ? '/enroll/babysitter' : '/babysitter';
  }
  if (userDoc.role === 'parent') return '/family';
  if (userDoc.role === 'admin') return '/admin';
  return null;
}

export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const redirectPath = firebaseUser && userDoc ? computeRedirect(userDoc) : null;
  return <SharedWelcomePage logoSrc="/logo.png" logoAlt="Sync/Sit" authLoading={loading} redirectPath={redirectPath} />;
}
