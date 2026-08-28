import { Navigate } from 'react-router';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/utils/postLoginRouter';
import { getDoRole } from '@/utils/doRole';

const ROLES: SignUpRoleOption[] = [
  { key: 'doer', labelKey: 'welcome.signUpDoer', descKey: 'welcome.signUpDoerDesc', icon: UserIcon, href: '/enroll/doer' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

/**
 * Role selection, shell edition: both role cards lead to the coming-soon
 * placeholder until enrollment lands (plan §13 PR4). The cross-app banner
 * and sibling-profile short-circuits study-web runs here depend on the doer
 * role model, so they arrive with it.
 */
export function SignUpRolePage() {
  const { firebaseUser, userDoc, loading } = useAuthStore();
  // A signed-in account WITH a sync-do role has nothing to sign up for —
  // send it to its portal. An account with NO role (a sit/study parent or
  // student arriving cross-app) stays: this page is where a role gets
  // added, and the family AuthGuard's no-role fallback lands here for
  // exactly that reason (plan §13 PR7).
  if (firebaseUser && !loading && getDoRole(userDoc)) {
    return <Navigate to={postLoginRouter(userDoc)} replace />;
  }
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Do" roles={ROLES} />;
}
