import { describe, it, expect, beforeAll, vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { StepSubjects } from '../StepSubjects';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

function row(index = 0): HTMLElement {
  return screen.getAllByTestId('subject-row')[index];
}

// Query by role, not label: the shared Select/Input derive ids from their
// label text, so with several rows the ids collide and label association
// breaks for every row but the first.
function fillRow(index: number, subject: string, level: string, rate: string) {
  const r = row(index);
  fireEvent.change(within(r).getByRole('combobox'), { target: { value: subject } });
  fireEvent.click(within(r).getByText(level));
  fireEvent.change(within(r).getByRole('spinbutton'), { target: { value: rate } });
}

describe('StepSubjects (tutor enrollment)', () => {
  it('starts with one empty row and blocks continue until it is valid', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    expect(screen.getAllByTestId('subject-row')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByText(i18n.t('tutor.subjects.errorNoSubject'))).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('requires at least one subject row (zero rows disables continue)', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    fireEvent.click(within(row()).getByRole('button', { name: /Remove/i }));

    expect(screen.queryAllByTestId('subject-row')).toHaveLength(0);
    expect(screen.getByText(i18n.t('enrollment.subjectsEmpty'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeDisabled();
  });

  it('submits the offerings payload when the row is valid', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    fillRow(0, 'math', 'Terminale', '25');
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith([{ subject: 'math', levels: ['Terminale'], rate: 25 }]);
  });

  it('rejects a row without levels and a non-positive rate', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    const r = row();
    fireEvent.change(within(r).getByRole('combobox'), { target: { value: 'math' } });
    fireEvent.change(within(r).getByRole('spinbutton'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByText(i18n.t('tutor.subjects.errorNoLevels'))).toBeInTheDocument();

    fireEvent.click(within(r).getByText('Terminale'));
    fireEvent.change(within(r).getByLabelText(/Rate/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(screen.getByText(i18n.t('tutor.subjects.errorRate'))).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('rows get unique control ids so labels focus their own row', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: /Add a subject/i }));
    const selects = screen.getAllByLabelText(/subject/i);
    const ids = selects.map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).not.toBe('');
  });

  it('rejects duplicate subjects across rows', () => {
    const onNext = vi.fn();
    renderWithProviders(<StepSubjects onNext={onNext} />);
    fillRow(0, 'math', 'Terminale', '25');
    fireEvent.click(screen.getByRole('button', { name: /Add a subject/i }));
    fillRow(1, 'math', '1ere', '30');
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(screen.getByText(i18n.t('tutor.subjects.errorDuplicate'))).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });
});
