import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { SignUpRolePage as SharedSignUpRolePage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';
import { isBabysitter } from '@ejm/shared-core';
import { canCrossAppEnrollTutor, postLoginRouter } from '@/utils/postLoginRouter';
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
  // Already enrolled here: there is nothing to sign up for — straight to the
  // portal. Without this, a signed-in tutor visiting /signup saw a Tutor
  // option whose click bounced them home (the enrollment page's
  // already-enrolled redirect), a confusing loop.
  if (firebaseUser && role) {
    return <Navigate to={postLoginRouter(role, userDoc)} replace />;
  }
  // A sit babysitter never sees the role question here either (direct URL):
  // tutoring is the only study offer for them — the welcome page handles it
  // with subjects alone (issue #144).
  if (firebaseUser && !role && isBabysitter(userDoc)) {
    return (
      <Navigate to={canCrossAppEnrollTutor(userDoc) ? '/welcome-study' : '/enroll/tutor'} replace />
    );
  }
  const banner = firebaseUser && !role ? t('signup.crossAppBanner') : undefined;

  // No role-exclusivity withholding here (issue #159): every account that
  // holds a tutor, parent, or babysitter profile was redirected above, so a
  // visitor reaching this point never has an option to withhold. The
  // exclusivity guard lives server-side (addProfileToUser, issue #116); the
  // cross-app welcome page translates its rejection.
  return <SharedSignUpRolePage logoSrc="/logo.png" logoAlt="Sync/Study" roles={ROLES} banner={banner} />;
}
