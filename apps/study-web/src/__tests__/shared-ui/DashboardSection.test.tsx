import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { DashboardSection } from '@ejm/shared-ui';

/**
 * The shared collapsible dashboard section (issue #338). Pinned once here
 * rather than four times across the two apps' dashboard tests — it now backs
 * both provider dashboards AND both family dashboards.
 *
 * Lives in study-web because shared-ui has no runner of its own and is absent
 * from `test:unit`'s filter list (same reason as DashboardGreeting.test).
 */
describe('DashboardSection', () => {
  it('renders the title, the count badge and its rows, open by default', () => {
    renderWithProviders(
      <DashboardSection title="New requests" count={2} variant="pending">
        <p>row one</p>
      </DashboardSection>,
    );
    expect(screen.getByRole('heading', { name: /New requests/ })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('row one')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders nothing when there is nothing to show', () => {
    renderWithProviders(
      <DashboardSection title="New requests" count={0} variant="pending">
        <p>row one</p>
      </DashboardSection>,
    );
    // renderWithProviders mounts the toast live-regions, so assert on the
    // section's own markup rather than an empty container.
    expect(screen.queryByRole('heading', { name: /New requests/ })).not.toBeInTheDocument();
    expect(screen.queryByText('row one')).not.toBeInTheDocument();
  });

  it('gates on `total`, badges on `count` — a section of "waiting on them" rows still shows', () => {
    // The whole reason `total` exists: a to-do count of zero must not hide
    // rows that are legitimately awaiting the other side (PR #194 review).
    renderWithProviders(
      <DashboardSection title="New requests" count={0} total={3} variant="pending">
        <p>row one</p>
      </DashboardSection>,
    );
    expect(screen.getByRole('heading', { name: /New requests/ })).toBeInTheDocument();
    expect(screen.getByText('row one')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('hides the rows when the header is clicked, and brings them back', () => {
    renderWithProviders(
      <DashboardSection title="Confirmed" count={1} variant="confirmed">
        <p>row one</p>
      </DashboardSection>,
    );
    const header = screen.getByRole('button');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('row one')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText('row one')).toBeInTheDocument();
  });

  it('honours defaultOpen={false} for the history sections', () => {
    renderWithProviders(
      <DashboardSection title="Past" count={4} variant="past" defaultOpen={false}>
        <p>row one</p>
      </DashboardSection>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('row one')).not.toBeInTheDocument();
  });

  it('wraps the toggle in the heading, not the other way round (valid content model)', () => {
    // Both source dashboards had <h3> INSIDE <button> — a button takes
    // phrasing content, a heading is flow content — and AT flattens a button's
    // descendants into its name, so the titles were not reachable by heading
    // navigation at all. jsdom is more permissive than real AT, which is why
    // no test caught it. This is the WAI-ARIA APG accordion shape (PR #345
    // round 2).
    renderWithProviders(
      <DashboardSection title="New requests" count={2} variant="pending">
        <p>row one</p>
      </DashboardSection>,
    );
    const heading = screen.getByRole('heading');
    const toggle = screen.getByRole('button');
    expect(heading.tagName).toBe('H3');
    expect(heading.contains(toggle)).toBe(true);
    // ...and nothing flow-level is left inside the button.
    expect(toggle.querySelector('h1,h2,h3,h4,h5,h6,div,p')).toBeNull();
  });

  it('completes the disclosure: aria-controls points at the content it opens', () => {
    renderWithProviders(
      <DashboardSection title="New requests" count={2} variant="pending">
        <p>row one</p>
      </DashboardSection>,
    );
    const toggle = screen.getByRole('button');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toContainElement(screen.getByText('row one'));
  });

  it('lets a call site opt out of the default row stacking', () => {
    // sit's AppointmentCard carries its own mb-3; stacking it again would pay
    // the gap twice.
    renderWithProviders(
      <DashboardSection title="Past" count={1} variant="past" contentClassName="">
        <p>row one</p>
      </DashboardSection>,
    );
    expect(screen.getByText('row one').parentElement).not.toHaveClass('space-y-3');
  });
});
