import { UnifiedLandingPage, UserIcon, UsersIcon, type SignUpRoleOption } from '@ejm/shared-ui';

const ROLES: SignUpRoleOption[] = [
  {
    key: 'student',
    labelKey: 'unifiedEnrollment.roleStudent',
    descKey: 'unifiedEnrollment.roleStudentDesc',
    icon: UserIcon,
    href: '/enroll/student',
  },
  {
    key: 'parent',
    labelKey: 'unifiedEnrollment.roleParent',
    descKey: 'unifiedEnrollment.roleParentDesc',
    icon: UsersIcon,
    href: '/enroll/parent',
  },
];

/**
 * `/enroll` (issue #435 milestone, PR4) — the new cross-app entry point:
 * one gray landing page, hosted on sync-sit.com, showing all three app
 * icons (do muted/"coming soon") and a parent-vs-student choice. Pure
 * wiring: `UnifiedLandingPage` (shared-ui, PR3) is presentational, this
 * just supplies apps/web's role hrefs.
 *
 * PR5 retired the classic `/signup` (sit-only role question) in this
 * page's favor: `/signup` now just redirects here, apps/web's own in-app
 * links point here directly, and study/do's own `/signup` redirect
 * cross-origin to this same URL (`sync-sit.com/enroll`).
 */
export function EnrollLandingPage() {
  return <UnifiedLandingPage roles={ROLES} />;
}
