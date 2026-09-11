import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, act, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createTestI18n } from '../../test-utils/i18n.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { AppSwitchInline } from '../AppSwitchInline.js';

/**
 * Contract tests for the desktop rendering of the app switch (plan Q9,
 * issue #417). `AppSwitchInline` takes the exact same props as
 * `AppSwitchBar` and shares its state machine (`appSwitchShared.ts`), so
 * these pins focus on what is actually DIFFERENT to this component -- the
 * compact markup, the `hidden md:flex` breakpoint (the inverse of the
 * bar's `md:hidden`) -- plus the handoff/decision-20 contract repeated here
 * because it is what a host integrating this component actually relies on.
 */

const h = vi.hoisted(() => ({ assign: vi.fn() }));

const fakeMark = (app: string) => ({ sm: `${app}-48.png`, md: `${app}-96.png` });

const SIBLINGS = [
  { app: 'study' as const, url: 'https://sync-study-app.web.app', mark: fakeMark('study') },
  { app: 'do' as const, url: 'https://sync-do-app.web.app', mark: fakeMark('do') },
];

function renderInline(props: Partial<React.ComponentProps<typeof AppSwitchInline>> = {}) {
  const mint = props.mintHandoffCode ?? vi.fn().mockResolvedValue('code123');
  const onNavigateAccount = props.account?.onNavigate ?? vi.fn();
  const onNavigateHome = props.home?.onNavigate ?? vi.fn();
  const i18n = createTestI18n();
  const ui = (pathname: string) => (
    <I18nextProvider i18n={i18n}>
      <AppSwitchInline
        current="sit"
        currentMark={fakeMark('sit')}
        siblings={SIBLINGS.slice(0, 1)}
        mintHandoffCode={mint}
        account={{ href: '/family/account', onNavigate: onNavigateAccount }}
        home={{ href: '/family', onNavigate: onNavigateHome }}
        pathname={pathname}
        {...props}
      />
    </I18nextProvider>
  );
  const { rerender } = render(ui('/family'));
  const navigateTo = (pathname: string) => rerender(ui(pathname));
  return { mint, onNavigateAccount, onNavigateHome, navigateTo };
}

describe('AppSwitchInline', () => {
  beforeEach(() => {
    h.assign.mockReset();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: h.assign, hash: '' },
      writable: true,
      configurable: true,
    });
  });

  afterEach(cleanup);

  it('renders the same entry set as the bar: current app, its siblings, and My account', () => {
    renderInline();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /my account/i })).toBeInTheDocument();
  });

  it('marks the current app as the active entry', () => {
    renderInline();
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /sync\/study/ })).not.toHaveAttribute('aria-current');
  });

  it('uses bar-weight marks (48px + 96px 2x), never a full-size original', () => {
    renderInline();
    const img = screen.getByRole('button', { name: /sync\/study/ }).querySelector('img')!;
    expect(img.getAttribute('src') ?? '').toMatch(/-48\./);
    expect(img.getAttribute('srcset') ?? '').toMatch(/-96\./);
  });

  it('DECISION 20 -- omits sync/do when it is not passed as a sibling, exactly like the bar', () => {
    // sit and study pass only each other until #304 is approved. This
    // reuses the bar's own filtering (appSwitchShared.ts's `appTabs`) rather
    // than a second list, so there is one place, not two, that could drift.
    renderInline();
    expect(screen.queryByRole('button', { name: /sync\/do/ })).toBeNull();
  });

  it('DECISION 20 -- renders a do entry when, and only when, do is passed as a sibling', () => {
    renderInline({ siblings: SIBLINGS });
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeInTheDocument();
  });

  it('mints a handoff code and navigates the sibling with it in the URL FRAGMENT', async () => {
    const { mint } = renderInline();
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith('https://sync-study-app.web.app/handoff#code=code123&lang=en');
  });

  it('is non-optimistic: nothing navigates until the mint resolves, and the tapped entry shows a spinner', async () => {
    let resolveMint!: (v: string) => void;
    renderInline({ mintHandoffCode: vi.fn(() => new Promise<string>((r) => (resolveMint = r))) });

    const entry = screen.getByRole('button', { name: /sync\/study/ });
    fireEvent.click(entry);

    await waitFor(() => expect(entry).toBeDisabled());
    // The mark image is swapped for a spinner while busy -- same loading
    // affordance the bar uses, from the same `busyApp` state.
    expect(entry.querySelector('img')).toBeNull();
    expect(entry.querySelector('svg')).toBeInTheDocument();
    expect(h.assign).not.toHaveBeenCalled();

    resolveMint('late');
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });

  it('disables every entry while a switch is in flight, not just the one tapped', async () => {
    renderInline({ siblings: SIBLINGS, mintHandoffCode: vi.fn(() => new Promise<string>(() => {})) });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /sync\/study/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /my account/i })).toBeDisabled();
  });

  it('surfaces a failure without navigating, and re-enables', async () => {
    renderInline({ mintHandoffCode: vi.fn().mockRejectedValue(new Error('boom')) });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not switch/i));
    expect(screen.getByRole('button', { name: /sync\/study/ })).toBeEnabled();
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('the failure message clears on the next route change, like the bar', async () => {
    const { navigateTo } = renderInline({ mintHandoffCode: vi.fn().mockRejectedValue(new Error('boom')) });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    navigateTo('/family/appointments');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('un-sticks a busy switcher when the page is restored from bfcache', async () => {
    renderInline({ mintHandoffCode: vi.fn().mockResolvedValue('code123') });
    fireEvent.click(screen.getByRole('button', { name: /sync\/study/ }));
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /my account/i })).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(screen.getByRole('button', { name: /my account/i })).toBeEnabled();
  });

  it('navigates in-app for the account entry -- no handoff, it is same-origin', () => {
    const { mint, onNavigateAccount } = renderInline();
    fireEvent.click(screen.getByRole('button', { name: /my account/i }));

    expect(onNavigateAccount).toHaveBeenCalledWith('/family/account');
    expect(mint).not.toHaveBeenCalled();
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('omits the account entry entirely when there is nowhere for it to go (do-web’s shape)', () => {
    renderWithProviders(
      <AppSwitchInline
        current="do"
        currentMark={fakeMark('do')}
        siblings={SIBLINGS}
        mintHandoffCode={vi.fn()}
        pathname="/doer"
        home={{ href: '/doer', onNavigate: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('button', { name: /my account/i })).toBeNull();
    expect(screen.getByRole('button', { name: /sync\/do/ })).toBeInTheDocument();
  });

  it('navigates home when the current-app entry is tapped', () => {
    const { onNavigateHome } = renderInline();
    fireEvent.click(screen.getByRole('button', { name: /sync\/sit/ }));

    expect(onNavigateHome).toHaveBeenCalledWith('/family');
    expect(h.assign).not.toHaveBeenCalled();
  });

  it('the current-app entry is inert when no home target is given', () => {
    renderInline({ home: undefined });
    expect(screen.getByRole('button', { name: /sync\/sit/ })).toBeDisabled();
  });

  describe('tone -- hosts embed this directly into two different grounds', () => {
    it('defaults to the light-ground palette (no host-supplied tone)', () => {
      renderInline();
      expect(screen.getByRole('button', { name: /sync\/sit/ }).className).toMatch(/\bbg-brand-50\b/);
    });

    it('onBrand swaps to white-on-colour fills for the current entry, never brand-50', () => {
      renderInline({ tone: 'onBrand' });
      const current = screen.getByRole('button', { name: /sync\/sit/ });
      expect(current.className).toMatch(/\bbg-white\/20\b/);
      expect(current.className).not.toMatch(/\bbg-brand-50\b/);
    });
  });

  describe('breakpoint contract -- jsdom applies no CSS, so the classes ARE the contract', () => {
    it('is hidden md:flex -- the exact inverse of AppSwitchBar’s md:hidden', () => {
      renderInline();
      const nav = screen.getByRole('navigation', { name: /switch app/i });
      expect(nav.className).toMatch(/\bhidden\b/);
      expect(nav.className).toMatch(/\bmd:flex\b/);
      // Never the bar's own breakpoint class -- the two must not both render
      // at the same viewport.
      expect(nav.className).not.toMatch(/\bmd:hidden\b/);
    });
  });
});
