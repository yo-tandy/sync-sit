import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('../AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
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

import i18n from '@/i18n';
import { FamilyLayout } from '../FamilyLayout';
import { BabysitterLayout } from '../BabysitterLayout';
import { AdminLayout } from '../AdminLayout';

/**
 * "Exactly one entry point per breakpoint" (#417, plan Q9) -- the load-
 * bearing shape of the whole PR, and unlike DesktopShell.test.tsx's suite
 * this renders the REAL `AppBar` (not mocked away), because the inline
 * switcher lives inside it. jsdom evaluates no media queries, so both halves
 * of the pair are always in the DOM at once; the responsive CONTRACT is the
 * classes, not visibility -- see the phoneViewport()-based tests elsewhere
 * for the accessibility-tree half of this same guarantee.
 */
function renderLayout(layout: React.ReactElement, pageText: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Routes>
          <Route element={layout}>
            <Route path="/" element={<div>{pageText}</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const SWITCH_LABEL = { name: /switch app/i } as const;

describe('exactly one app-switch entry point per breakpoint (#417, plan Q9)', () => {
  afterEach(cleanup);

  it.each([
    ['FamilyLayout', <FamilyLayout key="f" />],
    ['BabysitterLayout', <BabysitterLayout key="b" />],
  ] as const)('%s: the bottom bar and AppSwitchInline are the only two, and they never overlap', (_name, layout) => {
    renderLayout(layout, 'page');

    // Two, not one and not three: the fixed bottom bar (AppSwitchBarHost,
    // mounted by the layout) and the inline switcher (AppSwitchInline,
    // mounted inside AppBar). A third would mean a stray entry point; one
    // would mean a width lost its switcher entirely.
    const landmarks = screen.getAllByRole('navigation', SWITCH_LABEL);
    expect(landmarks).toHaveLength(2);

    const bar = landmarks.find((n) => /\bfixed\b/.test(n.className))!;
    const inline = landmarks.find((n) => n !== bar)!;
    expect(bar).toBeTruthy();
    expect(inline).toBeTruthy();

    // The bar: visible by default, hidden ONLY at md+.
    expect(bar.className).toMatch(/\bmd:hidden\b/);
    expect(bar.className).not.toMatch(/(?<!:)\bhidden\b/);

    // The inline switcher: hidden by default, visible ONLY at md+ -- the
    // exact inverse, so the two can never both be in the a11y tree at the
    // same viewport.
    expect(inline.className).toMatch(/(?<!:)\bhidden\b/);
    expect(inline.className).toMatch(/\bmd:flex\b/);
    expect(inline.className).not.toMatch(/\bmd:hidden\b/);
  });

  it('AdminLayout: the burger row (below md) and the sidebar-head AppSwitchInline (md+) are the only two', () => {
    renderLayout(<AdminLayout />, 'admin page');

    // Admin has no fixed bottom bar (AdminLayout mounts no
    // AppSwitchBarHost) -- its sub-md entry point is the burger row inside
    // AppBar's Dialog instead, which carries no "Switch app" nav landmark
    // of its own (it is a single MenuItem-shaped button). So exactly ONE
    // "Switch app" landmark should exist here: the sidebar head.
    const landmarks = screen.getAllByRole('navigation', SWITCH_LABEL);
    expect(landmarks).toHaveLength(1);
    expect(landmarks[0].className).toMatch(/(?<!:)\bhidden\b/);
    expect(landmarks[0].className).toMatch(/\bmd:flex\b/);

    // The burger's own row is md:hidden -- the sub-md-only half of the pair.
    // It lives inside the Dialog, which renders nothing until opened.
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
    const row = screen.getByRole('button', { name: /open sync-study/i }).parentElement!;
    expect(row.className).toMatch(/\bmd:hidden\b/);
  });
});
