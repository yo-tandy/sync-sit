import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

const h = vi.hoisted(() => ({ userDoc: null as unknown }));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { userDoc: unknown }) => unknown) =>
    selector ? selector({ userDoc: h.userDoc }) : { userDoc: h.userDoc },
}));

import i18n from '@/i18n';
import { AccountHubPage } from '../AccountHubPage';

const PARENT = { uid: 'p1', profiles: { parent: { familyId: 'f1' } } };
const STUDENT = { uid: 's1', profiles: { babysitter: { enrollmentComplete: true } } };

function renderHub(userDoc: unknown) {
  h.userDoc = userDoc;
  render(
    <MemoryRouter initialEntries={['/account']}>
      <I18nextProvider i18n={i18n}>
        <AccountHubPage />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

describe('AccountHubPage (sit)', () => {
  beforeEach(() => {
    h.userDoc = null;
  });
  afterEach(() => cleanup());

  it('offers the four shared entries to a parent', () => {
    renderHub(PARENT);
    for (const label of ['My account', 'My family', 'Supervised kids', 'Verification']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('has NO back button — the bottom bar is the way out (owner, decision 24)', () => {
    // A back arrow would frame the account as sitting underneath whichever
    // portal you arrived from. It sits beside them.
    renderHub(PARENT);
    expect(screen.queryByRole('button', { name: /back|retour/i })).toBeNull();
  });

  it('shows a study section even though this is the sit app', () => {
    // The hub is shared: it lists every app's settings, not just the host's.
    renderHub(PARENT);
    expect(screen.getByText('sync/study')).toBeInTheDocument();
  });

  it('does NOT offer study favorites — study has no tutor equivalent', () => {
    // Absent, not disabled: rendering a row for a feature that does not exist
    // is worse than omitting it.
    renderHub(PARENT);
    const studySection = screen.getByText('sync/study').closest('section')!;
    expect(within(studySection).queryByText('Favorites')).toBeNull();
  });

  it('routes study rows cross-origin, sit rows in-app', () => {
    renderHub(PARENT);
    const sit = screen.getByText('sync/sit').closest('section')!;
    const study = screen.getByText('sync/study').closest('section')!;
    expect(within(sit).getByText('Appointments')).toBeInTheDocument();
    expect(within(study).getByText('Sessions')).toBeInTheDocument();
  });

  it('gives a STUDENT their own account row and no family rows', () => {
    // A student belongs to no family in sit and supervises nobody, so those
    // three shared rows would lead nowhere for them.
    renderHub(STUDENT);
    expect(screen.getAllByText('My account').length).toBeGreaterThan(0);
    expect(screen.queryByText('My family')).toBeNull();
    expect(screen.queryByText('Supervised kids')).toBeNull();
  });

  it('gives a student the student-side sit destinations', () => {
    renderHub(STUDENT);
    const sit = screen.getByText('sync/sit').closest('section')!;
    // Students have no "Appointments" row — their dashboard is that view.
    expect(within(sit).queryByText('Appointments')).toBeNull();
    expect(within(sit).getByText('Endorsements')).toBeInTheDocument();
  });
});
