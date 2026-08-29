import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { AboutPage } from '../AboutPage';

describe('AboutPage (study)', () => {
  beforeEach(() => i18n.changeLanguage('en'));
  afterEach(() => cleanup());

  it('mirrors the sit about structure: tagline, story, features, safety, disclaimer, contact', () => {
    renderWithProviders(<AboutPage />);

    expect(screen.getByAltText('Sync/Study')).toBeInTheDocument();
    expect(screen.getByText('Connecting families with trusted student tutors')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Our Story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Sync/Study Offers' })).toBeInTheDocument();
    expect(screen.getByText('Smart Search')).toBeInTheDocument();
    expect(screen.getByText('Easy Scheduling')).toBeInTheDocument();
    expect(screen.getByText('Community Verification')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Safety First/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Tutors verify their school affiliation through their official school email/),
    ).toBeInTheDocument();
    expect(screen.getByText(/independent initiative for families in the EJM community/)).toBeInTheDocument();
    // NOT support@sync-study.com: sync-study.com was never connected (#115),
    // so this address bounced on a live site.
    expect(screen.getByRole('link', { name: 'support@sync-sit.com' })).toHaveAttribute(
      'href',
      'mailto:support@sync-sit.com',
    );
    expect(screen.queryByText(/sync-study\.com/)).toBeNull();
  });

  it('links both role guides from the How-to Guides section (mirrors sit, issue #236)', () => {
    renderWithProviders(<AboutPage />);

    expect(screen.getByRole('heading', { name: 'How-to Guides' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Parent Guide/ })).toHaveAttribute(
      'href',
      '/guide/parents',
    );
    expect(screen.getByRole('link', { name: /Tutor Guide/ })).toHaveAttribute(
      'href',
      '/guide/tutors',
    );
    // The install card lives inside the guides section, as in sit.
    expect(screen.getByRole('link', { name: /Install the App/ })).toHaveAttribute(
      'href',
      '/install',
    );
  });

  it('speaks about tutoring, not babysitting', () => {
    renderWithProviders(<AboutPage />);
    expect(screen.getAllByText(/tutor/i).length).toBeGreaterThan(0);
    // The only babysitting mention is the cross-app card pointing at Sync/Sit.
    const sitCard = screen.getByRole('link', { name: /Sync\/Sit/ });
    for (const el of screen.getAllByText(/babysit/i)) {
      expect(sitCard.contains(el)).toBe(true);
    }
  });

  it('links the sibling Sync/Sit app at its canonical origin', () => {
    renderWithProviders(<AboutPage />);
    const link = screen.getByRole('link', { name: /Sync\/Sit/ });
    expect(link).toHaveAttribute('href', SIT_APP_URL);
    expect(screen.getByText('Trusted babysitting in the same school community.')).toBeInTheDocument();
  });

  it('renders in French, including the cross-app note', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<AboutPage />);
    expect(screen.getByRole('heading', { name: 'Notre histoire' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Également de Sync' })).toBeInTheDocument();
    expect(
      screen.getByText('Du babysitting de confiance dans la même communauté scolaire.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Sync\/Sit/ })).toHaveAttribute('href', SIT_APP_URL);
  });
});
