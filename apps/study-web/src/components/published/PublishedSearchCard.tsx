import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@ejm/shared-ui';
import { isNewPublishedSearch } from '@ejm/shared-core';
import type { BoardSearch } from './usePublishedSearches';

/**
 * One published-search card (issue #207, study side). Shared by the dashboard
 * preview and the full board so the two cannot drift in WHAT they disclose —
 * exactly the fields the publish callable put on the doc.
 */
export function PublishedSearchCard({
  search,
  seenAtMs,
  footer,
}: {
  search: BoardSearch;
  seenAtMs: number | null;
  /** Trailing action/annotation — PR4 puts the Contact button here. */
  footer?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900">
          {t(`tutor.subjects.names.${search.subject}`)} ({search.level})
        </p>
        {isNewPublishedSearch(search, seenAtMs) && (
          <Badge variant="amber">{t('tutor.publishedBoard.newTag')}</Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-700">
        {t('tutor.publishedBoard.familyTitle', { name: search.familyName })}
      </p>
      {search.areaLabel && (
        <p className="text-sm text-gray-500">{t('tutor.publishedBoard.area', { area: search.areaLabel })}</p>
      )}
      {(search.locationPrefs?.length ?? 0) > 0 && (
        <p className="text-sm text-gray-500">
          {/* TUTOR-perspective copy. The family.search.location.* block is
              written from the family's side ("At your home" = the FAMILY's
              home), so reusing it here inverts every label for the reader
              (PR #211 review). tutor.sessions.location.* is the same four
              values said to a tutor. */}
          {search.locationPrefs!.map((p) => t(`tutor.sessions.location.${p}`)).join(', ')}
        </p>
      )}
      {search.maxRate != null && (
        <p className="text-sm text-gray-500">{t('tutor.publishedBoard.maxRate', { rate: search.maxRate })}</p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {t('tutor.publishedBoard.expires', {
            date: search.expiresAt.toDate().toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
          })}
        </p>
        {footer}
      </div>
    </Card>
  );
}
