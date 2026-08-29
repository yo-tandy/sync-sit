import { describe, it, expect, vi } from 'vitest';

// Route TABLE test (the router.public.test idiom): layouts stubbed so no
// auth store / Firebase init loads.
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/DoerLayout', () => ({ DoerLayout: () => null }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => null }));

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
  it('registers the three PR7 family routes together in their own branch', () => {
    const familyPaths = branchContaining('/family');
    expect(familyPaths).toContain('/family/post');
    expect(familyPaths).toContain('/family/tasks/:taskId');
  });

  it('keeps the family branch separate from the public and shell branches', () => {
    const familyPaths = branchContaining('/family');
    expect(familyPaths).not.toContain('/login');
    expect(familyPaths).not.toContain('/home');
    expect(branchContaining('/login')).not.toContain('/family');
    expect(branchContaining('/home')).not.toContain('/family');
  });
});
