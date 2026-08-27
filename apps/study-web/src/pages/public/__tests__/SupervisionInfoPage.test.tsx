import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { SupervisionInfoPage } from '../SupervisionInfoPage';

describe('SupervisionInfoPage', () => {
  it('explains supervision honestly (full visibility incl. notes and messages)', () => {
    renderWithProviders(<SupervisionInfoPage />);

    expect(screen.getByText(/what supervision means/i)).toBeInTheDocument();
    // Ruling 8, stated to the kid without euphemism.
    expect(screen.getByText(/session and appointment notes/i)).toBeInTheDocument();
    expect(screen.getByText(/messages/i)).toBeInTheDocument();
    // Decline-only guardian powers.
    expect(screen.getByText(/never accept/i)).toBeInTheDocument();
    // Shared rights across the family's parents.
    expect(screen.getByText(/every parent/i)).toBeInTheDocument();
    // How supervision ends.
    expect(screen.getByText(/15/)).toBeInTheDocument();
  });

  it('links to the Supervision Agreement', () => {
    renderWithProviders(<SupervisionInfoPage />);
    expect(screen.getByRole('link', { name: /supervision agreement/i })).toHaveAttribute(
      'href',
      '/supervision-agreement',
    );
  });
});
