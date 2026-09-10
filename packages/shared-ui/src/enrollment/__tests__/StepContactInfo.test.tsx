import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { StepContactInfo } from '../StepContactInfo.js';

afterEach(cleanup);

describe('StepContactInfo', () => {
  it('requires at least one contact channel: neither field alone is individually mandatory', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="nina28@ejm.org" />);

    expect(screen.getByText('Provide at least one contact method (email or phone).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    // Phone alone satisfies the step.
    fireEvent.change(screen.getByPlaceholderText('6 12 34 56 78'), { target: { value: '612345678' } });
    expect(screen.queryByText('Provide at least one contact method (email or phone).')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  it('the autofill button copies the verified EJM email into the contact-email field, with no callable', () => {
    renderWithProviders(<StepContactInfo onNext={vi.fn()} ejemEmail="nina28@ejm.org" />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my EJM email (nina28@ejm.org)' }));
    expect(screen.getByLabelText('Contact email')).toHaveValue('nina28@ejm.org');
  });

  it('a malformed email blocks submission even with a phone present (mirrors the per-role precedent)', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByPlaceholderText('6 12 34 56 78'), { target: { value: '612345678' } });
    expect(screen.getByText('Enter a full email address (e.g. name@example.com).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('WhatsApp defaults to mirroring the phone field, matching the existing AccountPage behavior', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByPlaceholderText('6 12 34 56 78'), { target: { value: '612345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: '+33 612345678', whatsapp: '+33 612345678' }),
    );
  });

  it('unchecking "same as phone" reveals a separate WhatsApp number that is sent instead', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByPlaceholderText('6 12 34 56 78'), { target: { value: '612345678' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Same as my phone number' }));

    const phoneInputs = screen.getAllByPlaceholderText('6 12 34 56 78');
    expect(phoneInputs).toHaveLength(2); // contact phone + the now-revealed WhatsApp field
    fireEvent.change(phoneInputs[1], { target: { value: '798765432' } });

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ contactPhone: '+33 612345678', whatsapp: '+33 798765432' }),
    );
  });

  // REGRESSION (review of PR #444). `whatsapp` is `string | null` while
  // `contactPhone` is always a string, so the two "empty" spellings are not
  // ===. A user who left "same as phone" CHECKED (the default) with no phone
  // submits {whatsapp: null, contactPhone: ''}; the old
  // `initial.whatsapp === initial.contactPhone` then evaluated `null === ''`
  // and silently restored the box UNCHECKED, so a phone typed afterwards no
  // longer mirrored and whatsapp stayed null against the user's intent.
  it('keeps "same as phone" CHECKED on back-navigation when it was checked with no phone', () => {
    renderWithProviders(
      <StepContactInfo
        onNext={vi.fn()}
        ejemEmail=""
        initial={{
          contactEmail: 'nina@example.com',
          contactPhone: '',
          whatsapp: null,
          contactVisibilityConsent: false,
        }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Same as my phone number' })).toBeChecked();
    // ...and no separate WhatsApp field is revealed, since it mirrors.
    expect(screen.queryAllByPlaceholderText('6 12 34 56 78')).toHaveLength(1);
  });

  it('restores a mirrored phone/WhatsApp pair on back-navigation', () => {
    renderWithProviders(
      <StepContactInfo
        onNext={vi.fn()}
        ejemEmail=""
        initial={{
          contactEmail: 'nina@example.com',
          contactPhone: '+33 612345678',
          whatsapp: '+33 612345678',
          contactVisibilityConsent: true,
        }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Same as my phone number' })).toBeChecked();
    expect(screen.getByLabelText('Contact email')).toHaveValue('nina@example.com');
  });

  it('restores an INDEPENDENT WhatsApp number as unchecked, with the second field revealed', () => {
    // The case that must NOT regress to "checked" when fixing the above: a
    // distinct whatsapp is unambiguous and has to round-trip exactly.
    renderWithProviders(
      <StepContactInfo
        onNext={vi.fn()}
        ejemEmail=""
        initial={{
          contactEmail: '',
          contactPhone: '+33 612345678',
          whatsapp: '+33 798765432',
          contactVisibilityConsent: false,
        }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Same as my phone number' })).not.toBeChecked();
    expect(screen.getAllByPlaceholderText('6 12 34 56 78')).toHaveLength(2);
  });

  it('sends the EXACT payload shape -- empty phone becomes null whatsapp, email is trimmed', () => {
    // objectContaining would not catch a stray field, an untrimmed email, or
    // whatsapp coming back as '' instead of null (the shape root User.whatsapp
    // expects).
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="" />);

    fireEvent.change(screen.getByLabelText('Contact email'), {
      target: { value: '  nina@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onNext).toHaveBeenCalledWith({
      contactEmail: 'nina@example.com',
      contactPhone: '',
      whatsapp: null,
      contactVisibilityConsent: false,
    });
  });

  it('renders a server-side rejection carried back from a later step', () => {
    renderWithProviders(
      <StepContactInfo onNext={vi.fn()} ejemEmail="" serverError="Something went wrong." />,
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });

  it('the consent checkbox never blocks submission; unchecked shows the honest inline warning', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepContactInfo onNext={onNext} ejemEmail="" />);
    fireEvent.change(screen.getByLabelText('Contact email'), { target: { value: 'nina@example.com' } });

    expect(
      screen.getByText(
        "Without this, you won't show up in search until contact visibility is turned on later, from your account settings.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ contactVisibilityConsent: false }));

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: "I'm aware that families who want to reach me will get access to this contact information once I'm visible in search.",
      }),
    );
    expect(
      screen.queryByText(
        "Without this, you won't show up in search until contact visibility is turned on later, from your account settings.",
      ),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenLastCalledWith(expect.objectContaining({ contactVisibilityConsent: true }));
  });
});
