import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';

const ROLES: SignUpRoleOption[] = [
  { key: 'tutor', labelKey: 'welcome.signUpTutor', descKey: 'welcome.signUpTutorDesc', icon: UserIcon, href: '/enroll/tutor' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Study" roles={ROLES} />;
}
