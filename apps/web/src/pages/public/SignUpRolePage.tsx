import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { isBabysitter, isParent, isTutor } from '@ejm/shared-core';
import { getSitRole } from '@ejm/sit-core';
import { postLoginRouter } from '@/lib/postLoginRouter';
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
  // Already enrolled here: nothing to sign up for — straight to the portal
  // (mirrors study; prevents the option-click-bounces-home loop).
  if (firebaseUser && role) {
    return <Navigate to={postLoginRouter(role, userDoc)} replace />;
  }
  // A study tutor never sees the role question here either (direct URL):
  // babysitting is the only sit offer for them — the welcome page handles it
  // in one tap (issue #144).
  if (firebaseUser && !role && isTutor(userDoc)) {
    return <Navigate to="/welcome-sit" replace />;
  }
  const banner = firebaseUser && !role ? t('signup.crossAppBanner') : undefined;

  // Provider (tutor or babysitter) and parent are mutually exclusive (issue
  // #116) — withhold the impossible option and explain why instead of
  // surfacing the server error.
  const parentAccount = isParent(userDoc);
  const providerAccount = isTutor(userDoc) || isBabysitter(userDoc);
  const roles = ROLES.filter(
    (r) => !(r.key === 'babysitter' && parentAccount) && !(r.key === 'parent' && providerAccount),
  );
  const note = parentAccount
    ? t('signup.roleExclusiveBabysitter')
    : providerAccount
      ? t('signup.roleExclusiveParent')
      : undefined;

  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Sit" roles={roles} banner={banner} note={note} />;
}
