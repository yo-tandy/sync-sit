import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { AccountDeletedPage } from '../AccountDeletedPage.js';

afterEach(cleanup);

describe('AccountDeletedPage', () => {
  it('renders the deletion copy and a link home, with no back button', () => {
    renderWithProviders(<AccountDeletedPage />);
    expect(screen.getByText('Your account has been deleted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back|retour/i })).toBeNull();
    const link = screen.getByRole('link', { name: 'Go to the homepage' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('respects a custom homeHref', () => {
    renderWithProviders(<AccountDeletedPage homeHref="/welcome" />);
    expect(screen.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute(
      'href',
      '/welcome',
    );
  });
});
