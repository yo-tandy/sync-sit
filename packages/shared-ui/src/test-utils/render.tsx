import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { createTestI18n } from './i18n.js';

/**
 * Shared render helper for shared-ui component tests: wraps `ui` with a
 * real (but minimal) i18next instance and a `MemoryRouter`, since several
 * of these components use `<Link>` (react-router) alongside `t()`.
 */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(
    <I18nextProvider i18n={createTestI18n()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
}
