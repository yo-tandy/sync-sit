import { describe, it, expect, afterEach } from 'vitest';
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
});
