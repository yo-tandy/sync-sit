import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { DashboardGreeting } from '@ejm/shared-ui';

/**
 * The shared dashboard header (parity D1, issue #239). Pinned once here
 * rather than four times across the two apps' dashboard tests — the point of
 * the issue was to stop maintaining four copies of this idiom.
 *
 * Lives in study-web because shared-ui has no runner of its own and is absent
 * from `test:unit`'s filter list.
 */
describe('DashboardGreeting', () => {
  it('greets by capitalized first name, with the wave', () => {
    renderWithProviders(<DashboardGreeting firstName="marie" />);
    // The comma lives in the locale string, not in JSX.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello, Marie 👋');
  });

  it('greets without a name — no dangling comma, no borrowed noun', () => {
    // Study's family dashboard rendered a dangling "Hello " for a doc with no
    // firstName. The first fix gave every call site a `fallbackName`, and the
    // tutor dashboard promptly passed t('tutor.dashboardTitle') — which reads
    // "Dashboard", not "Tutor dashboard" — greeting people as
    // "Hello, Dashboard 👋" (PR #249 review). The component now owns the
    // no-name case, so no call site can supply a non-name.
    for (const value of [undefined, '', null]) {
      const { unmount } = renderWithProviders(<DashboardGreeting firstName={value} />);
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Hello 👋');
      // The comma belongs to the with-a-name string only.
      expect(heading.textContent).not.toContain(',');
      unmount();
    }
  });

  it('renders as h1 — the dashboards are the top heading in both apps', () => {
    // Neither app's chrome carries a page heading, so sit's <h2> skipped a
    // level. Unifying the idiom fixes that; pin it so a later tweak doesn't
    // quietly reintroduce the skip.
    renderWithProviders(<DashboardGreeting firstName="Marie" />);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('shows the context line only when one is given', () => {
    const { unmount } = renderWithProviders(
      <DashboardGreeting firstName="Marie" contextLine="DUPONT family" />,
    );
    expect(screen.getByText('DUPONT family')).toBeInTheDocument();
    unmount();

    renderWithProviders(<DashboardGreeting firstName="Marie" />);
    expect(screen.queryByText('DUPONT family')).not.toBeInTheDocument();
  });

  it('renders the action slot beside the greeting', () => {
    // The two provider dashboards hang their search-visibility pill here.
    renderWithProviders(
      <DashboardGreeting
        firstName="Marie"
       
        action={<button type="button">Active</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Active' })).toBeInTheDocument();
  });

  it('omits the action slot when the call site passes a falsy node', () => {
    // The tutor dashboard passes `enrollmentComplete && <button/>`, so `false`
    // reaches the slot on a legacy doc.
    renderWithProviders(
      <DashboardGreeting firstName="Marie" action={false as unknown as undefined} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
