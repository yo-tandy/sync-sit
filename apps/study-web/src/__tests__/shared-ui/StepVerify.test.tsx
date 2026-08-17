import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { StepVerify } from '@ejm/shared-ui';
import i18n from '@/i18n';

// Round 5 (issue #148): the code-entry step always renders a static
// "already have an account? log in" exit hint. It shows on BOTH the fresh
// and silent existing-account paths, so it distinguishes nothing — but it
// gives a silent-path user (who will never receive a code) a way out.
describe('StepVerify login hint (issue #148)', () => {
  it('always renders the no-code hint with a /login link', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepVerify
            ejemEmail="someone28@ejm.org"
            onVerify={async () => {}}
            onResend={async () => {}}
            error={null}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText(/If you already have an account/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'log in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});
