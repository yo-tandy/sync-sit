import { describe, it, expect, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { WelcomePage } from '../WelcomePage';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('WelcomePage (study)', () => {
  it('renders the brand title and the primary CTAs + footer links', () => {
    renderWithProviders(<WelcomePage />);

    expect(screen.getByRole('heading', { name: 'Sync/Study' })).toBeInTheDocument();

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/login');
    expect(hrefs).toContain('/signup');
    expect(hrefs).toContain('/about');
    expect(hrefs).toContain('/privacy');
    expect(hrefs).toContain('/terms');
    expect(hrefs).toContain('/report');
  });
});
