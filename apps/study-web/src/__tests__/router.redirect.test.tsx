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

  it('has no TutorSuccessPage route or page anymore', () => {
    const flat = JSON.stringify(router.routes, (_k, v) => (typeof v === 'function' ? v.name : v));
    expect(flat).not.toContain('TutorSuccessPage');
  });
});
