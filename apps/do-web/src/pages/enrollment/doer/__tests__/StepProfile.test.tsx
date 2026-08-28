import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { StepProfile } from '../StepProfile';

// The client-side validation the wizard relies on before the server re-runs
// the real gates: the under-15 DOB floor with its governed stand-down
// (§11.1's carve-out — a supervised 13-year-old must get past this input),
// the contact-email format mirror of the server's strictness, and the
// per-field identity composition.

function dob(age: number): string {
  const d = new Date();
  let y = d.getFullYear();
  let m = d.getMonth() - 5;
  if (m < 0) {
    m += 12;
    y -= 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y - age}-${pad(m + 1)}-15`;
}

const continueBtn = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;

function fillIdentity(age: number) {
  fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Kid' } });
  fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Case' } });
  fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: dob(age) } });
}

describe('StepProfile — client validation', () => {
  it('a 14-year-old DOB blocks Continue and shows the floor copy (ungoverned)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillIdentity(14);
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'kid@test.com' } });
    expect(screen.getByText('You must be at least 15')).toBeTruthy();
    expect(continueBtn().disabled).toBe(true);
  });

  it('the SAME DOB passes for a governed account (the §11.1 carve-out — supervision is the protection)', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepProfile onNext={onNext} governed />);
    fillIdentity(13);
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'kid@test.com' } });
    expect(screen.queryByText('You must be at least 15')).toBeNull();
    expect(continueBtn().disabled).toBe(false);
    fireEvent.click(continueBtn());
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Kid', dateOfBirth: dob(13), contactEmail: 'kid@test.com' }),
    );
  });

  it('no upper age bound: an adult DOB passes (unlike study\'s 15-19 class gate)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillIdentity(40);
    fireEvent.change(screen.getByLabelText('Contact phone'), { target: { value: '+33 611' } });
    expect(continueBtn().disabled).toBe(false);
  });

  it('a malformed contact email blocks UNCONDITIONALLY, even with a phone present (server-strictness mirror)', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillIdentity(16);
    fireEvent.change(screen.getByLabelText('Contact phone'), { target: { value: '+33 611' } });
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'x@y' } });
    expect(screen.getByText('Enter a full email address (e.g. name@example.com).')).toBeTruthy();
    expect(continueBtn().disabled).toBe(true);
    // Fixing the email unblocks.
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'x@y.com' } });
    expect(continueBtn().disabled).toBe(false);
  });

  it('requires at least one contact channel when collectContact is on', () => {
    renderWithProviders(<StepProfile onNext={vi.fn()} />);
    fillIdentity(16);
    expect(continueBtn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Contact phone'), { target: { value: '+33 611' } });
    expect(continueBtn().disabled).toBe(false);
  });

  it('PER-FIELD identity: on-file fields render read-only and are omitted from the payload; only the missing DOB is asked and sent', () => {
    const onNext = vi.fn();
    renderWithProviders(
      <StepProfile
        onNext={onNext}
        identityOnFile={{ firstName: 'Zoé', lastName: 'Martin' }}
        collectContact={false}
      />,
    );
    expect(screen.queryByLabelText('First name *')).toBeNull();
    expect(screen.queryByLabelText('Last name *')).toBeNull();
    fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: dob(16) } });
    fireEvent.click(continueBtn());
    expect(onNext).toHaveBeenCalledTimes(1);
    const payload = onNext.mock.calls[0]![0];
    expect(payload.firstName).toBeUndefined();
    expect(payload.lastName).toBeUndefined();
    expect(payload.dateOfBirth).toBe(dob(16));
    expect(payload.contactEmail).toBeUndefined();
  });

  it('everything on file + collectContact off: the summary shows and Continue is immediately enabled', () => {
    renderWithProviders(
      <StepProfile
        onNext={vi.fn()}
        identityOnFile={{ firstName: 'Zoé', lastName: 'Martin', dateOfBirth: '2009-01-15' }}
        collectContact={false}
      />,
    );
    expect(screen.getByText(/your identity is already on file/)).toBeTruthy();
    expect(continueBtn().disabled).toBe(false);
  });
});
