import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { TutorGuidePage } from '../TutorGuidePage';

describe('TutorGuidePage (study)', () => {
  beforeEach(() => i18n.changeLanguage('en'));

  it('renders the sit guide structure in English: header, sections, numbered steps', () => {
    renderWithProviders(<TutorGuidePage />);

    expect(screen.getByAltText('Sync/Study')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to use Sync/Study' })).toBeInTheDocument();
    expect(screen.getByText('A guide for tutors')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact Requests' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tutoring Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Profile & Account' })).toBeInTheDocument();
    // The shared TopNav resolves its i18n keys (no raw-key fallback).
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('states the core flow facts: approval unlocks the relationship, 7-day decline cooldown, sessions inside it', () => {
    renderWithProviders(<TutorGuidePage />);

    expect(screen.getByText(/Accepting a request unlocks the relationship/)).toBeInTheDocument();
    expect(screen.getByText(/wait 7 days before sending you another request/)).toBeInTheDocument();
    // Sessions only happen inside an approved relationship, on 24h notice.
    expect(screen.getByText(/An approved family can request a one-time or weekly recurring session/)).toBeInTheDocument();
    expect(screen.getByText(/at least 24 hours ahead/)).toBeInTheDocument();
    // Withdrawal belongs to whoever opened the request.
    expect(screen.getByText(/withdrawal always belongs to whoever opened the request/)).toBeInTheDocument();
    // The relationship can be opened from either side (issue #207 inversion).
    expect(screen.getByText(/answering a family's published search/)).toBeInTheDocument();
    // Activation prerequisites (dashboard toggle gate).
    expect(screen.getByText(/added your subjects and at least one availability slot/)).toBeInTheDocument();
  });

  it('renders fully in French', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<TutorGuidePage />);

    expect(screen.getByRole('heading', { name: 'Comment utiliser Sync/Study' })).toBeInTheDocument();
    expect(screen.getByText('Guide pour les tuteurs')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Premiers pas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Demandes de contact' })).toBeInTheDocument();
    expect(screen.getByText(/attendre 7 jours/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retour' })).toBeInTheDocument();
  });
});
