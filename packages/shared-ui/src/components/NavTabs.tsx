import { NavLink } from 'react-router';
import { Badge } from './Badge.js';

export interface NavTabItem {
  to: string;
  label: string;
  /** Numeric attention badge (rendered only when > 0), e.g. pending endorsements. */
  badge?: number;
  /** Match the route exactly (react-router NavLink `end`). */
  end?: boolean;
}

/**
 * Desktop-only persistent primary nav (issue #119, UX F5). Renders the same
 * primary link list the portal's burger menu holds as a tab row that sticks
 * directly under the h-12 app bar at `md+`; hidden below `md` so the phone
 * shell is untouched. The row's content is capped at the wide `max-w-5xl`
 * tier — chrome deliberately sits at the widest content tier, so on
 * reading-tier (2xl) pages the tabs run wider than the text column (the
 * standard app-chrome treatment; do not "fix" this to track the page tier).
 * `overflow-x-auto` keeps long lists (sit family has 8 destinations) usable
 * at exactly-`md` widths.
 */
export function NavTabs({ items, ariaLabel }: { items: NavTabItem[]; ariaLabel: string }) {
  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-12 z-30 hidden border-b border-gray-200 bg-white md:block"
    >
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${
                isActive
                  ? 'border-brand-600 font-semibold text-brand-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`
            }
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <Badge variant="amber">{item.badge}</Badge>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
