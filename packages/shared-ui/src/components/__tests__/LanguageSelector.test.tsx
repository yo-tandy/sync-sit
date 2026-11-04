import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { onUserLanguageChange } from '../../i18n/userLanguage.js';
import { LanguageSelector } from '../LanguageSelector.js';

afterEach(cleanup);

describe('LanguageSelector', () => {
  it('emits the explicit user-language signal ONLY on a click — never on mount (issue #512)', () => {
    const seen: string[] = [];
    const off = onUserLanguageChange((l) => seen.push(l));
    try {
      renderWithProviders(<LanguageSelector />);
      // Mount + the i18n bootstrap emit nothing on the user bus.
      expect(seen).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Français' }));
      fireEvent.click(screen.getByRole('button', { name: 'English' }));
      expect(seen).toEqual(['fr', 'en']);
      expect(localStorage.getItem('ejm_language')).toBe('en');
    } finally {
      off();
    }
  });

  // Issue #522: Node 26 exposes a global `localStorage` that is `undefined`
  // unless --localstorage-file is given, and vitest's jsdom environment does
  // not replace it — so the click handler threw before the signal fired and
  // the language change was lost. Persistence is best-effort; the switch and
  // the signal must not depend on it.
  it('still switches and emits when localStorage is undefined (Node 26 without --localstorage-file)', () => {
    const seen: string[] = [];
    const off = onUserLanguageChange((l) => seen.push(l));
    vi.stubGlobal('localStorage', undefined);
    try {
      renderWithProviders(<LanguageSelector />);
      fireEvent.click(screen.getByRole('button', { name: 'Français' }));
      expect(seen).toEqual(['fr']);
      // The selected state follows i18n, not storage.
      expect(screen.getByRole('button', { name: 'Français' }).className).toContain('border-brand-600');
    } finally {
      vi.unstubAllGlobals();
      off();
    }
  });

  it('still switches and emits when localStorage throws on write (private mode / quota)', () => {
    const seen: string[] = [];
    const off = onUserLanguageChange((l) => seen.push(l));
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      getItem: () => null,
    });
    try {
      renderWithProviders(<LanguageSelector />);
      fireEvent.click(screen.getByRole('button', { name: 'Français' }));
      expect(seen).toEqual(['fr']);
    } finally {
      vi.unstubAllGlobals();
      off();
    }
  });
});
