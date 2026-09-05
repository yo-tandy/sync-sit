import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/render.js';
import { StepAdditionalInfo } from '../StepAdditionalInfo.js';

afterEach(cleanup);

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('StepAdditionalInfo', () => {
  it('every field is optional: Continue is enabled with nothing filled in', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepAdditionalInfo onNext={onNext} />);

    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith({ bio: '', photoFile: null, address: null });
  });

  it('trims and forwards the bio text', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepAdditionalInfo onNext={onNext} />);

    fireEvent.change(screen.getByLabelText('About me (optional)'), { target: { value: '  Loves math.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Loves math.' }));
  });

  it('accepts a valid photo, forwards it on submit, and lets it be removed', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('me.png', 'image/png', 1024);

    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ photoFile: file }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('rejects a file the browser positively identifies as a non-image', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile('cv.pdf', 'application/pdf', 1024)] } });
    expect(screen.getByText('Please choose a JPEG, PNG, WebP or HEIC image.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('rejects image/svg+xml -- scriptable, renders live (the #281 carve-out)', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile('x.svg', 'image/svg+xml', 512)] } });
    expect(screen.getByText('Please choose a JPEG, PNG, WebP or HEIC image.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  // The reason this is a denylist and not an allowlist (issue #281's rationale,
  // which storage.rules spells out): browsers report File.type inconsistently.
  // An iPhone HEIC very often arrives with an EMPTY type, and some OS/browser
  // combos report application/octet-stream for a perfectly good file. An
  // allowlist rejected exactly those users' own photos.
  it.each([
    ['an empty type (iPhone HEIC frequently reports this)', ''],
    ['application/octet-stream (generic, type undetermined)', 'application/octet-stream'],
    ['image/heic', 'image/heic'],
    ['image/gif', 'image/gif'],
    // Padding variants must hit the unknown-type branch rather than falling
    // through to the image check and being rejected (PR #450 review). NB the
    // File constructor lowercases `type` per spec, and jsdom honours that, so
    // a CASE variant cannot be exercised from a test at all -- a mixed-case
    // pin here would pass no matter what the function does. The normalisation
    // is written to handle case anyway, since the premise of this denylist is
    // that File.type is not reliably what the spec promises; it just cannot be
    // pinned from here. Padding IS preserved, so these two do bite.
    ['a padded generic type', '  application/octet-stream  '],
    ['whitespace-only type (effectively unknown)', '   '],
  ])('accepts a photo with %s', (_label, type) => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile('me.img', type, 1024)] } });
    expect(screen.queryByText('Please choose a JPEG, PNG, WebP or HEIC image.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('restores bio and address from initial on back-navigation', () => {
    const onNext = vi.fn();
    renderWithProviders(
      <StepAdditionalInfo
        onNext={onNext}
        initial={{ bio: 'I tutor maths on Saturdays.', address: null }}
      />,
    );
    expect(screen.getByDisplayValue('I tutor maths on Saturdays.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onNext).toHaveBeenCalledWith({
      bio: 'I tutor maths on Saturdays.',
      photoFile: null,
      address: null,
    });
  });

  it('rejects a file over 5 MB', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile('me.png', 'image/png', 6 * 1024 * 1024)] } });
    expect(screen.getByText('Photo must be smaller than 5 MB.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('shows the "optimize search" hint next to the (unmodified) shared AddressAutocomplete', () => {
    renderWithProviders(<StepAdditionalInfo onNext={vi.fn()} />);
    expect(screen.getByText('Address (optional)')).toBeInTheDocument();
    expect(
      screen.getByText('This helps optimize your search results — families see how far away you are.'),
    ).toBeInTheDocument();
  });

  it('renders a server-side rejection carried back from a later step', () => {
    renderWithProviders(<StepAdditionalInfo onNext={vi.fn()} serverError="Something went wrong." />);
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });
});
