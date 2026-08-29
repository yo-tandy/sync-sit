import { useTranslation } from 'react-i18next';
import { APP_ACCENT, APP_NAME, BRAND_MARKS, type SyncApp } from '../lib/brandMarks.js';

/** One destination in the hub. A row with no destination is not a row. */
export interface AccountRow {
  /** Already-translated label. The hub does not own app vocabulary. */
  label: string;
  /** Same-origin path, or an absolute URL when the destination is another app. */
  href: string;
  /** Optional one-line description under the label. */
  hint?: string;
  /**
   * True when following this row leaves this origin, so the hub can hand off
   * through the session handoff instead of a plain link.
   */
  external?: boolean;
}

export interface AccountSection {
  /** Omitted for the neutral block; set for a per-app block. */
  app?: SyncApp;
  /** Heading for the neutral block. Per-app blocks use the app's own name. */
  title?: string;
  rows: AccountRow[];
}

export interface AccountHomeProps {
  sections: AccountSection[];
  /** Same-origin navigation. */
  onNavigate: (href: string) => void;
  /** Cross-origin navigation, via the session handoff. */
  onNavigateExternal?: (href: string) => void;
  /** Rendered under the sections — sign out, delete account. */
  footer?: React.ReactNode;
}

/**
 * The shared account hub (#367, plan §18.3, decision 24).
 *
 * NEUTRAL BY CONSTRUCTION, and that is the whole point. The account is a
 * shared resource, not a page belonging to whichever app you happened to open
 * -- so it uses grays only and never `--color-brand-*`, which resolves to the
 * HOST app's colour and would make the same shared page look like a sit page
 * in sit and a study page in study. App colour appears only as a chip on a
 * per-app section, marking a setting as belonging to that app, and it comes
 * from APP_ACCENT (literal values) rather than the brand token, because a
 * token cannot reach a sibling app's colour from inside this build.
 *
 * NO BACK BUTTON, deliberately. A back arrow would frame this as a subsection
 * of the app you arrived from. It is not below anything; the bottom bar is how
 * you leave. Callers must not wrap this in a TopNav carrying `backTo`.
 *
 * Rows are DATA. A destination that does not exist is an absent row, never a
 * disabled one -- study has no family "favorites" and sync-do has no account
 * routes at all, and the honest rendering of a feature that does not exist is
 * nothing.
 */
export function AccountHome({
  sections,
  onNavigate,
  onNavigateExternal,
  footer,
}: AccountHomeProps) {
  const { t } = useTranslation();

  return (
    <div className="px-5 pt-4 pb-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">{t('accountHub.title')}</h1>
      <p className="mb-6 text-sm text-gray-500">{t('accountHub.subtitle')}</p>

      {sections
        .filter((s) => s.rows.length > 0)
        .map((section, i) => {
          const accent = section.app ? APP_ACCENT[section.app] : undefined;
          return (
            <section key={section.app ?? `neutral-${i}`} className="mb-6">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-bold tracking-wide text-gray-500 uppercase">
                {section.app ? (
                  <>
                    <img
                      src={BRAND_MARKS[section.app].sm}
                      srcSet={`${BRAND_MARKS[section.app].sm} 1x, ${BRAND_MARKS[section.app].md} 2x`}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] rounded"
                    />
                    {/* The colour hint: a chip in the app's own accent, the
                        only place app colour appears on this page. */}
                    <span style={{ color: accent }}>{APP_NAME[section.app]}</span>
                  </>
                ) : (
                  section.title
                )}
              </h2>

              {/* focus-ring-inset (issue #325's opt-in): overflow-hidden rounds
                  this group's corners by CLIPPING, the rows carry their own
                  px-4 py-3 while the <ul> has none of its own, and each row is
                  full-bleed — so a focused row's 2px ring at 2px offset is cut
                  off on every edge. The opt-in draws it inside the row instead.
                  Safe here: the variant drops the white backing and so assumes a
                  light container ground, which bg-white is (the constraint noted
                  on the rule in base.css). */}
              <ul className="focus-ring-inset overflow-hidden rounded-lg border border-gray-200 bg-white">
                {section.rows.map((row, j) => (
                  <li key={row.href} className={j > 0 ? 'border-t border-gray-100' : ''}>
                    <button
                      type="button"
                      onClick={() =>
                        /* An external row NEVER falls through to onNavigate
                           (#416 review): that pushed an absolute URL into the
                           router, which resolves as a same-origin path and
                           404s. A host that declares a cross-origin row and
                           supplies no handoff has a wiring bug, and doing
                           nothing is the honest failure. */
                        row.external
                          ? onNavigateExternal?.(row.href)
                          : onNavigate(row.href)
                      }
                      className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                    >
                      {accent && (
                        <span
                          aria-hidden="true"
                          className="h-6 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: accent }}
                        />
                      )}
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-gray-900">
                          {row.label}
                        </span>
                        {row.hint && (
                          <span className="block text-xs text-gray-500">{row.hint}</span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

      {footer && <div className="mt-8">{footer}</div>}
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
