import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * Empty state with a next step (UX F11, issue #125). Copy-only empty states
 * tell the user what WOULD appear; this component also gives them the action
 * that makes it appear. Use it wherever a list's empty branch renders — same
 * conditions as the old copy-only <p>, never for loading or error states.
 *
 * The action is optional on purpose: some empties have no sensible next step
 * for this user (then it degrades to icon + line). Pass either `actionTo`
 * (navigation) or `onAction` (in-page, e.g. clear filters) — not both.
 */
interface EmptyStateProps {
  icon: ReactNode;
  message: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}

// Mirrors Button's primary variant at size="sm" (minus w-full) so the CTA
// reads like every other primary button; Button renders only <button> and
// exports no class helper, so the classes are restated here.
const actionClasses =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-all hover:bg-brand-600/90';

export function EmptyState({ icon, message, actionLabel, actionTo, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </div>
      <p className="max-w-xs text-sm text-gray-500">{message}</p>
      {actionLabel && actionTo && (
        <Link to={actionTo} className={actionClasses}>
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className={actionClasses}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
