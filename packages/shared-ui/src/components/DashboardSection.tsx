import { useState, type ReactNode } from 'react';
import { Badge } from './Badge.js';
import { ChevronRightIcon } from './Icons.js';

/**
 * The collapsible dashboard section idiom, shared by every role in both apps
 * (issue #338).
 *
 * It started on sit's babysitter dashboard, was copied to study's tutor
 * dashboard when that page was restructured to match it (issue #165), and
 * issue #338 brings the SAME shape to the two family dashboards — so the
 * parent landing pages read like the provider ones the owner asked them to
 * match. Four copies of a header-with-badge-and-chevron is three too many;
 * this is the one, and every dashboard now renders literally the same markup.
 *
 * Both apps' `Badge`, `Card` and icons already come from this package, so the
 * move changes no pixels on the provider dashboards.
 */
const BADGE_VARIANT = {
  pending: 'amber',
  confirmed: 'green',
  past: 'gray',
  rejected: 'gray',
} as const;

export interface DashboardSectionProps {
  title: string;
  /**
   * The badge number: how many of the rows are a TO-DO for the reader. Zero
   * renders no badge at all — a section can legitimately hold rows that are
   * waiting on the other side (a tutor's own proposal awaits the family, a
   * family's own request awaits the tutor) and those are not a to-do.
   */
  count: number;
  /**
   * Rendered rows; gates the section. Defaults to `count` — pass it whenever
   * the badge counts a SUBSET of the rows, so a section whose rows are all
   * "waiting on them" still renders (PR #194 review).
   */
  total?: number;
  variant: 'pending' | 'confirmed' | 'past' | 'rejected';
  defaultOpen?: boolean;
  /**
   * Class on the open-content wrapper. The default stacks rows with
   * `space-y-3`; sit's AppointmentCard carries its own `mb-3`, so those call
   * sites pass `''` rather than paying the gap twice.
   */
  contentClassName?: string;
  children: ReactNode;
}

export function DashboardSection({
  title,
  count,
  total,
  variant,
  defaultOpen = true,
  contentClassName = 'space-y-3',
  children,
}: DashboardSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if ((total ?? count) === 0) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          {count > 0 && <Badge variant={BADGE_VARIANT[variant]}>{count}</Badge>}
        </div>
        <ChevronRightIcon
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && <div className={contentClassName}>{children}</div>}
    </div>
  );
}
