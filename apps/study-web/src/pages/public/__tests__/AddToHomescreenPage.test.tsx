import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { AddToHomescreenPage } from '../AddToHomescreenPage';

// Install page (issue #162): study-branded mirror of sit's AddToHomescreenPage.

describe('AddToHomescreenPage', () => {
  it('renders the study install intro and the iOS instructions by default', () => {
    renderWithProviders(<AddToHomescreenPage />);
    expect(screen.getByText(/install sync\/study on your phone/i)).toBeInTheDocument();
    expect(screen.getByText('Safari (iPhone / iPad)')).toBeInTheDocument();
    // Steps name the study host, not the sit domain.
    expect(screen.getAllByText(/sync-study-app\.web\.app/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/sync-sit\.com/i)).toBeNull();
  });

  it('switches to the Android instructions', () => {
    renderWithProviders(<AddToHomescreenPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Android' }));
    expect(screen.getByText('Chrome (Android)')).toBeInTheDocument();
    // The step text is split across <strong> nodes — match the strong itself.
    expect(screen.getByText(/"Install app"/)).toBeInTheDocument();
  });

  it('renders the French copy when the language is fr', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<AddToHomescreenPage />);
    expect(screen.getByText(/installez sync\/study sur votre téléphone/i)).toBeInTheDocument();
    expect(screen.getAllByText(/sync-study-app\.web\.app/i).length).toBeGreaterThan(0);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });
});
