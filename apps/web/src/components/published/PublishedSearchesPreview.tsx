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
 * Renders nothing at all when there is nothing to show — an empty section
 * would be noise on the dashboard, and the full board carries the empty
 * state and the error copy.
 */
export function PublishedSearchesPreview() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  // Same New rule as the board: createdAt > the sitter's stored seenAt.
  // Visiting the FULL board is what marks them seen, so a post stays tagged
  // here until the sitter actually opens the list.
  const seenAtMs = getBabysitterView(userDoc)?.publishedSearchesSeenAt?.toMillis?.() ?? null;
  const { searches, errored } = usePublishedSearches(PREVIEW_MAX);

  if (errored || !searches || searches.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('publishedBoard.previewTitle')}</h3>
      {searches.map((s) => (
        <PublishedSearchCard key={s.id} search={s} seenAtMs={seenAtMs} />
      ))}
      <Link
        to="/babysitter/published-searches"
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        {t('publishedBoard.seeMore')}
      </Link>
    </div>
  );
}
