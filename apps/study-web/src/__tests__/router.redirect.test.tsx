import { describe, it, expect, vi } from 'vitest';

/**
 * /enroll/tutor/success was dropped (issue #242, parity Q5=b): enrollment
 * routes straight to the tutor dashboard. The path must survive as a
 * redirect so stale links and bookmarks don't 404.
 */
vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));

import { Navigate } from 'react-router';
import { router } from '@/router';

describe('dropped success interstitial (issue #242)', () => {
  it('keeps /enroll/tutor/success as a redirect to /tutor', () => {
    const routes = router.routes[0]?.children ?? router.routes;
    const route = routes.find((r) => r.path === '/enroll/tutor/success');
    expect(route).toBeTruthy();
    const el = route!.element as React.ReactElement<{ to?: string; replace?: boolean }>;
    expect(el.type).toBe(Navigate);
    expect(el.props.to).toBe('/tutor');
    expect(el.props.replace).toBe(true);
  });

  it('has no TutorSuccessPage export anymore (the lazy entry is gone)', async () => {
    // JSON.stringify of router.routes can never see a lazy component's name
    // (PR #257 round 1: that assertion passed for ANY component) -- assert
    // the observable instead: the lazyPages module no longer exports it.
    const lazyPages = await import('@/lazyPages');
    expect('TutorSuccessPage' in lazyPages).toBe(false);
    // And the only route on the old path is the redirect itself.
    const routes = router.routes[0]?.children ?? router.routes;
    const matches = routes.filter((r) => r.path === '/enroll/tutor/success');
    expect(matches).toHaveLength(1);
    expect((matches[0].element as React.ReactElement).type).toBe(Navigate);
  });
});
