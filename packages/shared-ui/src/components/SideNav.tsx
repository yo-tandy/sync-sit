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
 *
 * `head`, optional: rendered above the sections, as a SIBLING of the
 * sections' own `<nav>` inside this shared sticky/scroll wrapper -- not
 * nested inside that `<nav>`. Exists for admin's desktop app switch (#417,
 * plan Q9) -- admin has no top-bar equivalent to the other portals'
 * `AppBar` (its desktop nav IS this sidebar), so `AppSwitchInline` goes here
 * instead, at the head of the one persistent nav admin has, rather than
 * inventing a second desktop chrome surface just to hold it.
 *
 * SIBLING, not nested (#492 review): `head` renders its own `<nav
 * aria-label="Switch app">` landmark (`AppSwitchInline`/`AppSwitchBar`
 * share that contract). Putting it inside THIS component's own `<nav
 * aria-label={ariaLabel}>` would nest one landmark inside another -- the
 * exact pattern this PR avoids everywhere else a hidden `<nav>` gets
 * embedded into a host (see AccountLayout's plain `<div>` wrapper for the
 * same reason). So the sticky/scroll/background styling that used to live
 * on the `<nav>` itself now lives on this wrapping `<div>`, with `head` and
 * `<nav>` as its two stacked children.
 */
export function SideNav({
  sections,
  ariaLabel,
  head,
}: {
  sections: SideNavSection[];
  ariaLabel: string;
  head?: ReactNode;
}) {
  return (
    <div className="sticky top-12 hidden h-[calc(100vh-3rem)] w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-3 py-4 md:block">
      {head && <div className="mb-4 border-b border-gray-100 pb-4">{head}</div>}
      <nav aria-label={ariaLabel}>
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
    </div>
  );
}
