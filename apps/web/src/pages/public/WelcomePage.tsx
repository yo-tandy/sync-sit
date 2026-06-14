import { useAuthStore } from '@/stores/authStore';
import { getSitRole, getBabysitterProfile } from '@ejm/sit-core';
import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';

function computeRedirect(userDoc: ReturnType<typeof useAuthStore.getState>['userDoc']): string | null {
  if (!userDoc) return null;
  const role = getSitRole(userDoc);
  if (role === 'babysitter') {
    return getBabysitterProfile(userDoc)?.enrollmentComplete === false ? '/enroll/babysitter' : '/babysitter';
  }
  if (role === 'parent') return '/family';
  if (role === 'admin') return '/admin';
  return null;
}

export function WelcomePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  const redirectPath = firebaseUser && userDoc ? computeRedirect(userDoc) : null;
  return <SharedWelcomePage logoSrc="/logo.png" logoAlt="Sync/Sit" authLoading={loading} redirectPath={redirectPath} />;
}
