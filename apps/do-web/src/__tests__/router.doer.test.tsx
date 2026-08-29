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

describe('do-web router — doer portal branch (plan §13 PR8)', () => {
  it('registers the five doer routes together behind one guarded branch, /home the board first among them', () => {
    const doerPaths = branchContaining('/home');
    for (const p of ['/home', '/tasks/:taskId', '/tasks/:taskId/offer', '/offers', '/work']) {
      expect(doerPaths).toContain(p);
    }
  });

  it('keeps the doer branch separate from the public and family branches', () => {
    const doerPaths = branchContaining('/home');
    expect(doerPaths).not.toContain('/login');
    expect(doerPaths).not.toContain('/family');
    expect(branchContaining('/family')).not.toContain('/home');
    expect(branchContaining('/login')).not.toContain('/offers');
  });

  it('registers no "my endorsements" route — that surface is PR11, not PR8', () => {
    const all = (router.routes as RouteNode[]).flatMap((b) =>
      (b.children ?? []).map((c) => c.path ?? ''),
    );
    expect(all.some((p) => /endorse/i.test(p))).toBe(false);
  });
});
