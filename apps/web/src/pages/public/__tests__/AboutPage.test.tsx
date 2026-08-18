import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import i18n from '@/i18n';
import { STUDY_APP_URL } from '@/lib/appSwitch';
import { AboutPage } from '../AboutPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe('AboutPage (sit)', () => {
  beforeEach(() => i18n.changeLanguage('en'));
  afterEach(() => cleanup());

  it('renders story, features, safety, and guide sections', () => {
    renderPage();

    expect(screen.getByAltText('Sync/Sit')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our Story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Sync/Sit Offers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Safety First/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Parent Guide/ })).toHaveAttribute('href', '/guide/parents');
    expect(screen.getByRole('link', { name: /Babysitter Guide/ })).toHaveAttribute(
      'href',
      '/guide/babysitters',
    );
  });

  it('links the sibling Sync/Study app at its canonical origin', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Also from Sync' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Sync\/Study/ });
    expect(link).toHaveAttribute('href', STUDY_APP_URL);
    expect(screen.getByText('Trusted tutoring in the same school community.')).toBeInTheDocument();
  });

  it('renders in French, including the cross-app note', async () => {
    await i18n.changeLanguage('fr');
    renderPage();
    expect(screen.getByRole('heading', { name: 'Notre histoire' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Également de Sync' })).toBeInTheDocument();
    expect(
      screen.getByText('Du tutorat de confiance dans la même communauté scolaire.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sync\/Study/ })).toHaveAttribute('href', STUDY_APP_URL);
  });
});
