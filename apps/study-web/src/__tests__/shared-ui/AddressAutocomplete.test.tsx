import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AddressAutocomplete, type AddressResult } from '@ejm/shared-ui';

const addr = (fullAddress: string): AddressResult => ({
  fullAddress,
  street: '',
  city: '',
  postcode: '',
  lat: 48.85,
  lng: 2.35,
});

describe('AddressAutocomplete late-value sync', () => {
  afterEach(cleanup);

  // Pages that load the stored address AFTER mount (tutor Area editor) must
  // see it appear in the field — the component used to seed only at mount.
  it('syncs a value that arrives after mount into the text field', () => {
    const { rerender } = render(<AddressAutocomplete value={null} onChange={() => {}} />);
    const input = screen.getByRole('textbox');
    expect((input as HTMLInputElement).value).toBe('');

    rerender(<AddressAutocomplete value={addr('5 Rue de Passy, 75016 Paris')} onChange={() => {}} />);
    expect((input as HTMLInputElement).value).toBe('5 Rue de Passy, 75016 Paris');
  });

  it('value going null (user editing) does not wipe the typed text', () => {
    const { rerender } = render(
      <AddressAutocomplete value={addr('5 Rue de Passy, 75016 Paris')} onChange={() => {}} />,
    );
    rerender(<AddressAutocomplete value={null} onChange={() => {}} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('5 Rue de Passy, 75016 Paris');
  });
});
