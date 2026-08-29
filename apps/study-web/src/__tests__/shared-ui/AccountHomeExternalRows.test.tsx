import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { AccountHome } from '@ejm/shared-ui';
import i18n from '@/i18n';

/**
 * The hub's cross-origin contract (#367, PR #416 review).
 *
 * An `external: true` row leaves this origin, so it must go through the host's
 * session handoff or nowhere at all. It must NEVER fall back to `onNavigate`:
 * that pushes an absolute URL into the router, which resolves it as a
 * same-origin path and 404s. A host declaring an external row while supplying
 * no handoff has a wiring bug, and doing nothing is the honest failure.
 */
function renderHome(onNavigate: () => void, onNavigateExternal?: () => void) {
  render(
    <I18nextProvider i18n={i18n}>
      <AccountHome
        sections={[{ title: 'Neutral', rows: [{ label: 'Elsewhere', href: 'https://example.com/x', external: true }] }]}
        onNavigate={onNavigate}
        onNavigateExternal={onNavigateExternal}
      />
    </I18nextProvider>,
  );
}

describe('AccountHome external rows', () => {
  afterEach(() => cleanup());

  it('routes an external row through the handoff, not the router', () => {
    const onNavigate = vi.fn();
    const onNavigateExternal = vi.fn();
    renderHome(onNavigate, onNavigateExternal);
    fireEvent.click(screen.getByText('Elsewhere'));
    expect(onNavigateExternal).toHaveBeenCalledWith('https://example.com/x');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does NOTHING when the host supplies no handoff — never a router push', () => {
    const onNavigate = vi.fn();
    renderHome(onNavigate);
    fireEvent.click(screen.getByText('Elsewhere'));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
