import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SharePage } from '../SharePage';

/**
 * Pins for the study share flow, mirrored from sync-sit's SharePage mechanics:
 * navigator.share when available (with the study payload), clipboard + mailto
 * fallbacks otherwise, and study-branded tutoring copy in both languages.
 */

const ORIGIN = window.location.origin;

function setNavigatorShare(fn: (() => Promise<void>) | undefined) {
  if (fn) {
    Object.defineProperty(navigator, 'share', { value: fn, writable: true, configurable: true });
  } else {
    delete (navigator as unknown as Record<string, unknown>).share;
  }
}

afterEach(() => {
  setNavigatorShare(undefined);
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('SharePage (study)', () => {
  it('renders the share options with the study message preview (no native share)', () => {
    renderWithProviders(<SharePage />);

    expect(screen.getByText('Share Sync/Study')).toBeInTheDocument();
    expect(screen.getByText(/Help grow our community/i)).toBeInTheDocument();
    // Message preview carries the study pitch (tutors, not babysitters) + the app origin.
    const preview = screen.getByText(/I'm using Sync\/Study to find trusted tutors/i);
    expect(preview.textContent).toContain(ORIGIN);
    expect(preview.textContent).not.toMatch(/babysit/i);
    // Fallbacks are always present…
    expect(screen.getByRole('button', { name: /copy to clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share by email/i })).toBeInTheDocument();
    // …and without navigator.share there is no native share button.
    expect(screen.queryByRole('button', { name: /^share$/i })).not.toBeInTheDocument();
  });

  it('shows the native share button when navigator.share exists and calls it with the study payload', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(share);
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: 'Sync/Study',
      text: expect.stringContaining(ORIGIN),
      url: ORIGIN,
    });
    expect((share.mock.calls[0][0] as { text: string }).text).toMatch(/Sync\/Study.*tutors/);
  });

  it('copies the share message to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('Sync/Study');
    expect(writeText.mock.calls[0][0]).toContain(ORIGIN);
    await waitFor(() => expect(screen.getAllByText(/copied/i).length).toBeGreaterThan(0));
  });

  it('shares by email via a mailto: link carrying the study subject and message', () => {
    const hrefs: string[] = [];
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        origin: ORIGIN,
        set href(v: string) {
          hrefs.push(v);
        },
      },
      writable: true,
      configurable: true,
    });
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /share by email/i }));

    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toMatch(/^mailto:\?subject=/);
    expect(hrefs[0]).toContain(encodeURIComponent('Sync/Study — Tutoring'));
    expect(hrefs[0]).toContain(encodeURIComponent(ORIGIN));
  });

  it('uses the French tutoring pitch when the language is fr', async () => {
    await i18n.changeLanguage('fr');
    try {
      renderWithProviders(<SharePage />);
      expect(screen.getByText('Partager Sync/Study')).toBeInTheDocument();
      const preview = screen.getByText(/J'utilise Sync\/Study pour trouver des tuteurs/i);
      expect(preview.textContent).toContain(ORIGIN);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
