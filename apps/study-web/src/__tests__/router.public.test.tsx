import { describe, it, expect, vi } from 'vitest';

// The route TABLE is the unit under test — which paths are registered under
// which layout branch — so the layouts themselves are stubbed out: importing
// them for real would drag in the auth store / Firebase init, none of which
// matters for asserting route grouping. The lazy page modules are untouched
// (lazy() never fetches until render, and nothing is rendered here).
vi.mock('@/layouts/PublicLayout', () => ({ PublicLayout: () => null }));
vi.mock('@/layouts/TutorLayout', () => ({ TutorLayout: () => null }));
vi.mock('@/layouts/FamilyLayout', () => ({ FamilyLayout: () => null }));

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

describe('router — guide routes are public (issue #236)', () => {
  it('registers /guide/tutors and /guide/parents in the guard-free public branch', () => {
    // The branch that serves /login is the PublicLayout branch (no AuthGuard —
    // that is what makes '/login' reachable signed-out in the first place).
    const publicPaths = branchContaining('/login');
    expect(publicPaths).toContain('/guide/tutors');
    expect(publicPaths).toContain('/guide/parents');
  });

  it('does not register the guide routes under the tutor or family portal branches', () => {
    const tutorPaths = branchContaining('/tutor');
    const familyPaths = branchContaining('/family');
    for (const guide of ['/guide/tutors', '/guide/parents']) {
      expect(tutorPaths).not.toContain(guide);
      expect(familyPaths).not.toContain(guide);
    }
  });

  it('mirrors sit exactly: the same /guide/parents path, and /guide/tutors for the provider role', () => {
    // Sit registers /guide/parents + /guide/babysitters; study's provider is
    // the tutor. Guard against a drive-by rename breaking deep links.
    const publicPaths = branchContaining('/about');
    expect(publicPaths.filter((p) => p.startsWith('/guide/'))).toEqual([
      '/guide/tutors',
      '/guide/parents',
    ]);
  });
});
