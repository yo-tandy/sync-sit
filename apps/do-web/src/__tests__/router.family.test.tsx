import { describe, it, expect, vi } from 'vitest';

// Route TABLE test (the router.public.test idiom): layouts stubbed so no
// auth store / Firebase init loads.
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => null }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => null }));

import { Navigate } from 'react-router';
import { router } from '@/router';
import { FamilyDashboardPage, MyTasksPage } from '@/lazyPages';

type RouteNode = { path?: string; children?: RouteNode[] };

function branchContaining(path: string): string[] {
  const branches = (router.routes as RouteNode[]).map(
    (b) => (b.children ?? []).map((c) => c.path).filter((p): p is string => !!p),
  );
  const hit = branches.find((paths) => paths.includes(path));
  if (!hit) throw new Error(`no branch contains ${path}`);
  return hit;
}

describe('do-web router — family portal branch (plan §13 PR7)', () => {
  it('registers the PR7 family routes together in their own branch', () => {
    const familyPaths = branchContaining('/family');
    expect(familyPaths).toContain('/family/tasks');
    expect(familyPaths).toContain('/family/post');
    expect(familyPaths).toContain('/family/tasks/:taskId');
  });

  // §9.0's route table, issue #360: the portal INDEX is the DASHBOARD, and
  // the list it displaced lives at /family/tasks (issue #296). Pinned as "not
  // a Navigate" as well as "is the dashboard page": the defect this issue
  // exists to fix was an index that dropped the parent straight onto a list,
  // and a forward is exactly how that comes back.
  it('renders the family dashboard at the portal index /family', () => {
    const branch = (router.routes as RouteNode[]).find((b) =>
      (b.children ?? []).some((c) => c.path === '/family/tasks'),
    );
    const index = branch?.children?.find((c) => c.path === '/family') as
      | { element: React.ReactElement }
      | undefined;
    const list = branch?.children?.find((c) => c.path === '/family/tasks') as
      | { element: React.ReactElement }
      | undefined;
    expect(index).toBeTruthy();
    expect(index!.element.type).not.toBe(Navigate);
    expect(index!.element.type).toBe(FamilyDashboardPage);
    // …and it is a DIFFERENT page from the list, not the list re-mounted.
    expect(list!.element.type).toBe(MyTasksPage);
    expect(index!.element.type).not.toBe(list!.element.type);
  });

  it('keeps the family branch separate from the public and doer branches', () => {
    const familyPaths = branchContaining('/family');
    expect(familyPaths).not.toContain('/login');
    expect(familyPaths).not.toContain('/doer/board');
    expect(branchContaining('/login')).not.toContain('/family');
    expect(branchContaining('/doer/board')).not.toContain('/family');
  });
});
