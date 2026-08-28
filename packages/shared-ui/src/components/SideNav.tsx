import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface SideNavItem {
  to: string;
  label: string;
  icon?: ReactNode;
  /** Match the route exactly (react-router NavLink `end`). */
  end?: boolean;
}

export interface SideNavSection {
  /** Optional group heading (uppercase-label idiom); omit for an untitled group. */
  title?: string;
  items: SideNavItem[];
}

/**
 * Desktop-only grouped sidebar nav (issue #119, UX F5) — the persistent-nav
 * rendering for portals with too many destinations for a tab row (sit admin:
 * 10, grouped People / Trust & safety / Operations per the #140 dashboard
 * regrouping). Hidden below `md` so the phone shell is untouched; sticks
 * under the h-12 app bar and scrolls independently. Rendered by the layout as
 * a flex-row sibling of the capped content, not inside the app bar.
 */
export function SideNav({ sections, ariaLabel }: { sections: SideNavSection[]; ariaLabel: string }) {
  return (
    <nav
      aria-label={ariaLabel}
      className="sticky top-12 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-3 py-4 md:block"
    >
      {sections.map((section, i) => (
        <div key={section.title ?? i} className={i > 0 ? 'mt-5' : undefined}>
          {section.title && (
            <h2 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {section.title}
            </h2>
          )}
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-600'
                    : 'text-gray-700 hover:bg-gray-50'
                }`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
