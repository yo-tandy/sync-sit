import { useTranslation } from 'react-i18next';
import { Badge, Card } from '@/components/ui';
import { isNewPublishedSearch } from '@ejm/shared-core';
import type { BoardSearch } from './usePublishedSearches';

/**
 * One published-search card (issue #207). Shared by the dashboard preview and
 * the full board so the two can never drift in WHAT they disclose — the card
 * renders exactly the fields the publish callable put on the doc.
 */
export function PublishedSearchCard({
  search,
  seenAtMs,
  footer,
}: {
  search: BoardSearch;
  seenAtMs: number | null;
  /** Trailing action/annotation — PR3 puts the Contact button here. */
  footer?: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const dayNames: Record<string, string> = {
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  };

  const schedule = (() => {
    if (search.type === 'one_time' && search.date) {
      const d = new Date(search.date + 'T00:00:00').toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      return `${d}, ${search.startTime}–${search.endTime}`;
    }
    return (search.recurringSlots ?? [])
      .map((slot) => `${dayNames[slot.day] || slot.day} ${slot.startTime}–${slot.endTime}`)
      .join(', ');
  })();

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900">
          {t('publishedBoard.familyTitle', { name: search.familyName })}
        </p>
        {isNewPublishedSearch(search, seenAtMs) && (
          <Badge variant="amber">{t('publishedBoard.newTag')}</Badge>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-700">{schedule}</p>
      {search.type === 'recurring' && search.schoolWeeksOnly && (
        <p className="text-xs text-gray-500">{t('search.schoolWeeksOnly')}</p>
      )}

      <p className="mt-1 text-sm text-gray-500">
        {t('publishedBoard.kids', { count: search.numberOfKids, ages: search.kidAges.join(', ') })}
      </p>
      {search.areaLabel && (
        <p className="text-sm text-gray-500">{t('publishedBoard.area', { area: search.areaLabel })}</p>
      )}
      {search.offeredRate != null && (
        <p className="text-sm text-gray-500">{t('publishedBoard.rate', { rate: search.offeredRate })}</p>
      )}
      {search.additionalInfo && (
        <p className="mt-2 text-sm text-gray-600">{search.additionalInfo}</p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          {t('publishedBoard.expires', {
            date: search.expiresAt.toDate().toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
          })}
        </p>
        {footer}
      </div>
    </Card>
  );
}
