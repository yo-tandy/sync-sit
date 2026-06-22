import { describe, it, expect, beforeAll, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { StepProfile } from '../StepProfile';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

// A DOB that yields an in-range (15–18) tutor age relative to "now".
const validDob = `${new Date().getFullYear() - 17}-01-01`;
const tooYoungDob = `${new Date().getFullYear() - 12}-01-01`;
const tooOldDob = `${new Date().getFullYear() - 20}-01-01`;

function fillBasics() {
  fireEvent.change(screen.getByLabelText(/First name/i), { target: { value: 'Flow' } });
  fireEvent.change(screen.getByLabelText(/Last name/i), { target: { value: 'Tutor' } });
  fireEvent.change(screen.getByLabelText(/Class/i), { target: { value: 'Terminale' } });
}

describe('StepProfile (tutor)', () => {
  it('keeps Continue disabled until all required fields are valid', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    const cont = screen.getByRole('button', { name: /Continue/i });
    expect(cont).toBeDisabled();

    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    expect(cont).toBeEnabled();
  });

  it('calls onNext with the profile payload on submit', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepProfile onNext={onNext} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    fireEvent.click(screen.getByText('Female'));
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith({
      firstName: 'Flow',
      lastName: 'Tutor',
      dateOfBirth: validDob,
      classLevel: 'Terminale',
      gender: 'female',
    });
  });

  it('rejects an under-15 age (shows error, Continue stays disabled)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: tooYoungDob } });
    expect(screen.getByText(/between 15 and 18/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('rejects an over-18 age', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: tooOldDob } });
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('offers only the tutor class levels', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    const select = screen.getByLabelText(/Class/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['Terminale', '1ère', '2nde', '3ème']);
  });
});
