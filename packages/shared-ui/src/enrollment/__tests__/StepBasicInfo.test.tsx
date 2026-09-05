import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { StepBasicInfo } from '../StepBasicInfo.js';

afterEach(cleanup);

function isoDaysAgoYears(years: number): string {
  const now = new Date();
  const dob = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  return dob.toISOString().slice(0, 10);
}

describe('StepBasicInfo', () => {
  it('keeps Continue disabled until every field (including gender) is filled', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail="" />);

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Nina' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Cohen' } });
    fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: isoDaysAgoYears(16) } });
    fireEvent.change(screen.getByLabelText('Class *'), { target: { value: '1ère' } });
    expect(continueBtn).toBeDisabled(); // gender still missing

    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
    expect(continueBtn).not.toBeDisabled();
  });

  it('submits the collected payload, and a second click on the same gender option clears it again', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Nina' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Cohen' } });
    const dob = isoDaysAgoYears(16);
    fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: dob } });
    fireEvent.change(screen.getByLabelText('Class *'), { target: { value: '1ère' } });

    const femaleBtn = screen.getByRole('button', { name: 'Female' });
    fireEvent.click(femaleBtn);
    fireEvent.click(femaleBtn); // toggles back off
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNext).toHaveBeenCalledWith({
      firstName: 'Nina',
      lastName: 'Cohen',
      dateOfBirth: dob,
      classLevel: '1ère',
      gender: 'other',
    });
  });

  it('blocks submission and shows the plain age error for a too-young DOB with no parseable EJM grad year', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Nina' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Cohen' } });
    fireEvent.change(screen.getByLabelText('Date of birth *'), { target: { value: isoDaysAgoYears(10) } });
    fireEvent.change(screen.getByLabelText('Class *'), { target: { value: 'Terminale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));

    expect(screen.getByText('You must be between 15 and 18 years old')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('restores initial values on re-mount (back-navigation)', () => {
    renderWithProviders(
      <StepBasicInfo
        onNext={vi.fn()}
        ejemEmail=""
        initial={{ firstName: 'Amir', lastName: 'Levi', dateOfBirth: isoDaysAgoYears(17), classLevel: 'Terminale', gender: 'male' }}
      />,
    );
    expect(screen.getByDisplayValue('Amir')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Levi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Male' })).toHaveClass('border-brand-600');
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('renders a server-side rejection carried back from a later step', () => {
    renderWithProviders(<StepBasicInfo onNext={vi.fn()} ejemEmail="" serverError="Something went wrong." />);
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
