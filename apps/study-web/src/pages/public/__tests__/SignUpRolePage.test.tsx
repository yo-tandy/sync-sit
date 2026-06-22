import { describe, it, expect, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SignUpRolePage } from '../SignUpRolePage';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('SignUpRolePage (study)', () => {
  it('offers Tutor and Parent (not Babysitter) with the right enroll links', () => {
    renderWithProviders(<SignUpRolePage />);

    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/enroll/tutor');
    expect(hrefs).toContain('/enroll/parent');

    // The tutor role card label, and no babysitter anywhere.
    expect(screen.getByText('Tutor')).toBeInTheDocument();
    expect(screen.queryByText(/Babysitter/i)).toBeNull();
  });
});
