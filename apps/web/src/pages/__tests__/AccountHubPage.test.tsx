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

  it('renders the sticky "Sync/Account" header (#445)', () => {
    renderHub(PARENT);
    expect(screen.getByText('Sync/Account')).toBeInTheDocument();
  });

  it('renders the header regardless of role — it is unconditional, unlike the sections below it', () => {
    renderHub(ADMIN);
    expect(screen.getByText('Sync/Account')).toBeInTheDocument();
  });

  it('orders sections Account, Sync/Sit, Sync/Study for a member who holds both roles (#445)', () => {
    renderHub(PARENT);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Account', 'sync/sit', 'sync/study']);
  });

  it('the header is fixed and full-bleed, not confined to the width-capped column this page renders inside', () => {
    // AccountHubPage is routed inside AccountLayout's PageContainer
    // (max-w-2xl) -- `fixed` is what keeps the header spanning the full
    // viewport there rather than reading as a card strip on desktop.
    renderHub(PARENT);
    const header = screen.getByText('Sync/Account').closest('header')!;
    expect(header.className).toMatch(/\bfixed\b/);
    expect(header.className).toMatch(/\binset-x-0\b/);
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
    // page, and its section heading ('Account') never renders without a sit
    // role. The sticky header ('Sync/Account') is unconditional, so it stays
    // -- it is a different string from the neutral section's own title.
    expect(screen.queryByText('Account')).toBeNull();
    expect(screen.queryByText('My account')).toBeNull();
    expect(screen.getByText('Sync/Account')).toBeInTheDocument();
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
