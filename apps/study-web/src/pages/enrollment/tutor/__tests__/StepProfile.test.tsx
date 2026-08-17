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

function submitBtn(): HTMLElement {
  return screen.getByRole('button', { name: /Continue/i });
}

describe('StepProfile (tutor)', () => {
  it('keeps submit disabled until all required fields INCLUDING a contact are valid', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    expect(submitBtn()).toBeDisabled();

    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    // Contact gate (moved here from the removed prefs step): still disabled.
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 't@ejm.org' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('accepts a phone as the contact (instead of email)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    fireEvent.change(screen.getByLabelText(/Contact phone/i), { target: { value: '+33100000000' } });
    expect(submitBtn()).toBeEnabled();
  });

  it('calls onNext with the profile payload including contact on submit', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepProfile onNext={onNext} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    fireEvent.click(screen.getByText('Female'));
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 't@ejm.org' } });
    fireEvent.click(submitBtn());

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith({
      firstName: 'Flow',
      lastName: 'Tutor',
      dateOfBirth: validDob,
      classLevel: 'Terminale',
      gender: 'female',
      contactEmail: 't@ejm.org',
      contactPhone: undefined,
    });
  });

  it('rejects an under-15 age (shows error, submit stays disabled)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 't@ejm.org' } });
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: tooYoungDob } });
    expect(screen.getByText(/between 15 and 18/i)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  it('rejects an over-18 age', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 't@ejm.org' } });
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: tooOldDob } });
    expect(submitBtn()).toBeDisabled();
  });

  it('offers only the tutor class levels', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    const select = screen.getByLabelText(/Class/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['Terminale', '1ère', '2nde', '3ème']);
  });

  it('a malformed email blocks submit even when a valid phone is present', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepProfile onNext={onNext} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 'tom@ejm' } });
    fireEvent.change(screen.getByLabelText(/Contact phone/i), { target: { value: '+33 612345678' } });

    // The phone alone satisfies has-a-contact, but the malformed email
    // would ride into the payload and be rejected server-side on the
    // SUBJECTS step — the email format gates unconditionally.
    expect(screen.getByText(/full email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it("blocks a TLD-less contact email the server would reject ('tom@ejm')", () => {
    const onNext = vi.fn();
    renderWithProviders(<StepProfile onNext={onNext} />);
    fillBasics();
    fireEvent.change(screen.getByLabelText(/Date of birth/i), { target: { value: validDob } });
    fireEvent.change(screen.getByLabelText(/Contact email/i), { target: { value: 'tom@ejm' } });

    // The browser's native email check accepts 'x@y'; zod's .email() on the
    // server does not — and the rejection would land on the subjects step.
    expect(screen.getByText(/full email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('restores previously-entered values via initial (back-navigation)', () => {
    const onNext = vi.fn();
    renderWithProviders(
      <StepProfile
        onNext={onNext}
        initial={{
          firstName: 'Flow', lastName: 'Tutor', dateOfBirth: '2010-01-15',
          classLevel: 'Terminale', gender: 'other', contactEmail: 'flow@ejm.org',
        }}
      />,
    );
    expect(screen.getByLabelText(/First name/i)).toHaveValue('Flow');
    expect(screen.getByLabelText(/Contact email/i)).toHaveValue('flow@ejm.org');
  });
});
