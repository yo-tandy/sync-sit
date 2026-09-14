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
  logout: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => {
    h.callable(name);
    return h.mint;
  },
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: { userDoc: unknown; logout: () => Promise<void> }) => unknown) =>
    selector
      ? selector({ userDoc: h.userDoc, logout: h.logout })
      : { userDoc: h.userDoc, logout: h.logout },
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
    h.logout.mockReset().mockResolvedValue(undefined);
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

  it('a study row mints a handoff code and lands on /handoff with a validated next, not a plain link', async () => {
    renderHub(PARENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('Sessions'));
    await waitFor(() => expect(h.assign).toHaveBeenCalled());
    expect(h.callable).toHaveBeenCalledWith('createAppHandoffCode');
    // Fragment, not query: fragments never reach servers or logs. Code is
    // encoded -- 'abc+/=' round-trips only if encodeURIComponent is applied.
    // The parent-shaped destination is carried as `next`, itself encoded.
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=en&next=%2Ffamily%2Fsessions',
    );
    // The router must not be asked to push an absolute URL.
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('shows an error and stays put when the mint fails', async () => {
    h.mint.mockRejectedValue(new Error('offline'));
    renderHub(PARENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('Sessions'));
    // Await the error FIRST. Asserting `assign` synchronously here only says
    // the rejected mint has not been processed yet, which is trivially true
    // one tick after the click -- it would pass a regression that both set
    // the error AND navigated (#416 review round 4). The hint now renders on
    // EVERY study row (three of them), not just one -- assert at least one.
    const hints = await screen.findAllByText('Could not switch apps. Please try again.');
    expect(hints.length).toBeGreaterThan(0);
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('gives a PARENT the family-shaped study deep rows — My account, Sessions, Search', () => {
    renderHub(PARENT);
    const study = screen.getByText('sync/study').closest('section')!;
    for (const present of ['My account', 'Sessions', 'Search']) {
      expect(within(study).getByText(present)).toBeInTheDocument();
    }
    // The old single generic row is gone once a shaped row set is offered.
    expect(within(study).queryByText('Open sync-study')).toBeNull();
  });

  it('gives a STUDENT the tutor-shaped study deep rows, never the parent-shaped paths (issue #426)', async () => {
    // study guards /family/* on role="parent" — a sit student (babysitter)
    // must get study's tutor-shaped equivalents, not the parent rows.
    renderHub(STUDENT);
    const study = screen.getByText('sync/study').closest('section')!;
    for (const present of ['My account', 'Sessions', 'Search']) {
      expect(within(study).getByText(present)).toBeInTheDocument();
    }
    expect(within(study).queryByText('Open sync-study')).toBeNull();

    fireEvent.click(within(study).getByText('Sessions'));
    await waitFor(() => expect(h.assign).toHaveBeenCalled());
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-study-app.web.app/handoff#code=abc%2B%2F%3D&lang=en&next=%2Ftutor%2Fsessions',
    );
  });

  it('a STUDENT study "My account" row points at the tutor account path', async () => {
    renderHub(STUDENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('My account'));
    await waitFor(() => expect(h.assign).toHaveBeenCalled());
    expect(h.assign).toHaveBeenCalledWith(expect.stringContaining('next=%2Ftutor%2Faccount'));
  });

  it('a STUDENT study "Search" row points at the tutor published-searches path', async () => {
    renderHub(STUDENT);
    const study = screen.getByText('sync/study').closest('section')!;
    fireEvent.click(within(study).getByText('Search'));
    await waitFor(() => expect(h.assign).toHaveBeenCalled());
    expect(h.assign).toHaveBeenCalledWith(
      expect.stringContaining('next=%2Ftutor%2Fpublished-searches'),
    );
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

/**
 * The footer slot (#491): `AccountHome`'s docstring reserves it for "sign
 * out, delete account", and this is the first thing to fill it. The dialog
 * gate, the error mapping and the sign-out-then-navigate ordering are all
 * `DeleteAccountSection`'s own behaviour (unit-tested in
 * `packages/shared-ui/src/pages/__tests__/DeleteAccountSection.test.tsx`) --
 * these tests are about the WIRING: the real callable name, the confirmation
 * payload, and that this app's `logout`/`navigate` are the ones actually
 * passed through.
 */
describe('AccountHubPage — delete account footer (#491)', () => {
  beforeEach(() => {
    h.userDoc = PARENT;
    h.navigate.mockReset();
    h.assign.mockReset();
    h.callable.mockReset();
    h.mint.mockReset();
    h.logout.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('location', { assign: h.assign });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function openDeleteDialog() {
    renderHub(PARENT);
    fireEvent.click(screen.getByText('Delete my account'));
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
  }

  it('renders sign out and delete rows in the footer', () => {
    renderHub(PARENT);
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    expect(screen.getByText('Delete my account')).toBeInTheDocument();
  });

  it('sign out calls the auth store directly, with no confirmation and no callable', () => {
    renderHub(PARENT);
    fireEvent.click(screen.getByText('Sign out'));
    expect(h.logout).toHaveBeenCalledTimes(1);
    expect(h.callable).not.toHaveBeenCalledWith('deleteMyAccount');
  });

  it('the delete confirm button stays disabled until the typed word matches', () => {
    renderHub(PARENT);
    fireEvent.click(screen.getByText('Delete my account'));
    const confirmButton = screen.getByRole('button', { name: 'Yes, delete my account' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'delete' },
    });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    expect(confirmButton).not.toBeDisabled();
  });

  it('calls deleteMyAccount with the fixed confirmation token, then signs out, then lands on /account-deleted', async () => {
    h.mint.mockResolvedValue(undefined);
    openDeleteDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/account-deleted'));
    expect(h.callable).toHaveBeenCalledWith('deleteMyAccount');
    expect(h.callable).toHaveBeenCalledTimes(1);
    expect(h.mint).toHaveBeenCalledWith({ confirm: 'DELETE' });
    expect(h.mint).toHaveBeenCalledTimes(1);
    expect(h.logout).toHaveBeenCalledTimes(1);
  });

  it('maps admin/last-admin to its own copy, keeps the dialog open and never signs out or navigates', async () => {
    h.mint.mockRejectedValue(
      Object.assign(new Error('last admin'), {
        code: 'functions/failed-precondition',
        details: { code: 'admin/last-admin' },
      }),
    );
    openDeleteDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText(
        "You're the last admin. Appoint another admin before deleting your account.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(h.logout).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalledWith('/account-deleted');
  });

  it('falls back to the generic failure copy for an unmapped rejection, and keeps the dialog open', async () => {
    h.mint.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'functions/internal' }),
    );
    openDeleteDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText('Something went wrong. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete my account?')).toBeInTheDocument();
    expect(h.logout).not.toHaveBeenCalled();
  });
});
