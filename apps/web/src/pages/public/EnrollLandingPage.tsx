import {
  UnifiedLandingPage,
  UserIcon,
  UsersIcon,
  type AppMark,
  type SignUpRoleOption,
  type SyncApp,
} from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import doSm from '@ejm/shared-ui/brand-marks/sync-do-48.png';
import doMd from '@ejm/shared-ui/brand-marks/sync-do-96.png';

// The landing page is the ONE place in sit that renders the sync/do mark: a
// muted, non-clickable "coming soon" tile (issue #435 item 2, platform-plan
// decision 20 — brand identity, not reachability). Hosts import exactly the
// marks they render (#422); this host renders all three.
const MARKS: Record<SyncApp, AppMark> = {
  sit: { sm: sitSm, md: sitMd },
  study: { sm: studySm, md: studyMd },
  do: { sm: doSm, md: doMd },
};

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
  return <UnifiedLandingPage roles={ROLES} marks={MARKS} />;
}
