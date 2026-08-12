import { Link } from 'react-router';
import { ShieldIcon } from './Icons.js';

interface SupervisionChipProps {
  /** Short visible label, already translated by the app (LanguageSelector pattern). */
  label: string;
  /** Fuller phrase for assistive tech, already translated by the app. */
  ariaLabel: string;
  /** Route of the app's supervision transparency page. */
  to: string;
}

/**
 * Ambient supervision indicator for provider app bars (UX F14 / issue #128).
 * Rendered by the app ONLY when the signed-in user's own doc carries the
 * `governedBy` mirror (present ⇔ supervision ACTIVE) — no status logic here.
 * The h-11/min-w-11 wrapper keeps a ≥44px hit target around the smaller pill.
 */
export function SupervisionChip({ label, ariaLabel, to }: SupervisionChipProps) {
  return (
    <Link to={to} aria-label={ariaLabel} className="flex h-11 min-w-11 items-center justify-center">
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
        <ShieldIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
    </Link>
  );
}
