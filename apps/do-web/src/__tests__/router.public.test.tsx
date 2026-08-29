import { describe, it, expect, vi } from 'vitest';

// The route TABLE is the unit under test — which paths are registered under
// which layout branch — so the layouts themselves are stubbed out: importing
// them for real would drag in the auth store / Firebase init, none of which
// matters for asserting route grouping (mirrors study-web's router tests).
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => null }));

import { Navigate } from 'react-router';
import { router } from '@/router';

type RouteNode = { path?: string; children?: RouteNode[] };

/** The child paths of the branch that contains the given path. */
function branchContaining(path: string): string[] {
  const branches = (router.routes as RouteNode[]).map(
    (b) => (b.children ?? []).map((c) => c.path).filter((p): p is string => !!p),
  );
  const hit = branches.find((paths) => paths.includes(path));
  if (!hit) throw new Error(`no branch contains ${path}`);
  return hit;
}

describe('do-web router — shell route table', () => {
  it('registers the shared public pages in the guard-free public branch', () => {
    // The branch that serves /login is the PublicLayout branch (no AuthGuard —
    // that is what makes '/login' reachable signed-out in the first place).
    const publicPaths = branchContaining('/login');
    for (const p of ['/', '/signup', '/forgot-password', '/about', '/privacy', '/terms', '/report']) {
      expect(publicPaths).toContain(p);
    }
  });

  it('keeps the enrollment placeholders public (they are sign-up destinations)', () => {
    const publicPaths = branchContaining('/login');
    expect(publicPaths).toContain('/enroll/doer');
    expect(publicPaths).toContain('/enroll/parent');
  });

  it('registers /home in its own guarded branch, not the public one', () => {
    const homePaths = branchContaining('/home');
    const publicPaths = branchContaining('/login');
    expect(homePaths).not.toContain('/login');
    expect(publicPaths).not.toContain('/home');
  });

  it('sends unknown public paths back to the welcome page', () => {
    const publicBranch = (router.routes as RouteNode[]).find((b) =>
      (b.children ?? []).some((c) => c.path === '/login'),
    );
    const catchAll = publicBranch?.children?.find((c) => c.path === '*');
    expect(catchAll).toBeTruthy();
    const el = (catchAll as { element?: React.ReactElement<{ to?: string; replace?: boolean }> })
      .element;
    expect(el?.type).toBe(Navigate);
    expect(el?.props.to).toBe('/');
    expect(el?.props.replace).toBe(true);
  });

  it('registers NO handoff receiver: arriving from the siblings is the owner-gated direction (decision 20)', () => {
    // do-web links OUT to sit/study; a /handoff receiver here only becomes
    // meaningful when the sit/study switchers may point at sync-do — the
    // flip tracked as issue #304. Guard against it arriving early.
    const allPaths = (router.routes as RouteNode[]).flatMap((b) =>
      (b.children ?? []).map((c) => c.path),
    );
    expect(allPaths).not.toContain('/handoff');
  });
});
