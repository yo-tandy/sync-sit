import { describe, it, expect, vi } from 'vitest';

// Route TABLE test (the router.public.test idiom): layouts stubbed so no
// auth store / Firebase init loads.
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => null }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => null }));

import { Navigate } from 'react-router';
import { router } from '@/router';
import { BoardPage, DoerDashboardPage } from '@/lazyPages';

type RouteNode = { path?: string; children?: RouteNode[] };

function branchContaining(path: string): string[] {
  const branches = (router.routes as RouteNode[]).map(
    (b) => (b.children ?? []).map((c) => c.path).filter((p): p is string => !!p),
  );
  const hit = branches.find((paths) => paths.includes(path));
  if (!hit) throw new Error(`no branch contains ${path}`);
  return hit;
}

describe('do-web router — doer portal branch (plan §13 PR8, §9.2 at PR11)', () => {
  it('namespaces every doer surface under /doer/*, in one guarded branch (issue #296)', () => {
    const doerPaths = branchContaining('/doer/board');
    for (const p of [
      '/doer',
      '/doer/board',
      '/doer/tasks/:taskId',
      '/doer/tasks/:taskId/offer',
      '/doer/offers',
      '/doer/work',
      '/doer/endorsements',
    ]) {
      expect(doerPaths).toContain(p);
    }
    // §9.0 parity: the provider portal is namespaced like sit's /babysitter/*
    // and study's /tutor/*, so NO doer SURFACE may sit at the root any more.
    // (The old root paths survive as redirects, in their own branch — see
    // router.redirect.test.tsx.)
    for (const p of ['/home', '/offers', '/work', '/endorsements', '/tasks/:taskId']) {
      expect(doerPaths).not.toContain(p);
    }
  });

  // §9.0's route table, issue #360: the portal INDEX is the DASHBOARD, and
  // the board it displaced lives at /doer/board. Pinned as "not a Navigate"
  // as well as "is the dashboard page": the defect this issue exists to fix
  // was an index that dropped the student straight onto a list, and a forward
  // is exactly how that comes back.
  it('renders the doer dashboard at the portal index /doer', () => {
    const branch = (router.routes as RouteNode[]).find((b) =>
      (b.children ?? []).some((c) => c.path === '/doer/board'),
    );
    const index = branch?.children?.find((c) => c.path === '/doer') as
      | { element: React.ReactElement }
      | undefined;
    const board = branch?.children?.find((c) => c.path === '/doer/board') as
      | { element: React.ReactElement }
      | undefined;
    expect(index).toBeTruthy();
    expect(index!.element.type).not.toBe(Navigate);
    expect(index!.element.type).toBe(DoerDashboardPage);
    // …and it is a DIFFERENT page from the board, not the board re-mounted.
    expect(board!.element.type).toBe(BoardPage);
    expect(index!.element.type).not.toBe(board!.element.type);
  });

  it('keeps the doer branch separate from the public and family branches', () => {
    const doerPaths = branchContaining('/doer/board');
    expect(doerPaths).not.toContain('/login');
    expect(doerPaths).not.toContain('/family');
    expect(branchContaining('/family')).not.toContain('/doer/board');
    expect(branchContaining('/login')).not.toContain('/doer/offers');
  });

  // PR8's placeholder pinned this route ABSENT ("that surface is PR11").
  // PR11 is here: it must sit inside the DOER-guarded branch, and nowhere
  // else — an endorsement-management surface reachable from the public
  // branch would let anyone load it.
  it('registers "my endorsements" in the doer branch only (§9.2, PR11)', () => {
    expect(branchContaining('/doer/endorsements')).toContain('/doer/board');
    expect(branchContaining('/login')).not.toContain('/doer/endorsements');
    expect(branchContaining('/family')).not.toContain('/doer/endorsements');
  });
});
