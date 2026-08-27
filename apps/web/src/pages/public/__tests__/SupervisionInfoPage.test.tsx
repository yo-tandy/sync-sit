import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import i18n from '@/i18n';
import sitEn from '@/i18n/en';
import sitFr from '@/i18n/fr';
import studyEn from '../../../../../study-web/src/i18n/en';
import studyFr from '../../../../../study-web/src/i18n/fr';
import { SupervisionInfoPage } from '../SupervisionInfoPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <SupervisionInfoPage />
    </MemoryRouter>,
  );
}

describe('SupervisionInfoPage (sit)', () => {
  beforeEach(() => i18n.changeLanguage('en'));
  afterEach(() => cleanup());

  it('states honestly what guardians see and can do, and links the agreement', () => {
    renderPage();

    expect(screen.getByText('What they see')).toBeInTheDocument();
    expect(screen.getByText(/all session and appointment notes/i)).toBeInTheDocument();
    expect(screen.getByText('What they can do')).toBeInTheDocument();
    expect(screen.getByText(/they can never accept for you/i)).toBeInTheDocument();
    expect(screen.getByText('Who holds these rights')).toBeInTheDocument();
    expect(screen.getByText('How it ends')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read the supervision agreement/i })).toHaveAttribute(
      'href',
      '/supervision-agreement',
    );
  });

  it('renders in French', () => {
    i18n.changeLanguage('fr');
    renderPage();

    expect(screen.getByText('Ce qu\'ils voient')).toBeInTheDocument();
  });

  // The transparency copy is shared verbatim across apps too.
  it('keeps the supervision copy identical to sync-study in both languages', () => {
    expect(sitEn.supervision).toEqual(studyEn.supervision);
    expect(sitFr.supervision).toEqual(studyFr.supervision);
  });
});
