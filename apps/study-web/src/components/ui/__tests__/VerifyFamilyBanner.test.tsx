import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ callable: vi.fn(), assign: vi.fn() }));

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import { renderWithProviders } from '@/__tests__/test-utils';
import i18n from '@/i18n';
import { VerifyFamilyBanner } from '../VerifyFamilyBanner';

describe('VerifyFamilyBanner (one-click verify switch, issue #129)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    h.callable.mockReset();
    h.assign.mockReset();
    // jsdom's location.assign is non-functional — replace location wholesale.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: h.assign, hash: '' },
      writable: true,
      configurable: true,
    });
  });

  it('CTA mints a handoff and navigates deep-linked to sit\'s verification page', async () => {
    h.callable.mockResolvedValue({ data: { code: 'abc+/=' } });
    renderWithProviders(<VerifyFamilyBanner />);

    fireEvent.click(screen.getByRole('button', { name: /verify in sync-sit/i }));

    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
    expect(h.callable).toHaveBeenCalledWith('createAppHandoffCode', {});
    // The destination pin: a CONSTANT relative sit path riding as a `dest`
    // fragment param alongside code and lang (fragments never reach servers
    // or logs); sit's handoff page re-validates it on arrival.
    expect(h.assign).toHaveBeenCalledWith(
      'https://sync-sit.web.app/handoff#code=abc%2B%2F%3D&lang=en&dest=%2Ffamily%2Fverification',
    );
  });

  it('is non-optimistic: CTA disables with the mint in flight', async () => {
    let resolveCall!: (v: { data: { code: string } }) => void;
    h.callable.mockReturnValue(new Promise((resolve) => (resolveCall = resolve)));
    renderWithProviders(<VerifyFamilyBanner />);

    const button = screen.getByRole('button', { name: /verify in sync-sit/i });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(h.assign).not.toHaveBeenCalled();

    resolveCall({ data: { code: 'late' } });
    await waitFor(() => expect(h.assign).toHaveBeenCalledTimes(1));
  });

  it('mint failure falls back gracefully: explanatory text stays, error shows, no navigation, CTA retryable', async () => {
    h.callable.mockRejectedValue(new Error('boom'));
    renderWithProviders(<VerifyFamilyBanner />);

    const button = screen.getByRole('button', { name: /verify in sync-sit/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByText(/could not switch apps/i)).toBeInTheDocument(),
    );
    // The pre-CTA behavior survives as the fallback: the banner still tells
    // the parent where verification happens.
    expect(screen.getByText(/verify your family/i)).toBeInTheDocument();
    expect(screen.getByText(/verified in the sync\/sit app/i)).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(h.assign).not.toHaveBeenCalled();
  });
});
