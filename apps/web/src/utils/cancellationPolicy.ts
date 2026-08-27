import type { TFunction } from 'i18next';

/**
 * Cancellation-policy display helper (issue #237) — the sit twin of
 * study-web's utils/cancellationPolicy.ts, deliberately identical: the 1-week
 * preset (168) renders as the translated "1 week", every other preset as
 * "{n}h". The server flag (`lateCancellation`) is authoritative; this is
 * display only.
 */
export function humanizeNoticeWindow(hours: number, t: TFunction): string {
  if (hours >= 168) return t('search.window.week');
  return `${hours}h`;
}
