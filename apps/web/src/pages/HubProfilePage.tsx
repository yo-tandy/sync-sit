import { Navigate } from 'react-router';
import { getSitRole } from '@ejm/sit-core';
import { useAuthStore } from '@/stores/authStore';
import { AccountPage } from '@/pages/family/AccountPage';
import { BabysitterAccountPage } from '@/pages/babysitter/AccountPage';

/**
 * The hub's "My account" row (`HUB_PATHS.profile`). One hub path, two
 * profile pages: the parent's and the student's are different components in
 * sit, so the sit role picks which one renders. A member with no sit role
 * has no sit profile page -- the hub does not show them the row, and a
 * typed URL goes back to the hub rather than to a portal that would bounce.
 */
export function HubProfilePage() {
  const userDoc = useAuthStore((s) => s.userDoc);
  const role = userDoc ? getSitRole(userDoc) : null;
  if (role === 'parent') return <AccountPage />;
  if (role === 'babysitter') return <BabysitterAccountPage />;
  return <Navigate to="/account" replace />;
}
