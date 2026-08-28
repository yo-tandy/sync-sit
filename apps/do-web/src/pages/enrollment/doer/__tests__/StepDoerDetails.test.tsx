import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { DO_DOER_BIO_MAX, DO_PRICE_MAX, TASK_CATEGORIES } from '@ejm/do-core';
import { StepDoerDetails } from '../StepDoerDetails';

// The submitting step's own validation (do-core bounds mirrored client-side)
// and its collect() normalization — category re-sort into display order.

const submitBtn = () => screen.getByRole('button', { name: 'Complete sign-up' }) as HTMLButtonElement;

describe('StepDoerDetails — client validation', () => {
  it('all seven categories preselected; submit enabled with the defaults', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepDoerDetails onNext={onNext} loading={false} error={null} />);
    expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThanOrEqual(7);
    expect(submitBtn().disabled).toBe(false);
    fireEvent.click(submitBtn());
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({
        categories: [...TASK_CATEGORIES],
        notifyNewTasks: true,
        hasCar: false,
        hasBike: false,
        defaultRate: null,
      }),
    );
  });

  it('an out-of-range default rate blocks submit with the bounds copy; clearing it unblocks', () => {
    renderWithProviders(<StepDoerDetails onNext={vi.fn()} loading={false} error={null} />);
    const rate = screen.getByLabelText('Default rate (EUR, optional)');
    fireEvent.change(rate, { target: { value: String(DO_PRICE_MAX + 1) } });
    expect(submitBtn().disabled).toBe(true);
    expect(screen.getByText(`Must be a number between 0 and ${DO_PRICE_MAX}`)).toBeTruthy();
    fireEvent.change(rate, { target: { value: '' } });
    expect(submitBtn().disabled).toBe(false);
  });

  it('the bio textarea is capped at DO_DOER_BIO_MAX (maxLength attribute mirrors the do-core bound)', () => {
    renderWithProviders(<StepDoerDetails onNext={vi.fn()} loading={false} error={null} />);
    const bio = screen.getByLabelText('About me') as HTMLTextAreaElement;
    expect(bio.maxLength).toBe(DO_DOER_BIO_MAX);
  });

  it('collect() re-sorts a click-ordered selection into TASK_CATEGORIES display order', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepDoerDetails onNext={onNext} loading={false} error={null} />);
    // Deselect everything...
    for (const btn of screen.getAllByRole('button', { pressed: true })) {
      fireEvent.click(btn);
    }
    // ...then re-select in reverse display order.
    const labels = ['Pet & house-sitting', 'IT help', 'Ikea assembly'];
    for (const label of labels) {
      fireEvent.click(screen.getByRole('button', { name: label }));
    }
    fireEvent.click(submitBtn());
    expect(onNext).toHaveBeenCalledTimes(1);
    // Display order, not click order.
    expect(onNext.mock.calls[0]![0].categories).toEqual(['ikea', 'it', 'pet_house']);
  });

  it('empty selection is allowed (explicit no-digests state) with the hint shown', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepDoerDetails onNext={onNext} loading={false} error={null} />);
    for (const btn of screen.getAllByRole('button', { pressed: true })) {
      fireEvent.click(btn);
    }
    expect(screen.getByText('With no category selected you will get no new-task digests.')).toBeTruthy();
    expect(submitBtn().disabled).toBe(false);
    fireEvent.click(submitBtn());
    expect(onNext.mock.calls[0]![0].categories).toEqual([]);
  });

  it('onBack hands back the current draft (preserved across back-navigation)', () => {
    const onBack = vi.fn();
    renderWithProviders(<StepDoerDetails onNext={vi.fn()} loading={false} error={null} onBack={onBack} />);
    fireEvent.change(screen.getByLabelText('About me'), { target: { value: 'Handy.' } });
    fireEvent.click(screen.getByRole('button', { name: 'I have a bike' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledWith(
      expect.objectContaining({ bio: 'Handy.', hasBike: true }),
    );
  });
});
