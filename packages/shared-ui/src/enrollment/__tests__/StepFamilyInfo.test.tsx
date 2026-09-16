import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { StepFamilyInfo, type FamilyFormData } from '../StepFamilyInfo.js';

afterEach(cleanup);

const ADDRESS = {
  fullAddress: '10 Rue Cler, 75007 Paris',
  street: '10 Rue Cler',
  city: 'Paris',
  postcode: '75007',
  lat: 48.857,
  lng: 2.305,
};

const EMPTY: FamilyFormData = {
  familyName: '',
  lastName: '',
  firstName: '',
  address: null,
  pets: '',
  note: '',
};

function setup(data: Partial<FamilyFormData> = {}, overrides: { loading?: boolean; error?: string | null; noteLabel?: string } = {}) {
  const onChange = vi.fn();
  const onNext = vi.fn();
  const view = renderWithProviders(
    <StepFamilyInfo
      data={{ ...EMPTY, ...data }}
      onChange={onChange}
      onNext={onNext}
      loading={overrides.loading ?? false}
      error={overrides.error ?? null}
      noteLabel={overrides.noteLabel ?? 'Notes for babysitters'}
    />,
  );
  return { onChange, onNext, view };
}

describe('StepFamilyInfo', () => {
  it('requires family name, first name and a picked address; last name, pets and notes are optional', () => {
    const { onNext } = setup({ familyName: 'Durand', firstName: 'Claire' });
    // No address yet → the submitting step stays gated.
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Complete sign-up' }).closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('submits once the three required fields are present, without touching the optional ones', () => {
    const { onNext } = setup({ familyName: 'Durand', firstName: 'Claire', address: ADDRESS });
    const button = screen.getByRole('button', { name: 'Complete sign-up' });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('whitespace-only names do not count as filled', () => {
    setup({ familyName: '   ', firstName: 'Claire', address: ADDRESS });
    expect(screen.getByRole('button', { name: 'Complete sign-up' })).toBeDisabled();
  });

  it('is controlled: each field reports a partial through onChange, the orchestrator owns the draft', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('Family name *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Martin' } });
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Claire' } });
    fireEvent.change(screen.getByLabelText('Pets'), { target: { value: 'Cat' } });
    fireEvent.change(screen.getByLabelText('Notes for babysitters'), { target: { value: 'Ring twice' } });
    expect(onChange).toHaveBeenNthCalledWith(1, { familyName: 'Durand' });
    expect(onChange).toHaveBeenNthCalledWith(2, { lastName: 'Martin' });
    expect(onChange).toHaveBeenNthCalledWith(3, { firstName: 'Claire' });
    expect(onChange).toHaveBeenNthCalledWith(4, { pets: 'Cat' });
    expect(onChange).toHaveBeenNthCalledWith(5, { note: 'Ring twice' });
  });

  it('renders the values it is given (a draft survives the expired-code round trip because the host keeps it)', () => {
    setup({ familyName: 'Durand', lastName: 'Martin', firstName: 'Claire', pets: 'Cat', note: 'Ring twice', address: ADDRESS });
    expect(screen.getByLabelText('Family name *')).toHaveValue('Durand');
    expect(screen.getByLabelText('Last name')).toHaveValue('Martin');
    expect(screen.getByLabelText('First name *')).toHaveValue('Claire');
    expect(screen.getByLabelText('Pets')).toHaveValue('Cat');
    expect(screen.getByLabelText('Notes for babysitters')).toHaveValue('Ring twice');
  });

  it('the notes label is host-supplied (sit vs study wording), the address label is the shared required one', () => {
    setup({}, { noteLabel: 'Notes for tutors' });
    expect(screen.getByLabelText('Notes for tutors')).toBeInTheDocument();
    expect(screen.getByText('Address *')).toBeInTheDocument();
  });

  it('shows the busy label and blocks submission while loading', () => {
    const { onNext } = setup({ familyName: 'Durand', firstName: 'Claire', address: ADDRESS }, { loading: true });
    const button = screen.getByRole('button', { name: 'Creating account...' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("renders the orchestrator's error above the submit button", () => {
    setup({}, { error: 'You already belong to a family.' });
    expect(screen.getByText('You already belong to a family.')).toBeInTheDocument();
  });

  it('collects NO consent checkbox — consent lives on StepPassword so every path consents exactly once', () => {
    setup();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

// Ported from study-web's former local StepFamilyInfo test (#440 PR3): the
// critical gate is that an address is only "set" when PICKED from the
// geocoder suggestions — typed text alone must not enable submit
// (AddressAutocomplete renders no error in that state, so the disabled
// button is the only signal).
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
  const [data, setData] = useState<FamilyFormData>(EMPTY);
  return (
    <StepFamilyInfo
      data={data}
      onChange={(partial) => {
        seen.push(partial);
        setData((prev) => ({ ...prev, ...partial }));
      }}
      onNext={onNext}
      loading={false}
      error={null}
      noteLabel="Notes for tutors"
    />
  );
}

describe('StepFamilyInfo with the real address picker', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ features: [FEATURE] }) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submit stays disabled with a typed-but-unpicked address', () => {
    const onNext = vi.fn();
    renderWithProviders(<Harness onNext={onNext} seen={[]} />);
    fireEvent.change(screen.getByLabelText('Family name *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Claire' } });
    // Type into the address field WITHOUT picking a suggestion — the value
    // stays null, so the form must not be submittable.
    fireEvent.change(screen.getByPlaceholderText(/Start typing an address/), {
      target: { value: '10 Rue Cler' },
    });
    const button = screen.getByRole('button', { name: 'Complete sign-up' });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('a picked address flows up as the full Address (incl. postcode/city) and enables submit', async () => {
    const onNext = vi.fn();
    const seen: Partial<FamilyFormData>[] = [];
    renderWithProviders(<Harness onNext={onNext} seen={seen} />);
    fireEvent.change(screen.getByLabelText('Family name *'), { target: { value: 'Durand' } });
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Claire' } });
    // Pick from the geocoder suggestions (debounced fetch).
    fireEvent.change(screen.getByPlaceholderText(/Start typing an address/), {
      target: { value: '10 Rue Cler' },
    });
    fireEvent.click(await screen.findByText('10 Rue Cler', {}, { timeout: 2000 }));

    // The onChange partial carried the FULL Address — postcode/city included,
    // which the orchestrator forwards to enrollFamily (issue #167).
    const addressUpdate = seen.find((p) => p.address);
    expect(addressUpdate?.address).toMatchObject({
      fullAddress: '10 Rue Cler, 75007 Paris',
      street: '10 Rue Cler',
      city: 'Paris',
      postcode: '75007',
      lat: 48.857,
      lng: 2.305,
    });
    const button = screen.getByRole('button', { name: 'Complete sign-up' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
