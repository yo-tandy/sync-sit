import { describe, it, expect, beforeAll, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { StepPrefs } from '../StepPrefs';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function submitBtn(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

describe('StepPrefs (tutor)', () => {
  it('keeps submit disabled until a session length, a location, and a contact are set', () => {
    const { container } = renderWithProviders(
      <StepPrefs onNext={vi.fn()} loading={false} error={null} />,
    );
    expect(submitBtn(container)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    expect(submitBtn(container)).toBeDisabled(); // still missing location + contact

    fireEvent.click(screen.getByRole('checkbox', { name: 'Online' }));
    expect(submitBtn(container)).toBeDisabled(); // still missing contact

    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 't@ejm.org' } });
    expect(submitBtn(container)).toBeEnabled();
  });

  it('submits the prefs payload', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(
      <StepPrefs onNext={onNext} loading={false} error={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Online' }));
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 't@ejm.org' } });
    fireEvent.click(submitBtn(container));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionLengthsMin: [60],
        locationPrefs: ['online'],
        contactEmail: 't@ejm.org',
        paddingMin: 0,
        areaMode: 'arrondissement',
      }),
    );
  });

  it('accepts a phone as the contact (instead of email)', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(
      <StepPrefs onNext={onNext} loading={false} error={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '45 min' }));
    fireEvent.click(screen.getByRole('checkbox', { name: "At family's home" }));
    fireEvent.change(container.querySelector('input[type="tel"]')!, { target: { value: '+33100000000' } });
    expect(submitBtn(container)).toBeEnabled();
    fireEvent.click(submitBtn(container));
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ sessionLengthsMin: [45], locationPrefs: ['family_home'], contactPhone: '+33100000000' }),
    );
  });

  it('disables submit while loading', () => {
    const { container } = renderWithProviders(
      <StepPrefs onNext={vi.fn()} loading={true} error={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Online' }));
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 't@ejm.org' } });
    expect(submitBtn(container)).toBeDisabled();
  });

  it('switching area mode to distance changes the address payload field', () => {
    const onNext = vi.fn();
    const { container } = renderWithProviders(
      <StepPrefs onNext={onNext} loading={false} error={null} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Online' }));
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: 't@ejm.org' } });
    fireEvent.click(screen.getByRole('button', { name: /By distance/i }));
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: '16 rue de Passy' } });
    fireEvent.click(submitBtn(container));
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ areaMode: 'distance', areaAddress: '16 rue de Passy' }),
    );
  });
});
