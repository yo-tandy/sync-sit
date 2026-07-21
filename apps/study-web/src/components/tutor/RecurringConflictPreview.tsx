import { useTranslation } from 'react-i18next';
import type { StudySessionDoc } from '@/pages/tutor/SessionsPage';

/**
 * Client-side "N of 8 dates available" preview for a pending RECURRING request.
 *
 * PLACEHOLDER (Task 1): renders a static "Checking availability…" line. Task 2
 * replaces the body with the real preview — it loads the tutor's own schedule +
 * overrides + confirmed sessions, expands the candidate dates and runs
 * computeDayAvailability client-side. The props interface ({ session }) is
 * frozen so the swap is a drop-in.
 */
export function RecurringConflictPreview({ session }: { session: StudySessionDoc }) {
  const { t } = useTranslation();
  // Task 2 reads `session` (recurringSlots, schoolWeeksOnly, endDate) to compute
  // the per-date availability; the placeholder ignores it.
  void session;
  return (
    <p className="mt-2 text-xs text-gray-400">{t('tutor.sessions.conflictPreview.loading')}</p>
  );
}
