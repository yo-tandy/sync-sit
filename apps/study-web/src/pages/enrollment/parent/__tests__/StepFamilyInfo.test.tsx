import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { StepFamilyInfo } from '../StepFamilyInfo';
import type { FamilyFormData } from '../StepFamilyInfo';

// Direct tests for the real component (convention parity with the tutor
// steps' StepProfile/StepSubjects tests). The critical gate: an address is
// only "set" when PICKED from the geocoder suggestions — typed text alone
// must not enable submit (AddressAutocomplete renders no error in that
// state, so the disabled button is the only signal).

const FEATURE = {
  properties: {
    label: '10 Rue Cler, 75007 Paris',
    name: '10 Rue Cler',
    city: 'Paris',
    postcode: '75007',
    context: '75, Paris',
  },
  geometry: { coordinates: [2.305, 48.857] },
};

// Controlled harness standing in for the orchestrator: owns the draft and
// records what flows up through onChange.
function Harness({ onNext, seen }: { onNext: () => void; seen: Partial<FamilyFormData>[] }) {
  const [data, setData] = useState<FamilyFormData>({
    familyName: '',
    lastName: '',
    firstName: '',
    address: null,
    pets: '',
    note: '',
  });
  return (
    <I18nextProvider i18n={i18n}>
      <StepFamilyInfo
        data={data}
        onChange={(partial) => {
          seen.push(partial);
          setData((prev) => ({ ...prev, ...partial }));
        }}
        onNext={onNext}
        loading={false}
        error={null}
      />
    </I18nextProvider>
  );
}

function submitButton() {
  return screen.getByRole('button', { name: i18n.t('enrollment.completeSignup') });
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ features: [FEATURE] }) })),
  );
});

describe('StepFamilyInfo', () => {
  it('submit stays disabled with a typed-but-unpicked address', async () => {
    const onNext = vi.fn();
    render(<Harness onNext={onNext} seen={[]} />);

    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.familyName')), {
      target: { value: 'Durand' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.firstName')), {
      target: { value: 'Claire' },
    });
    // Type into the address field WITHOUT picking a suggestion — the value
    // stays null, so the form must not be submittable.
    fireEvent.change(screen.getByPlaceholderText(/Start typing an address/), {
      target: { value: '10 Rue Cler' },
    });

    expect(submitButton()).toBeDisabled();
    fireEvent.submit(submitButton().closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('a picked address flows up as the full AddressResult (incl. postcode/city) and enables submit', async () => {
    const onNext = vi.fn();
    const seen: Partial<FamilyFormData>[] = [];
    render(<Harness onNext={onNext} seen={seen} />);

    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.familyName')), {
      target: { value: 'Durand' },
    });
    fireEvent.change(screen.getByLabelText(i18n.t('enrollment.firstName')), {
      target: { value: 'Claire' },
    });

    // Pick from the geocoder suggestions (debounced fetch).
    fireEvent.change(screen.getByPlaceholderText(/Start typing an address/), {
      target: { value: '10 Rue Cler' },
    });
    fireEvent.click(await screen.findByText('10 Rue Cler', {}, { timeout: 2000 }));

    // The onChange partial carried the FULL AddressResult — postcode/city
    // included, which the orchestrator forwards to enrollFamily (issue #167).
    const addressUpdate = seen.find((p) => p.address);
    expect(addressUpdate?.address).toMatchObject({
      fullAddress: '10 Rue Cler, 75007 Paris',
      street: '10 Rue Cler',
      city: 'Paris',
      postcode: '75007',
      lat: 48.857,
      lng: 2.305,
    });

    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
