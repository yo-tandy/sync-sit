import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';

const ROLES: SignUpRoleOption[] = [
  { key: 'babysitter', labelKey: 'welcome.signUpBabysitter', descKey: 'welcome.signUpBabysitterDesc', icon: UserIcon, href: '/enroll/babysitter' },
  { key: 'parent', labelKey: 'welcome.signUpParent', descKey: 'welcome.signUpParentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

export function SignUpRolePage() {
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Sit" roles={ROLES} />;
}
