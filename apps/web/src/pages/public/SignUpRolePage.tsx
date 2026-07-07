import { useTranslation } from 'react-i18next';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { getSitRole } from '@ejm/sit-core';
import { useAuthStore } from '@/stores/authStore';

const ROLES: SignUpRoleOption[] = [
  { key: 'babysitter', labelKey: 'welcome.signUpBabysitter', descKey: 'welcome.signUpBabysitterDesc', icon: UserIcon, href: '/enroll/babysitter' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  const { t } = useTranslation();
  const { firebaseUser, userDoc } = useAuthStore();
  // Signed-in user with no sit role (arrived here from cross-app routing) —
  // show a banner explaining they're adding a role to an existing account.
  const role = getSitRole(userDoc);
  const banner = firebaseUser && !role ? t('signup.crossAppBanner') : undefined;

  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Sit" roles={ROLES} banner={banner} />;
}
