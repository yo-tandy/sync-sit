import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

/**
 * The live-mail guarantee (issue #296).
 *
 * The doer portal moved off the root and under `/doer/*` for §9.0 parity with
 * sit (`/babysitter/*`) and study (`/tutor/*`), and the family task LIST moved
 * off `/family` to `/family/tasks`. sync-do is LIVE at sync-do-app.web.app and
 * PR9's notification mail deep-links five of the old paths — that mail is
 * already in people's inboxes and cannot be recalled, so every old path must
 * keep RESOLVING, not 404.
 *
 * These assertions drive the real route table rather than inspecting route
 * objects: each old URL is fed to a memory router built from `router.routes`,
 * and the assertion is on where the browser ends up. A missing redirect lands
 * on the public branch's `*` catch-all at `/` — a wrong destination, which is
 * exactly the failure this pins. (Mirrors apps/web and apps/study-web's
 * `router.redirect.test.tsx`, extended from "the entry is a Navigate" to "the
 * URL actually arrives", because here it is live mail and not a bookmark that
 * depends on it.)
 *
 * Layouts are stubbed to a bare <Outlet> and every page to null, so no auth
 * store, Firebase init or page chunk loads: the unit under test is the route
 * table alone. The stubs must still RENDER their children — a layout stubbed
 * to null (the other router tests' idiom, which only reads the table) would
 * swallow the nested `<Navigate>` and make an index redirect look broken.
 * Dropping the guards this way is sound here because the destinations' own
 * guards decide who may SEE them — which is also why the legacy branch is
 * pathless and unguarded: it forwards before any guard runs.
 */
import { Outlet } from 'react-router';

// vi.mock factories are hoisted above every top-level binding, so each one
// defines its own stub rather than sharing one.
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => <Outlet /> }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => <Outlet /> }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => <Outlet /> }));
vi.mock('@/lazyPages', () => {
  const Blank = () => null;
  return Object.fromEntries(
    [
      'WelcomePage',
      'LoginPage',
      'SignUpRolePage',
      'ForgotPasswordPage',
      'AboutPage',
      'ReportProblemPage',
      'ComingSoonPage',
      'DoerEnrollment',
      'BoardPage',
      'DoerTaskDetailPage',
      'OfferPage',
      'MyOffersPage',
      'MyWorkPage',
      'MyEndorsementsPage',
      'MyTasksPage',
      'PostTaskPage',
      'TaskDetailPage',
    ].map((name) => [name, Blank]),
  );
});

import { createMemoryRouter, RouterProvider } from 'react-router';
import { router } from '@/router';

/** Where does `from` land once the table has had its say? */
async function resolves(from: string): Promise<string> {
  const memory = createMemoryRouter(router.routes, { initialEntries: [from] });
  render(<RouterProvider router={memory} />);
  await waitFor(() => expect(memory.state.navigation.state).toBe('idle'));
  return memory.state.location.pathname;
}

describe('pre-namespace paths still resolve (issue #296 — PR9 mail is already sent)', () => {
  it.each([
    // The five paths PR9's notifyContent.ts builds CTAs on.
    ['/home', '/doer/board'],
    ['/offers', '/doer/offers'],
    ['/work', '/doer/work'],
    ['/endorsements', '/doer/endorsements'],
    ['/tasks/task-abc', '/doer/tasks/task-abc'],
    // Not in mail, but it was a real in-app URL people could bookmark.
    ['/tasks/task-abc/offer', '/doer/tasks/task-abc/offer'],
  ])('%s forwards to %s', async (from, to) => {
    await expect(resolves(from)).resolves.toBe(to);
  });

  // The two temporary index redirects. PR B (the dashboards PR, stacked on
  // this one) replaces BOTH with real dashboard pages; when it does, these
  // two expectations flip to "renders the dashboard" and the rest of this
  // file stays exactly as it is.
  it('forwards the portal indexes to their current landing surfaces', async () => {
    await expect(resolves('/doer')).resolves.toBe('/doer/board');
    await expect(resolves('/family')).resolves.toBe('/family/tasks');
  });

  // Guard against the redirect "working" only because the catch-all swallowed
  // it: an unknown path must still land on the welcome page, so a destination
  // of '/' is never a pass above.
  it('still sends genuinely unknown paths to the welcome page', async () => {
    await expect(resolves('/no-such-page')).resolves.toBe('/');
  });
});
