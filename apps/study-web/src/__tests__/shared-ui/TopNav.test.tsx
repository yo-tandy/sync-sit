import { describe, it, expect, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { TopNav } from '@ejm/shared-ui';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('TopNav (shared-ui)', () => {
  it('back button is a 44px hit target with an accessible name (WCAG 2.5.8)', () => {
    renderWithProviders(<TopNav title="Settings" backTo="back" />);
    const back = screen.getByRole('button', { name: /back/i });
    expect(back.className).toMatch(/\bh-11\b/);
    expect(back.className).toMatch(/\bw-11\b/);
  });

  it('renders no back button when neither backTo nor onBack is given', () => {
    renderWithProviders(<TopNav title="Settings" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
