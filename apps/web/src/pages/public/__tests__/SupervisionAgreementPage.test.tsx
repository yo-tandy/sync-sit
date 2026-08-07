import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SUPERVISION_AGREEMENT_VERSION } from '@ejm/shared-core';

import i18n from '@/i18n';
import sitEn from '@/i18n/en';
import sitFr from '@/i18n/fr';
// The agreement copy has ONE source of truth (the governance plan). Both apps
// duplicate it in i18n, so a cheap parity guard pins them byte-identical.
import studyEn from '../../../../../study-web/src/i18n/en';
import studyFr from '../../../../../study-web/src/i18n/fr';
import { SupervisionAgreementPage } from '../SupervisionAgreementPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <SupervisionAgreementPage />
    </MemoryRouter>,
  );
}

describe('SupervisionAgreementPage (sit)', () => {
  beforeEach(() => i18n.changeLanguage('en'));
  afterEach(() => cleanup());

  it('renders every section heading and the version note', () => {
    renderPage();

    expect(screen.getAllByText('Supervision Agreement').length).toBeGreaterThan(0);
    expect(
      screen.getByText(new RegExp(`Version ${SUPERVISION_AGREEMENT_VERSION.replace('.', '\\.')}`)),
    ).toBeInTheDocument();
    expect(screen.getByText('What you confirm')).toBeInTheDocument();
    expect(screen.getByText('What you can see')).toBeInTheDocument();
    expect(screen.getByText('What you can do')).toBeInTheDocument();
    expect(screen.getByText('Your responsibilities')).toBeInTheDocument();
    expect(screen.getByText('Sharing of rights')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  it('renders in French', () => {
    i18n.changeLanguage('fr');
    renderPage();

    expect(screen.getAllByText('Accord de supervision').length).toBeGreaterThan(0);
    expect(screen.getByText('Ce que vous confirmez')).toBeInTheDocument();
  });

  // ── Cross-app parity pin: the agreement is IDENTICAL in both apps, both
  // languages. A reword in one app without the other (or without a version
  // bump) fails here.
  it('keeps the agreement copy byte-identical to sync-study in both languages', () => {
    expect(sitEn.supervisionAgreement).toEqual(studyEn.supervisionAgreement);
    expect(sitFr.supervisionAgreement).toEqual(studyFr.supervisionAgreement);
  });
});
