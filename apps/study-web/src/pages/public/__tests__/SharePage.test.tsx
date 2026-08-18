import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

// The page reads useAuthStore to pick the role-aware pitch (and gates on
// loading); mutable mock state keeps the public (unauthenticated) render
// working and lets tests flip roles. getStudyRole runs for real against the
// mocked userDoc shapes.
const authState: { userDoc: unknown; loading: boolean } = { userDoc: null, loading: false };
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => authState;
  useAuthStore.getState = () => authState;
  return { useAuthStore };
});

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SharePage } from '../SharePage';

/**
 * Pins for the study share flow, mirrored from sync-sit's SharePage mechanics:
 * navigator.share when available (with the study payload), clipboard + mailto
 * fallbacks otherwise, and study-branded ROLE-AWARE copy in both languages —
 * tutors pitch "get in touch with families", parents and unauthenticated
 * visitors pitch "find trusted tutors".
 */

const ORIGIN = window.location.origin;
const TUTOR_DOC = { uid: 't1', profiles: { tutor: { subjects: [] } } };
const PARENT_DOC = { uid: 'p1', profiles: { parent: { familyId: 'f1' } } };

function setNavigatorShare(fn: (() => Promise<void>) | undefined) {
  if (fn) {
    Object.defineProperty(navigator, 'share', { value: fn, writable: true, configurable: true });
  } else {
    delete (navigator as unknown as Record<string, unknown>).share;
  }
}

// Some tests replace window.location (mailto capture) or navigator.clipboard
// wholesale; restore the originals so later tests see the real objects.
const originalLocation = window.location;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  authState.userDoc = null;
  authState.loading = false;
});

afterEach(() => {
  setNavigatorShare(undefined);
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  }
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('SharePage (study) — auth loading gate', () => {
  it('shows neither pitch nor share actions while auth resolves, then the tutor pitch', () => {
    authState.loading = true;
    authState.userDoc = null;
    const { rerender } = renderWithProviders(<SharePage />);

    // No pitch is previewable or sendable during the race window.
    expect(screen.queryByText(/find trusted tutors/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/get in touch with families/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy to clipboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /share by email/i })).not.toBeInTheDocument();

    // Auth resolves as a tutor: the tutor pitch appears.
    authState.loading = false;
    authState.userDoc = TUTOR_DOC;
    rerender(<SharePage />);
    expect(screen.getByText(/get in touch with families/i)).toBeInTheDocument();
    expect(screen.queryByText(/find trusted tutors/i)).not.toBeInTheDocument();
  });
});

describe('SharePage (study) — parent/unauthenticated pitch', () => {
  it('renders the share options with the find-tutors preview when signed out (no native share)', () => {
    renderWithProviders(<SharePage />);

    expect(screen.getByText('Share Sync/Study')).toBeInTheDocument();
    expect(screen.getByText(/Help grow our community/i)).toBeInTheDocument();
    // Message preview carries the family-side pitch (tutors, not babysitters) + the app origin.
    const preview = screen.getByText(/I'm using Sync\/Study to find trusted tutors/i);
    expect(preview.textContent).toContain(ORIGIN);
    expect(preview.textContent).not.toMatch(/babysit/i);
    // Fallbacks are always present…
    expect(screen.getByRole('button', { name: /copy to clipboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share by email/i })).toBeInTheDocument();
    // …and without navigator.share there is no native share button.
    expect(screen.queryByRole('button', { name: /^share$/i })).not.toBeInTheDocument();
  });

  it('keeps the find-tutors pitch for a signed-in parent', () => {
    authState.userDoc = PARENT_DOC;
    renderWithProviders(<SharePage />);
    expect(screen.getByText(/I'm using Sync\/Study to find trusted tutors/i)).toBeInTheDocument();
    expect(screen.queryByText(/looking for tutors/i)).not.toBeInTheDocument();
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
    expect((share.mock.calls[0][0] as { text: string }).text).toMatch(
      /Sync\/Study to find trusted tutors/,
    );
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

  it('falls back to the execCommand textarea copy when navigator.clipboard is absent', async () => {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
    const copiedValues: string[] = [];
    document.execCommand = vi.fn((command: string) => {
      if (command === 'copy') {
        for (const ta of Array.from(document.getElementsByTagName('textarea'))) {
          copiedValues.push(ta.value);
        }
      }
      return true;
    });
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith('copy'));
    expect(copiedValues.some((v) => v.includes('Sync/Study') && v.includes(ORIGIN))).toBe(true);
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

  it('uses the French find-tutors pitch when the language is fr', async () => {
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

describe('SharePage (study) — tutor pitch', () => {
  beforeEach(() => {
    authState.userDoc = TUTOR_DOC;
  });

  it('previews the get-in-touch-with-families text for a signed-in tutor', () => {
    renderWithProviders(<SharePage />);
    const preview = screen.getByText(
      /get in touch with families from our school community who are looking for tutors/i,
    );
    expect(preview.textContent).toContain(ORIGIN);
    expect(screen.queryByText(/find trusted tutors/i)).not.toBeInTheDocument();
  });

  it('native share payload carries the tutor text', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigatorShare(share);
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /^share$/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: 'Sync/Study',
      text: expect.stringMatching(/get in touch with families/),
      url: ORIGIN,
    });
    expect((share.mock.calls[0][0] as { text: string }).text).toContain(ORIGIN);
  });

  it('clipboard copy carries the tutor text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    renderWithProviders(<SharePage />);

    fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(/get in touch with families/);
    expect(writeText.mock.calls[0][0]).toContain(ORIGIN);
  });

  it('mailto body carries the tutor text', () => {
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
    expect(hrefs[0]).toContain(encodeURIComponent('get in touch with families'));
    expect(hrefs[0]).toContain(encodeURIComponent(ORIGIN));
  });

  it('uses the French get-in-touch pitch when the language is fr', async () => {
    await i18n.changeLanguage('fr');
    try {
      renderWithProviders(<SharePage />);
      const preview = screen.getByText(
        /entrer en contact avec des familles de notre communauté scolaire qui recherchent des tuteurs/i,
      );
      expect(preview.textContent).toContain(ORIGIN);
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
