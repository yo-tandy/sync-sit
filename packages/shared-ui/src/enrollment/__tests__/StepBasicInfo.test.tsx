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

  // The EJM-grad-year branch of the age gate (review of PR #444). Every other
  // test in this file passes ejemEmail="", and validateEjmEmail('') fails the
  // domain check before a graduationYear is ever computed -- so the dual-signal
  // branch was unreachable, and swapping the under_15/age_mismatch keys (or
  // deleting the checkEnrollmentAge call entirely) failed nothing.
  //
  // Ages are relative to today so these don't rot: with a grad year one school
  // year out, expectedAgeForGradYear is 17.
  function fillIdentityExceptDob() {
    fireEvent.change(screen.getByLabelText('First name *'), { target: { value: 'Nina' } });
    fireEvent.change(screen.getByLabelText('Last name *'), { target: { value: 'Cohen' } });
    fireEvent.change(screen.getByLabelText('Class *'), { target: { value: '1ère' } });
    fireEvent.click(screen.getByRole('button', { name: 'Female' }));
  }

  /** Two-digit EJM grad year whose expected age is `age` today. */
  function gradYearForExpectedAge(age: number): string {
    const now = new Date();
    const schoolYearEnd = now.getMonth() + 1 >= 9 ? now.getFullYear() + 1 : now.getFullYear();
    return String((schoolYearEnd + (18 - age)) % 100).padStart(2, '0');
  }

  it('shows the under-15 copy (not the plain range error) when the EJM grad year is present', () => {
    const onNext = vi.fn();
    const ejemEmail = `nina${gradYearForExpectedAge(17)}@ejm.org`;
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail={ejemEmail} />);

    fillIdentityExceptDob();
    fireEvent.change(screen.getByLabelText('Date of birth *'), {
      target: { value: isoDaysAgoYears(14) },
    });

    expect(
      screen.getByText(
        'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('shows the mismatch copy for a DOB that the plain range check would ACCEPT', () => {
    // 15 is inside the plain 15-18 fallback range, so only the dual-signal
    // branch can reject it: expected age is 17, |15 - 17| = 2. If the component
    // stopped calling checkEnrollmentAge, this DOB would sail through.
    const onNext = vi.fn();
    const ejemEmail = `nina${gradYearForExpectedAge(17)}@ejm.org`;
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail={ejemEmail} />);

    fillIdentityExceptDob();
    fireEvent.change(screen.getByLabelText('Date of birth *'), {
      target: { value: isoDaysAgoYears(15) },
    });

    expect(
      screen.getByText(
        "Your date of birth doesn't match your school year. Please contact the EJM administrator.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('accepts a DOB consistent with the EJM grad year', () => {
    const onNext = vi.fn();
    const ejemEmail = `nina${gradYearForExpectedAge(17)}@ejm.org`;
    renderWithProviders(<StepBasicInfo onNext={onNext} ejemEmail={ejemEmail} />);

    fillIdentityExceptDob();
    fireEvent.change(screen.getByLabelText('Date of birth *'), {
      target: { value: isoDaysAgoYears(17) },
    });

    expect(screen.queryByText(/date of birth doesn't match/i)).toBeNull();
    expect(screen.queryByText(/at least 15 to enroll/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
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
    // DOB and class asserted DIRECTLY, not merely inferred from Continue being
    // enabled: restoring a different-but-still-valid DOB or class level would
    // otherwise pass unnoticed.
    expect(screen.getByLabelText('Date of birth *')).toHaveValue(isoDaysAgoYears(17));
    expect(screen.getByLabelText('Class *')).toHaveValue('Terminale');
    expect(screen.getByRole('button', { name: 'Male' })).toHaveClass('border-brand-600');
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('renders a server-side rejection carried back from a later step', () => {
    renderWithProviders(<StepBasicInfo onNext={vi.fn()} ejemEmail="" serverError="Something went wrong." />);
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
