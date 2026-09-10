import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, cleanup, within } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { AccountHome, type AccountSection } from '../AccountHome.js';
import type { AppMark } from '../../lib/brandMarks.js';

afterEach(cleanup);

// Fake marks (#422): this test exercises AccountHome's own contract, not
// shared-ui's real PNGs.
const SIT_MARK: AppMark = { sm: 'sit-48.png', md: 'sit-96.png' };
const STUDY_MARK: AppMark = { sm: 'study-48.png', md: 'study-96.png' };

/** A both-roles fixture: Account, Sync/Sit, Sync/Study, in that order. */
const BOTH_ROLES_SECTIONS: AccountSection[] = [
  { title: 'Account', rows: [{ label: 'My account', href: '/family/account' }] },
  { app: 'sit', mark: SIT_MARK, rows: [{ label: 'Appointments', href: '/family/appointments' }] },
  { app: 'study', mark: STUDY_MARK, rows: [{ label: 'Sessions', href: '/family/sessions' }] },
];

function renderHome(sections: AccountSection[]) {
  return renderWithProviders(
    <AccountHome sections={sections} onNavigate={vi.fn()} onNavigateExternal={vi.fn()} />,
  );
}

describe('AccountHome sticky header (#445)', () => {
  it('renders a header titled "Sync/Account"', () => {
    renderHome(BOTH_ROLES_SECTIONS);
    expect(screen.getByText('Sync/Account')).toBeInTheDocument();
  });

  it('has NO back button on the header -- the hub is a tab, not a pushed page (#416 decision, kept)', () => {
    renderHome(BOTH_ROLES_SECTIONS);
    expect(screen.queryByRole('button', { name: /back|retour/i })).toBeNull();
    // Defensive: the header itself contains no button at all -- only the
    // rows below it do, and those are navigation rows, not a back arrow.
    const header = screen.getByText('Sync/Account').closest('div')!;
    expect(within(header).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('AccountHome section order (#445)', () => {
  it('renders Account, Sync/Sit, Sync/Study in that DOM order for a both-roles fixture', () => {
    renderHome(BOTH_ROLES_SECTIONS);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Account', 'sync/sit', 'sync/study']);
  });

  it('role-absence still works: a role with only the study section renders just that heading', () => {
    // Mirrors AccountHubPage's admin/no-sit-role case: the neutral block and
    // the sit block are both absent, only the study handoff row remains.
    const studyOnly: AccountSection[] = [
      { app: 'study', mark: STUDY_MARK, rows: [{ label: 'Open sync-study', href: 'https://x', external: true }] },
    ];
    renderHome(studyOnly);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['sync/study']);
    expect(screen.queryByText('Account')).toBeNull();
    expect(screen.queryByText('sync/sit')).toBeNull();
    // The sticky header still renders regardless of which sections are present.
    expect(screen.getByText('Sync/Account')).toBeInTheDocument();
  });

  it('a section with no rows is dropped entirely, including from the order (absent beats broken)', () => {
    const withEmptySit: AccountSection[] = [
      BOTH_ROLES_SECTIONS[0]!,
      { app: 'sit', mark: SIT_MARK, rows: [] },
      BOTH_ROLES_SECTIONS[2]!,
    ];
    renderHome(withEmptySit);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Account', 'sync/study']);
  });
});

describe('AccountHome rows (unchanged by #445)', () => {
  it('still renders each section’s rows under its own heading', () => {
    renderHome(BOTH_ROLES_SECTIONS);
    const sit = screen.getByText('sync/sit').closest('section')!;
    expect(within(sit).getByText('Appointments')).toBeInTheDocument();
    const study = screen.getByText('sync/study').closest('section')!;
    expect(within(study).getByText('Sessions')).toBeInTheDocument();
  });
});
