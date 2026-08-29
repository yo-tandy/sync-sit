import { useId, useState, type ReactNode } from 'react';
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
 *
 * MARKUP (PR #345 round 2): the heading WRAPS the toggle, which is the WAI-ARIA
 * APG accordion shape. Both source dashboards had the `<h3>` *inside* the
 * `<button>` — an invalid content model (a button takes phrasing content; a
 * heading is flow content), and one that assistive tech flattens into the
 * button's accessible name, so the section titles were not reachable by heading
 * navigation at all. jsdom's role mapping is more permissive than real AT, so
 * no test caught it. Extracting the component is the moment to fix it once
 * rather than four times — the same class of defect as the `<button>`-inside-
 * `<a>` this branch already fixed. `aria-expanded` + `aria-controls` complete
 * the disclosure so the toggle announces what it opens.
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
  const contentId = useId();
  if ((total ?? count) === 0) return null;

  return (
    <div className="mb-4">
      {/* The badge sits INSIDE the toggle deliberately: it is part of what the
          section says, and hiding it from the accessible name would make the
          count sighted-only. Both are phrasing content, so the button's
          content model stays valid. */}
      <h3 className="mb-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center justify-between"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">{title}</span>
            {count > 0 && <Badge variant={BADGE_VARIANT[variant]}>{count}</Badge>}
          </span>
          <ChevronRightIcon
            className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </h3>
      <div id={contentId} className={open ? contentClassName : 'hidden'}>
        {open && children}
      </div>
    </div>
  );
}
