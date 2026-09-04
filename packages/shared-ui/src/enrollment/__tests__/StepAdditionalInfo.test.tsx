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

  it('rejects an unsupported file type without touching photoFile', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(<StepAdditionalInfo onNext={onNext} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [makeFile('me.gif', 'image/gif', 1024)] } });
    expect(screen.getByText('Please choose a JPEG, PNG, WebP or HEIC image.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
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
