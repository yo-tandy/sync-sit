import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AccountHome, type AccountSection } from '@ejm/shared-ui';
import { getSitRole } from '@ejm/sit-core';
import { useAuthStore } from '@/stores/authStore';
import { STUDY_APP_URL } from '@/lib/appSwitch';

/**
 * sync/sit's binding of the shared account hub (#367).
 *
 * The rows are a TABLE, not markup. Every entry the owner named maps to a
 * route that already exists, and the ones that do not exist are simply
 * absent -- study has no family "favorites", and sync-do has no account,
 * family, governance or verification page at all (§18.3, by design). A row
 * pointing at a route that is not there is worse than no row.
 *
 * The neutral block is the shared account: it belongs to the member, not to
 * an app. The per-app blocks carry that app's accent and its own
 * destinations. sync/do gets no block here yet: nothing in do is reachable
 * from a sit-hosted hub without a handoff, and do's own rows (tasks, board,
 * endorsements) live behind that switch rather than in this list.
 */
export function AccountHubPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const userDoc = useAuthStore((s) => s.userDoc);
  const role = userDoc ? getSitRole(userDoc) : null;
  const isParent = role === 'parent';

  const sections: AccountSection[] = [
    {
      title: t('accountHub.title'),
      rows: [
        {
          label: t('accountHub.myAccount'),
          href: isParent ? '/family/account' : '/babysitter/account',
        },
        // Family, supervised kids and verification are parent-side concepts
        // in sit: a student belongs to no family here and supervises no one.
        ...(isParent
          ? [
              { label: t('accountHub.myFamily'), href: '/family/settings' },
              { label: t('accountHub.supervisedKids'), href: '/family/governance' },
              { label: t('accountHub.verification'), href: '/family/verification' },
            ]
          : []),
      ],
    },
    {
      app: 'sit' as const,
      rows: isParent
        ? [
            { label: t('accountHub.appointments'), href: '/family/appointments' },
            { label: t('accountHub.search'), href: '/family/search' },
            { label: t('accountHub.endorsements'), href: '/family/endorsements' },
            { label: t('accountHub.favorites'), href: '/family/preferred' },
          ]
        : [
            { label: t('accountHub.search'), href: '/babysitter/published-searches' },
            { label: t('accountHub.endorsements'), href: '/babysitter/endorsements' },
            { label: t('accountHub.favorites'), href: '/babysitter/families' },
          ],
    },
    {
      app: 'study' as const,
      // Cross-origin until the domain consolidates (plan §8, Q12): these go
      // through the session handoff, not a plain link.
      rows: [
        { label: t('accountHub.myAccount'), href: `${STUDY_APP_URL}/family/account`, external: true },
        { label: t('accountHub.sessions'), href: `${STUDY_APP_URL}/family/sessions`, external: true },
        { label: t('accountHub.search'), href: `${STUDY_APP_URL}/family/search`, external: true },
        // No favorites row: study has no tutor equivalent of
        // /family/preferred. Absent rather than invented.
      ],
    },
  ];

  return (
    <AccountHome
      sections={sections}
      onNavigate={(href) => void navigate(href)}
      onNavigateExternal={(href) => window.location.assign(href)}
    />
  );
}
