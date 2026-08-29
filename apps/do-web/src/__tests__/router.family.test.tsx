import { describe, it, expect, vi } from 'vitest';

// Route TABLE test (the router.public.test idiom): layouts stubbed so no
// auth store / Firebase init loads.
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => null }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => null }));

import { Navigate } from 'react-router';
import { router } from '@/router';

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

  // TEMPORARY: replaced by PR B's family dashboard. The LIST moved off
  // /family to /family/tasks (issue #296) to make room for it.
  it('forwards the portal index /family to the task list', () => {
    const branch = (router.routes as RouteNode[]).find((b) =>
      (b.children ?? []).some((c) => c.path === '/family/tasks'),
    );
    const index = branch?.children?.find((c) => c.path === '/family') as
      | { element: React.ReactElement<{ to?: string; replace?: boolean }> }
      | undefined;
    expect(index).toBeTruthy();
    expect(index!.element.type).toBe(Navigate);
    expect(index!.element.props.to).toBe('/family/tasks');
    expect(index!.element.props.replace).toBe(true);
  });

  it('keeps the family branch separate from the public and doer branches', () => {
    const familyPaths = branchContaining('/family');
    expect(familyPaths).not.toContain('/login');
    expect(familyPaths).not.toContain('/doer/board');
    expect(branchContaining('/login')).not.toContain('/family');
    expect(branchContaining('/doer/board')).not.toContain('/family');
  });
});
