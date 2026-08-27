import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { capitalize } from '../utils/formatName.js';

/**
 * The dashboard header idiom, shared by every role in every app
 * (parity D1, issue #239).
 *
 * Before this, all four dashboards greeted differently: sit's family page said
 * "Hello, Marie 👋" over a "DUPONT family" context line; sit's babysitter page
 * inverted it (a muted "Hello" label above an un-capitalized name); study's
 * family page had neither comma, wave nor context line; and study's tutor page
 * greeted nobody at all, showing a static "Dashboard" title instead.
 * Sit's family form is the one adopted.
 *
 * Renders `<h1>` deliberately. Neither app's chrome carries a page-level
 * heading, so the dashboards were the top heading and sit's `<h2>` skipped a
 * level — a real (if minor) a11y defect that unifying the idiom fixes for
 * free.
 *
 * Two greeting strings, both defined in each app's locale file:
 * `common.hello` ("Hello," / "Bonjour,") when there is a name, and
 * `common.helloNoName` ("Hello" / "Bonjour") when there is not. The comma
 * lives in the string rather than in JSX because French punctuation spacing
 * is not a thing to hard-code — and a name-less "Bonjour, 👋" would be wrong
 * in both languages.
 *
 * There is deliberately NO `fallbackName` prop. The first version had one, and
 * the tutor dashboard passed `t('tutor.dashboardTitle')` — which reads
 * "Dashboard" / "Tableau de bord", not "Tutor dashboard" — so a tutor doc with
 * no `firstName` greeted them as "Hello, Dashboard 👋" (PR #249 review).
 * A prop that asks each call site for a name-shaped string will eventually be
 * handed one that isn't; the component owning the no-name case removes the
 * question.
 */
export interface DashboardGreetingProps {
  /** Raw first name off the user doc; capitalized here so no call site has to. */
  firstName?: string | null;
  /**
   * Muted line under the greeting: the family's name on family dashboards, a
   * role blurb on provider ones. Omitted where a dashboard has nothing
   * meaningful to say — the idiom is the greeting, not a mandatory subtitle.
   */
  contextLine?: ReactNode;
  /**
   * Right-hand slot, for the search-visibility pill the two provider
   * dashboards carry. Kept as a slot rather than absorbed, because the pill's
   * gating and dialog are app-specific.
   */
  action?: ReactNode;
}

export function DashboardGreeting({
  firstName,
  contextLine,
  action,
}: DashboardGreetingProps) {
  const { t } = useTranslation();
  const name = capitalize(firstName ?? undefined);

  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-bold text-gray-900">
          {name ? `${t('common.hello')} ${name}` : t('common.helloNoName')} 👋
        </h1>
        {contextLine && <p className="mt-0.5 text-xs text-gray-500">{contextLine}</p>}
      </div>
      {action}
    </div>
  );
}
