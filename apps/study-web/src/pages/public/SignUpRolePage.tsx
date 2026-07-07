import { useTranslation } from 'react-i18next';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { getStudyRole } from '@ejm/study-core';
import { useAuthStore } from '@/stores/authStore';

const ROLES: SignUpRoleOption[] = [
  { key: 'tutor', labelKey: 'welcome.signUpTutor', descKey: 'welcome.signUpTutorDesc', icon: UserIcon, href: '/enroll/tutor' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  const { t } = useTranslation();
  const { firebaseUser, userDoc } = useAuthStore();
  // Signed-in user with no study role (arrived here from cross-app routing) —
  // show a banner explaining they're adding a role to an existing account.
  const role = getStudyRole(userDoc);
  const banner = firebaseUser && !role ? t('signup.crossAppBanner') : undefined;

  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Study" roles={ROLES} banner={banner} />;
}
