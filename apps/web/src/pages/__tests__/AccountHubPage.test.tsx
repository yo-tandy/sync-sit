import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';

const h = vi.hoisted(() => ({
  userDoc: null as unknown,
  navigate: vi.fn(),
  assign: vi.fn(),
  mint: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    h.callable(name);
    return h.mint;
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { userDoc: unknown }) => unknown) =>
    selector ? selector({ userDoc: h.userDoc }) : { userDoc: h.userDoc },
}));

vi.mock('react-router', async () => ({
  ...(await vi.importActual<typeof import('react-router')>('react-router')),
  useNavigate: () => h.navigate,
}));

import i18n from '@/i18n';
import { AccountHubPage } from '../AccountHubPage';

const PARENT = { uid: 'p1', profiles: { parent: { familyId: 'f1' } } };
const STUDENT = { uid: 's1', profiles: { babysitter: { enrollmentComplete: true } } };
const ADMIN = { uid: 'a1', profiles: { admin: {} } };
/** Signed in, no sit profile at all -- a study-only tutor. AuthGuard admits them. */
const NO_SIT_ROLE = { uid: 't1', profiles: { tutor: { enrollmentComplete: true } } };

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
    h.navigate.mockReset();
    h.assign.mockReset();
    h.callable.mockReset();
    h.mint.mockReset().mockResolvedValue({ data: { code: 'abc+/=' } });
    vi.stubGlobal('location', { assign: h.assign });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  /*
   * These three replace a pin that asserted only that two labels were present
   * (#416 review). Label presence passes with the two handlers SWAPPED, which
   * is exactly where the bug lived: the study rows were doing a plain
   * location.assign instead of the session handoff. So each one now CLICKS a
   * row and asserts which mechanism fired -- and that the other did not.
   */
  it('a sit row navigates in-app and never leaves the origin', async () => {
    renderHub(PARENT);
    const sit = screen.getByText('sync/sit').closest('section')!;
    fireEvent.click(within(sit).getByText('Appointments'));
    expect(h.navigate).toHaveBeenCalledWith('/family/appointments');
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('the study row mints a handoff code and lands on /handoff, not a deep link', async () => {
    renderHub(PARENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('Open sync-study'));
    await waitFor(() => expect(h.assign).toHaveBeenCalled());
    expect(h.callable).toHaveBeenCalledWith('createAppHandoffCode');
    // Fragment, not query: fragments never reach servers or logs. Code is
    // encoded -- 'abc+/=' round-trips only if encodeURIComponent is applied.
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=en',
    );
    // The router must not be asked to push an absolute URL.
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('shows an error and stays put when the mint fails', async () => {
    h.mint.mockRejectedValue(new Error('offline'));
    renderHub(PARENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('Open sync-study'));
    // Await the error FIRST. Asserting `assign` synchronously here only says
    // the rejected mint has not been processed yet, which is trivially true
    // one tick after the click -- it would pass a regression that both set
    // the error AND navigated (#416 review round 4).
    expect(await screen.findByText('Could not switch apps. Please try again.')).toBeInTheDocument();
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('offers no study DEEP links — study drops the destination on arrival', () => {
    // Absent beats broken: study's HandoffPage reads only code+lang and always
    // routes via postLoginRouter, and its /family/* routes are parent-guarded.
    renderHub(STUDENT);
    const study = screen.getByText('sync/study').closest('section')!;
    for (const gone of ['Sessions', 'Search']) {
      expect(within(study).queryByText(gone)).toBeNull();
    }
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

  /**
   * ABSENT BEATS BROKEN, applied to roles (#416 review round 4).
   *
   * `getSitRole` is four-way. Collapsing it to `role === 'parent'` handed
   * admins and role-less members the BABYSITTER rows, every one of which
   * bounces off `BabysitterLayout`'s `role="babysitter"` guard — an admin to
   * `/admin`, a study-only tutor to `/welcome-sit`. `AuthGuard` deliberately
   * admits both to this page, so the rows have to be absent rather than
   * broken.
   */
  it.each([
    ['an admin', ADMIN],
    ['a member with no sit role', NO_SIT_ROLE],
  ])('offers %s no sit rows rather than rows that bounce', (_who, doc) => {
    renderHub(doc);
    expect(screen.queryByText('sync/sit')).toBeNull();
    // The neutral block goes too: its only row is the same per-role account
    // page. `AccountHome` also renders the hub TITLE as 'My account', so this
    // asserts the single remaining occurrence is the <h1> and not a row.
    const myAccount = screen.getAllByText('My account');
    expect(myAccount).toHaveLength(1);
    expect(myAccount[0].tagName).toBe('H1');
    for (const bounces of ['Endorsements', 'Favorites', 'Search']) {
      expect(screen.queryByText(bounces)).toBeNull();
    }
  });

  it.each([
    ['an admin', ADMIN],
    ['a member with no sit role', NO_SIT_ROLE],
  ])('still offers %s the study handoff, which works for them', (_who, doc) => {
    renderHub(doc);
    const study = screen.getByText('sync/study').closest('section')!;
    expect(within(study).getByText('Open sync-study')).toBeInTheDocument();
  });
});
