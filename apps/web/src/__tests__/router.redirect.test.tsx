import { describe, it, expect, vi } from 'vitest';

/**
 * /family/invite was dropped (issue #340): co-parent management moved into
 * family settings and InvitePage.tsx is deleted. The path must survive as a
 * redirect so the invite links already in people's inboxes — and any
 * bookmark of the old page — don't 404.
 *
 * Mirrors apps/study-web/src/__tests__/router.redirect.test.tsx, the repo's
 * convention for exactly this situation (PR #343 round 4).
 */
vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));

import { Navigate } from 'react-router';
import { router } from '@/router';

function findRoute(path: string) {
  const walk = (routes: readonly { path?: string; children?: unknown }[]): unknown => {
    for (const r of routes) {
      if (r.path === path) return r;
      const kids = r.children as { path?: string; children?: unknown }[] | undefined;
      if (kids) {
        const hit = walk(kids);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(router.routes as { path?: string; children?: unknown }[]) as
    | { element: React.ReactElement<{ to?: string; replace?: boolean }> }
    | undefined;
}

describe('dropped co-parent page (issue #340)', () => {
  it('keeps /family/invite as a redirect to /family/settings', () => {
    const route = findRoute('/family/invite');
    expect(route).toBeTruthy();
    const el = route!.element;
    expect(el.type).toBe(Navigate);
    expect(el.props.to).toBe('/family/settings');
    expect(el.props.replace).toBe(true);
  });

  // No sibling "the page is really gone" assertion here, deliberately. study's
  // version checks its lazyPages barrel because study loads pages lazily; sit
  // imports its pages statically, so a surviving InvitePage import would fail
  // `tsc -p tsconfig.app.json` outright. A test asserting it would restate the
  // typechecker rather than pin anything the typechecker misses.
});
