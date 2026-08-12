import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@ejm/shared-ui';
import i18n from '@/i18n';

/**
 * Render a component with the app's i18n instance, a router, and the toast
 * provider, so useTranslation(), <Link> and useToast() resolve in component
 * tests (mirrors the App-root provider stack). Not a test file itself (no
 * .test suffix) — excluded from vitest collection and tsc build.
 */
export function renderWithProviders(ui: ReactElement, initialPath = '/') {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
        </ToastProvider>
      </I18nextProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

export { i18n };
