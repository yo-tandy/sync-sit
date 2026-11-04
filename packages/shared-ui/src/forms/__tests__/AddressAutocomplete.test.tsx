import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createTestI18n } from '../../test-utils/i18n.js';
import { AddressAutocomplete } from '../AddressAutocomplete.js';

afterEach(cleanup);

// Issue #524: the placeholder and the data.gouv attribution used to be
// hardcoded English and stayed English on the French UI. They now come from
// `common.addressPlaceholder` / `common.addressPoweredBy`, so a host locale
// controls them — pinned by overriding the copy and reading it back.
describe('AddressAutocomplete i18n', () => {
  it('reads the placeholder and the attribution from the host locale', () => {
    const i18n = createTestI18n();
    i18n.addResource('en', 'translation', 'common.addressPlaceholder', 'Saisir une adresse…');
    i18n.addResource('en', 'translation', 'common.addressPoweredBy', 'Propulsé par adresse.data.gouv.fr');
    render(
      <I18nextProvider i18n={i18n}>
        <AddressAutocomplete value={null} onChange={vi.fn()} />
      </I18nextProvider>,
    );
    expect(screen.getByPlaceholderText('Saisir une adresse…')).toBeInTheDocument();
    expect(screen.getByText(/Propulsé par adresse\.data\.gouv\.fr/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Start typing an address...')).toBeNull();
  });
});
