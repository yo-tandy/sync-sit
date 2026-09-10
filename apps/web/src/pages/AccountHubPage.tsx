import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { AccountHome, type AccountSection } from '@ejm/shared-ui';
import sitSm from '@ejm/shared-ui/brand-marks/sync-sit-48.png';
import sitMd from '@ejm/shared-ui/brand-marks/sync-sit-96.png';
import studySm from '@ejm/shared-ui/brand-marks/sync-study-48.png';
import studyMd from '@ejm/shared-ui/brand-marks/sync-study-96.png';
import { getSitRole } from '@ejm/sit-core';
import { useAuthStore } from '@/stores/authStore';
import { functions } from '@/config/firebase';
import { STUDY_APP_URL } from '@/lib/appSwitch';

// Imported directly, not through a shared-ui lookup (#422): this page's own
// graph then holds only the two marks it actually shows (sync-do never
// appears here -- decision 20).
const SIT_MARK = { sm: sitSm, md: sitMd };
const STUDY_MARK = { sm: studySm, md: studyMd };

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
 * The study block deep-links (issue #426): study's `HandoffPage` now honours
 * a validated `next` in the handoff fragment, so a sit member with a KNOWN
 * sit role gets role-shaped rows into study (My account / Sessions /
 * Search) instead of the single generic "Open sync-study" row. Role-aware
 * is the whole point -- study guards `/family/*` on role="parent", so a sit
 * student (babysitter) gets study's tutor-shaped equivalents
 * (`/tutor/account`, `/tutor/sessions`, `/tutor/published-searches`), never
 * the parent-shaped paths. A signed-in member with NO sit role (admin, or a
 * study-only tutor) has no signal to shape rows from, so they keep the one
 * destination that always works -- absent beats broken, same rule as the
 * sit-only sections above.
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
   *
   * `next` (issue #426) is an in-app STUDY path (`/family/sessions`,
   * `/tutor/account`, …) -- distinguished from the role-less fallback row,
   * whose `href` is study's absolute app URL and therefore never starts with
   * `/`. Only a leading-`/` value is carried as `next`; it is re-validated on
   * the RECEIVING side (study's `HandoffPage`) against its own route table
   * regardless -- this app is not the security boundary, since the fragment
   * is attacker-controllable after it leaves here.
   */
  const openStudy = async (next?: string) => {
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
      const deepNext = next?.startsWith('/') ? next : undefined;
      const nextParam = deepNext ? `&next=${encodeURIComponent(deepNext)}` : '';
      window.location.assign(
        `${STUDY_APP_URL}/handoff#code=${encodeURIComponent(res.data.code)}&lang=${encodeURIComponent(lang)}${nextParam}`,
      );
      // Stay busy: the browser is navigating away.
    } catch {
      setHandoffFailed(true);
      setBusy(false);
    }
  };

  const sitSections: AccountSection[] = [
    {
      // "Account" (#445) -- distinct from `accountHub.myAccount` ("My
      // account"), which is this section's OWN first row. The section title
      // used to reuse that same string as the page-level heading; now the
      // page-level heading is the sticky "Sync/Account" banner (AccountHome)
      // and this is purely the first of the three section titles the owner
      // named: Account, Sync/Sit, Sync/Study.
      title: t('accountHub.neutralSection'),
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
      mark: SIT_MARK,
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

  const errorHint = handoffFailed ? { hint: t('appSwitch.error') } : {};

  /*
   * Role-shaped deep rows (issue #426): study's own routes, mirrored 1:1 --
   * both `FamilyLayout` and `TutorLayout` in study serve an account, a
   * sessions and a search-equivalent page under the SAME three names. `next`
   * is re-validated on arrival regardless (study's `HandoffPage`), so this
   * table only needs to point at real study routes, not defend against
   * tampering itself.
   */
  const studyDeepRows = isParent
    ? [
        { label: t('accountHub.myAccount'), href: '/family/account' },
        { label: t('accountHub.sessions'), href: '/family/sessions' },
        { label: t('accountHub.search'), href: '/family/search' },
      ]
    : sitRole === 'babysitter'
      ? [
          { label: t('accountHub.myAccount'), href: '/tutor/account' },
          { label: t('accountHub.sessions'), href: '/tutor/sessions' },
          { label: t('accountHub.search'), href: '/tutor/published-searches' },
        ]
      : null;

  // Order is DATA too, and pinned (#445): Account, Sync/Sit, Sync/Study.
  // `sitSections` already holds [neutral, sit] in that order (this app's
  // owner named it "Account" then "Sync/Sit"); the study block is always
  // appended last, whether or not `sitSections` is present.
  const sections: AccountSection[] = [
    ...(sitRole ? sitSections : []),
    {
      app: 'study' as const,
      mark: STUDY_MARK,
      /*
       * A signed-in member with NO sit role (admin, or a study-only tutor)
       * gives us no signal to shape rows from -- `next` would guess wrong
       * for one of the two shapes, and absent beats broken (#416 review
       * round 1's original reasoning, now scoped to just this case). They
       * keep the one destination that always works: the plain handoff, no
       * `next`, landing on study's own `postLoginRouter`.
       */
      rows: studyDeepRows
        ? studyDeepRows.map((row) => ({ ...row, external: true, ...errorHint }))
        : [{ label: t('appSwitch.toStudy'), href: STUDY_APP_URL, external: true, ...errorHint }],
    },
  ];

  return (
    <AccountHome
      sections={sections}
      onNavigate={(href) => void navigate(href)}
      onNavigateExternal={(href) => void openStudy(href)}
    />
  );
}
