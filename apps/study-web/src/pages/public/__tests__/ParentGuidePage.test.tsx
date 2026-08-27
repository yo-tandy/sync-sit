import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { ParentGuidePage } from '../ParentGuidePage';

describe('ParentGuidePage (study)', () => {
  beforeEach(() => i18n.changeLanguage('en'));

  it('renders the sit guide structure in English: header, sections, numbered steps', () => {
    renderWithProviders(<ParentGuidePage />);

    expect(screen.getByAltText('Sync/Study')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How to use Sync/Study' })).toBeInTheDocument();
    expect(screen.getByText('A guide for parents')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finding a Tutor' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Booking & Managing Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Endorsements & Account' })).toBeInTheDocument();
    // The shared TopNav resolves its i18n keys (no raw-key fallback).
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('states the core flow facts: approval unlocks the relationship, 7-day decline cooldown, withdrawal ownership', () => {
    renderWithProviders(<ParentGuidePage />);

    expect(screen.getByRole('heading', { name: 'Approval unlocks the relationship' })).toBeInTheDocument();
    expect(screen.getByText(/wait 7 days before sending them another request/)).toBeInTheDocument();
    // Sessions happen only inside an approved relationship, on 24h notice.
    expect(screen.getByText(/Sessions can only be booked with tutors who have approved you/)).toBeInTheDocument();
    expect(screen.getByText(/at least 24 hours ahead/)).toBeInTheDocument();
    // Withdrawal belongs to whoever opened the request — and triggers no cooldown.
    expect(screen.getByText(/withdrawal always belongs to whoever opened the request/)).toBeInTheDocument();
    expect(screen.getByText(/triggers no waiting period/)).toBeInTheDocument();
  });

  it('covers the published-search path with its privacy facts (issue #207)', () => {
    renderWithProviders(<ParentGuidePage />);

    expect(screen.getByRole('heading', { name: 'Publish your search' })).toBeInTheDocument();
    // The consent-relevant facts: wider visibility, what is shown, the caps.
    expect(screen.getByText(/visible to a larger group of tutors/)).toBeInTheDocument();
    expect(screen.getByText(/your address is never shown/)).toBeInTheDocument();
    expect(screen.getByText(/up to 3 published searches at a time/)).toBeInTheDocument();
    expect(screen.getByText(/stays up for one week/)).toBeInTheDocument();
  });

  it('renders fully in French', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<ParentGuidePage />);

    expect(screen.getByRole('heading', { name: 'Comment utiliser Sync/Study' })).toBeInTheDocument();
    expect(screen.getByText('Guide pour les parents')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trouver un tuteur' })).toBeInTheDocument();
    expect(screen.getByText(/attendre 7 jours/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retour' })).toBeInTheDocument();
  });
});
