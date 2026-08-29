import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { AccountHome, type AccountSection } from '@ejm/shared-ui';
import { getSitRole } from '@ejm/sit-core';
import { useAuthStore } from '@/stores/authStore';
import { functions } from '@/config/firebase';
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
 *
 * The study block is a SINGLE row for the same reason the missing rows are
 * absent: a cross-origin deep link cannot work today (study's handoff page
 * drops the destination), so the hub offers the one move that does. See the
 * note on that section.
 */
export function AccountHubPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const userDoc = useAuthStore((s) => s.userDoc);
  const role = userDoc ? getSitRole(userDoc) : null;
  /**
   * A SIT role, not a boolean (#416 review round 4). `getSitRole` returns
   * 'parent' | 'babysitter' | 'admin' | undefined, so collapsing it to
   * `role === 'parent'` put admins AND signed-in members with no sit profile
   * (a study-only tutor, say) into the babysitter branch — where every row
   * they were handed bounced off `BabysitterLayout`'s `role="babysitter"`
   * guard: an admin to `/admin`, a tutor to `/welcome-sit`. That is the whole
   * neutral section plus all three sit rows, dead, for two role classes that
   * `AuthGuard` now deliberately admits to this page.
   *
   * This page's rule is ABSENT BEATS BROKEN, so those two sections are simply
   * not rendered without a sit role. What is left — the study handoff — works
   * for every signed-in member regardless of sit role, which is exactly the
   * case a role-less member is here for.
   */
  const sitRole = role === 'parent' || role === 'babysitter' ? role : null;
  const isParent = sitRole === 'parent';
  const [busy, setBusy] = useState(false);
  const [handoffFailed, setHandoffFailed] = useState(false);

  /**
   * Leaving for study is a REAL handoff, not a plain link (#416 review).
   * Firebase auth persistence is per-origin, so `location.assign` to a study
   * URL drops anyone without an existing study session on this browser onto
   * study's `/login`. Same shape as `AppSwitchMenuItem`: mint a one-time code,
   * carry it in the URL FRAGMENT (fragments never reach servers or logs), and
   * navigate only once the mint resolves.
   */
  const openStudy = async () => {
    if (busy) return;
    setBusy(true);
    setHandoffFailed(false);
    try {
      const mint = httpsCallable<Record<string, never>, { code: string }>(
        functions,
        'createAppHandoffCode',
      );
      const res = await mint({});
      // Whitelisted at the source, mirroring the receiver's en|fr allowlist.
      const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
      window.location.assign(
        `${STUDY_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setHandoffFailed(true);
      setBusy(false);
    }
  };

  const sitSections: AccountSection[] = [
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
  ];

  const sections: AccountSection[] = [
    ...(sitRole ? sitSections : []),
    {
      app: 'study' as const,
      /*
       * ONE row, not a deep-link list (#416 review round 1).
       *
       * The first cut listed study's account/sessions/search as deep links.
       * Two things were wrong with that and neither is fixable here. Study's
       * `HandoffPage` reads only `code` and `lang` and always lands via
       * `postLoginRouter`, so a cross-origin DEEP link is not expressible
       * today at all -- the destination is dropped on arrival. And the deep
       * rows were parent-shaped for every role: study guards `/family/*` on
       * role="parent", so a sit student following them is bounced.
       *
       * Adding a `next` to the handoff is the real fix and it is NOT a small
       * one: the handoff mints a session, so an unvalidated destination on
       * that endpoint is an open redirect against a freshly authenticated
       * user. It needs an allowlist of in-app relative paths rejecting any
       * scheme or `//` prefix, with hostile inputs pinned. Tracked separately.
       *
       * Until then this page applies its own rule -- absent beats broken --
       * and offers the one destination that actually works.
       */
      rows: [
        {
          label: t('appSwitch.toStudy'),
          href: STUDY_APP_URL,
          external: true,
          ...(handoffFailed ? { hint: t('appSwitch.error') } : {}),
        },
      ],
    },
  ];

  return (
    <AccountHome
      sections={sections}
      onNavigate={(href) => void navigate(href)}
      onNavigateExternal={() => void openStudy()}
    />
  );
}
