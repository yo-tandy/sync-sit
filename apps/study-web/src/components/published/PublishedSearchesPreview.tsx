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
 * Since the menu entries were removed, this section is the ONLY link to the
 * board — so it must not vanish when the read comes back empty or fails
 * (PR #211 review), or the board and every post a later refresh brings are
 * reachable only by typing the URL. It renders a one-line status plus the
 * link in those states, and stays silent ONLY while the first snapshot is
 * pending.
 */
export function PublishedSearchesPreview() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  // Same New rule as the board; visiting the FULL board is what marks posts
  // seen, so they stay tagged here until the tutor opens the list.
  const seenAtMs = userDoc?.profiles?.tutor?.publishedSearchesSeenAt?.toMillis?.() ?? null;
  const { searches, errored } = usePublishedSearches(PREVIEW_MAX);

  // First snapshot pending: nothing to say yet.
  if (searches === null) return null;

  const empty = searches.length === 0;

  return (
    <div className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        {t('tutor.publishedBoard.previewTitle')}
      </h3>
      {errored && (
        <p className="mb-2 text-sm text-gray-500">{t('tutor.publishedBoard.previewError')}</p>
      )}
      {!errored && empty && (
        <p className="mb-2 text-sm text-gray-500">{t('tutor.publishedBoard.previewEmpty')}</p>
      )}
      {searches.map((s) => (
        <PublishedSearchCard key={s.id} search={s} seenAtMs={seenAtMs} />
      ))}
      <Link to="/tutor/published-searches" className="text-sm font-medium text-brand-600 hover:underline">
        {t(empty ? 'tutor.publishedBoard.openBoard' : 'tutor.publishedBoard.seeMore')}
      </Link>
    </div>
  );
}
