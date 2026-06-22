import { describe, it, expect, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { AboutPage } from '../AboutPage';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('AboutPage (study)', () => {
  it('renders the Sync/Study about heading and tutoring-oriented body', () => {
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole('heading', { name: /About Sync\/Study/i })).toBeInTheDocument();
    expect(screen.getAllByText(/tutor/i).length).toBeGreaterThan(0);
  });
});
