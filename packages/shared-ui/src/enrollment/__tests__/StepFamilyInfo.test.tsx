import { describe, it, expect, vi, afterEach } from 'vitest';
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
