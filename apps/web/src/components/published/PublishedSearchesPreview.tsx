import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { getBabysitterView } from '@ejm/sit-core';
import { usePublishedSearches } from './usePublishedSearches';
import { PublishedSearchCard } from './PublishedSearchCard';

const PREVIEW_MAX = 3;

/**
 * "Posts from families" on the babysitter dashboard (issue #207, owner
 * direction on PR #211): the board's entry point lives here, under the
 * appointment sections, rather than behind a menu entry. Shows the newest
 * few active posts and links to the full board.
 *
 * Since the menu entries were removed, this section is the ONLY link to the
 * board — so it must not vanish when the read comes back empty or fails
 * (PR #211 review): the board's own empty/error copy, and any post the
 * sitter's next refresh brings, would be reachable only by typing the URL.
 * It therefore renders a one-line status plus the link in those states, and
 * stays silent ONLY while the first snapshot is still pending, where an
 * empty section would just be a flash before the cards arrive.
 */
export function PublishedSearchesPreview() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  // Same New rule as the board: createdAt > the sitter's stored seenAt.
  // Visiting the FULL board is what marks them seen, so a post stays tagged
  // here until the sitter actually opens the list.
  const seenAtMs = getBabysitterView(userDoc)?.publishedSearchesSeenAt?.toMillis?.() ?? null;
  // The same predicate firestore.rules uses to grant the board read
  // (`profiles.babysitter.enrollmentComplete == true && status == 'active'`).
  // Sit's guard already redirects enrollmentComplete === false, but a
  // missing-field or non-active doc still reaches the dashboard, and for
  // those the read is a guaranteed permission-denied — showing them the error
  // line plus a link into a board they can never read would be permanent
  // furniture (PR #211 review, study's twin). Providers who CAN read still
  // get the entry point in every state.
  const canReadBoard =
    getBabysitterView(userDoc)?.enrollmentComplete === true && userDoc?.status === 'active';

  const { searches, errored } = usePublishedSearches(PREVIEW_MAX);

  if (!canReadBoard) return null;

  // First snapshot pending: nothing to say yet.
  if (searches === null) return null;

  const empty = searches.length === 0;

  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('publishedBoard.previewTitle')}</h3>
      {errored && (
        <p className="mb-2 text-sm text-gray-500">{t('publishedBoard.previewError')}</p>
      )}
      {!errored && empty && (
        <p className="mb-2 text-sm text-gray-500">{t('publishedBoard.previewEmpty')}</p>
      )}
      {searches.map((s) => (
        <PublishedSearchCard key={s.id} search={s} seenAtMs={seenAtMs} />
      ))}
      <Link
        to="/babysitter/published-searches"
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        {t(empty ? 'publishedBoard.openBoard' : 'publishedBoard.seeMore')}
      </Link>
    </div>
  );
}
