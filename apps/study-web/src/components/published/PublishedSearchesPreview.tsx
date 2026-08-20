import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { usePublishedSearches } from './usePublishedSearches';
import { PublishedSearchCard } from './PublishedSearchCard';

const PREVIEW_MAX = 3;

/**
 * "Posts from families" on the tutor dashboard (issue #207, owner direction
 * on PR #211): the board's entry point lives here, under the confirmed
 * sessions, rather than behind a menu entry. Newest few active posts plus a
 * link to the full board.
 *
 * Renders nothing when there is nothing to show — the full board carries the
 * empty state and the error copy.
 */
export function PublishedSearchesPreview() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  // Same New rule as the board; visiting the FULL board is what marks posts
  // seen, so they stay tagged here until the tutor opens the list.
  const seenAtMs = userDoc?.profiles?.tutor?.publishedSearchesSeenAt?.toMillis?.() ?? null;
  const { searches, errored } = usePublishedSearches(PREVIEW_MAX);

  if (errored || !searches || searches.length === 0) return null;

  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        {t('tutor.publishedBoard.previewTitle')}
      </h3>
      {searches.map((s) => (
        <PublishedSearchCard key={s.id} search={s} seenAtMs={seenAtMs} />
      ))}
      <Link to="/tutor/published-searches" className="text-sm font-medium text-brand-600 hover:underline">
        {t('tutor.publishedBoard.seeMore')}
      </Link>
    </div>
  );
}
