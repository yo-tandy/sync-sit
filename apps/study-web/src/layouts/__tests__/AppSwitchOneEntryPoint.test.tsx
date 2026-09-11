import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { vi } from 'vitest';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));
vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/stores/authStore', () => {
  const state = {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' },
    logout: vi.fn(),
  };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { renderWithProviders } from '@/__tests__/test-utils';
import { TutorLayout } from '../TutorLayout';
import { FamilyLayout } from '../FamilyLayout';

/**
 * "Exactly one entry point per breakpoint" (#417, plan Q9) -- unlike
 * DesktopShell.test.tsx's suite this renders the REAL `AppBar`/`FamilyAppBar`
 * (not mocked away), because the inline switcher lives inside them. jsdom
 * evaluates no media queries, so both halves of the pair are always in the
 * DOM at once; the responsive CONTRACT is the classes, not visibility.
 */
const SWITCH_LABEL = { name: /switch app/i } as const;

describe('exactly one app-switch entry point per breakpoint (#417, plan Q9)', () => {
  afterEach(cleanup);

  it.each([
    ['TutorLayout', <TutorLayout key="t" />, '/tutor'],
    ['FamilyLayout', <FamilyLayout key="f" />, '/family'],
  ] as const)('%s: the bottom bar and the inline switcher are the only two, and never overlap', (_name, layout, path) => {
    renderWithProviders(
      <Routes>
        <Route element={layout}>
          <Route path={path} element={<div>page</div>} />
        </Route>
      </Routes>,
      path,
    );

    const landmarks = screen.getAllByRole('navigation', SWITCH_LABEL);
    expect(landmarks).toHaveLength(2);

    const bar = landmarks.find((n) => /\bfixed\b/.test(n.className))!;
    const inline = landmarks.find((n) => n !== bar)!;
    expect(bar).toBeTruthy();
    expect(inline).toBeTruthy();

    // The bar: visible by default, hidden ONLY at md+.
    expect(bar.className).toMatch(/\bmd:hidden\b/);
    expect(bar.className).not.toMatch(/(?<!:)\bhidden\b/);

    // The inline switcher: hidden by default, visible ONLY at md+.
    expect(inline.className).toMatch(/(?<!:)\bhidden\b/);
    expect(inline.className).toMatch(/\bmd:flex\b/);
    expect(inline.className).not.toMatch(/\bmd:hidden\b/);
  });
});
