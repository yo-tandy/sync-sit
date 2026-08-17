import { describe, it, expect, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { LoginPage as SharedLoginPage } from '@ejm/shared-ui';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';

// Issue #147: the auth store reports login failures as i18n keys and the
// shared page translates them, so the user sees a generic message that never
// reveals whether an account exists for the attempted email.
describe('shared LoginPage error rendering (study locales)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  function renderWithError(error: string) {
    return renderWithProviders(
      <SharedLoginPage
        logoSrc="/logo.png"
        onLogin={async () => undefined}
        postLoginRouter={() => '/'}
        loading={false}
        error={error}
        clearError={() => {}}
      />,
    );
  }

  it('translates the generic invalid-credentials key', () => {
    renderWithError('auth.errorInvalidCredentials');
    expect(screen.getByText('Incorrect email or password.')).toBeInTheDocument();
    // The raw key must not leak to the screen.
    expect(screen.queryByText('auth.errorInvalidCredentials')).toBeNull();
  });

  it('translates the generic login-failed key', () => {
    renderWithError('auth.errorLoginFailed');
    expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('has french strings for every login error key', () => {
    for (const key of [
      'auth.errorInvalidCredentials',
      'auth.errorTooManyAttempts',
      'auth.errorLoginFailed',
      'auth.errorResetFailed',
    ]) {
      expect(i18n.exists(key, { lng: 'fr' })).toBe(true);
      expect(i18n.exists(key, { lng: 'en' })).toBe(true);
    }
  });
});
