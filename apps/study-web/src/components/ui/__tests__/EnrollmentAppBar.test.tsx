import { describe, it, expect, beforeAll } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { EnrollmentAppBar } from '../EnrollmentAppBar';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('EnrollmentAppBar (study)', () => {
  it('shows the Sync/Study brand', () => {
    renderWithProviders(<EnrollmentAppBar />);
    expect(screen.getByText('Sync/Study')).toBeInTheDocument();
  });

  it('opens a menu with About / Report / Privacy / Terms and NO sign-out (tutor not yet signed in)', () => {
    renderWithProviders(<EnrollmentAppBar />);
    fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/about', '/report', '/privacy', '/terms']));

    expect(screen.queryByText(/sign out/i)).toBeNull();
  });

  it('menu button is a 44px hit target (WCAG 2.5.8)', () => {
    renderWithProviders(<EnrollmentAppBar />);
    const burger = screen.getByRole('button', { name: /open menu/i });
    expect(burger.className).toMatch(/\bh-11\b/);
    expect(burger.className).toMatch(/\bw-11\b/);
  });
});
