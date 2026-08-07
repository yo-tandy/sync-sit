import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { SUPERVISION_AGREEMENT_VERSION } from '@ejm/shared-core';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SupervisionAgreementPage } from '../SupervisionAgreementPage';

describe('SupervisionAgreementPage', () => {
  afterEach(() => {
    i18n.changeLanguage('en');
  });

  it('renders the version note from the shared-core constant, above the fold', () => {
    renderWithProviders(<SupervisionAgreementPage />);
    expect(
      screen.getByText(new RegExp(`Version ${SUPERVISION_AGREEMENT_VERSION} —`)),
    ).toBeInTheDocument();
    expect(screen.getByText(/you accept this agreement/i)).toBeInTheDocument();
  });

  it('renders every section of the authoritative EN copy', () => {
    renderWithProviders(<SupervisionAgreementPage />);

    expect(screen.getByRole('heading', { name: /supervision agreement/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what you confirm/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what you can see/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what you can do/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /your responsibilities/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /sharing of rights/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /duration/i })).toBeInTheDocument();

    // Load-bearing sentences, verbatim from the approved copy.
    expect(screen.getByText(/supervision is full visibility/i)).toBeInTheDocument();
    expect(
      screen.getByText(/you can never accept or commit on their behalf/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/the child cannot remove it themselves/i)).toBeInTheDocument();
  });

  it('renders the real French translation when the language is fr', () => {
    i18n.changeLanguage('fr');
    renderWithProviders(<SupervisionAgreementPage />);

    expect(screen.getByRole('heading', { name: /accord de supervision/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /ce que vous confirmez/i })).toBeInTheDocument();
    expect(screen.getByText(/vous ne pouvez jamais accepter/i)).toBeInTheDocument();
  });
});
