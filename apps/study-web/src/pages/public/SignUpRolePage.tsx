import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { isBabysitter, isParent, isTutor } from '@ejm/shared-core';
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
  // A sit babysitter never sees the role question here either (direct URL):
  // tutoring is the only study offer for them — the welcome page handles it
  // with subjects alone (issue #144).
  if (firebaseUser && !role && isBabysitter(userDoc)) {
    return <Navigate to="/welcome-study" replace />;
  }
  const banner = firebaseUser && !role ? t('signup.crossAppBanner') : undefined;

  // Provider (tutor OR babysitter) and parent are mutually exclusive (issue
  // #116) — withhold the impossible option and explain why instead of
  // surfacing the server error. A sit babysitter on this page is a provider
  // too: the guard rejects babysitter→parent everywhere.
  const parentAccount = isParent(userDoc);
  const providerAccount = isTutor(userDoc) || isBabysitter(userDoc);
  const roles = ROLES.filter(
    (r) => !(r.key === 'tutor' && parentAccount) && !(r.key === 'parent' && providerAccount),
  );
  const note = parentAccount
    ? t('signup.roleExclusiveTutor')
    : providerAccount
      ? t('signup.roleExclusiveParent')
      : undefined;

  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Study" roles={roles} banner={banner} note={note} />;
}
