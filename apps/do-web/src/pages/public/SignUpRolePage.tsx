import { Navigate } from 'react-router';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/utils/postLoginRouter';

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
  const { firebaseUser } = useAuthStore();
  // A signed-in account has nothing to sign up for in the shell — the
  // authenticated home explains where sync-do stands.
  if (firebaseUser) {
    return <Navigate to={postLoginRouter()} replace />;
  }
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Do" roles={ROLES} />;
}
