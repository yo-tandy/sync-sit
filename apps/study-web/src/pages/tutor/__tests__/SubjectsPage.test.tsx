import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The subjects editor reads the auth store
// for the tutor profile (initial offerings) and writes back via updateDoc.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SubjectsPage } from '../SubjectsPage';

type Offering = { subject: string; levels: string[]; rate: number };

function makeUserDoc(subjects: Offering[]) {
  return { uid: 't1', profiles: { tutor: { enrollmentComplete: true, subjects } } };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = makeUserDoc([]);
  h.auth.refreshUserDoc.mockClear();
  h.updateDoc.mockClear();
}

const rows = () => screen.queryAllByTestId('subject-row');
const saveBtn = () => screen.getByRole('button', { name: 'Save' });
const addBtn = () => screen.getByRole('button', { name: /add a subject/i });

function fillRow(index: number, opts: { subject?: string; level?: string; rate?: number }) {
  const row = rows()[index];
  if (opts.subject) fireEvent.change(within(row).getByRole('combobox'), { target: { value: opts.subject } });
  if (opts.level) fireEvent.click(within(rows()[index]).getByRole('button', { name: opts.level }));
  if (opts.rate !== undefined)
    fireEvent.change(within(rows()[index]).getByRole('spinbutton'), { target: { value: String(opts.rate) } });
}

describe('tutor SubjectsPage', () => {
  beforeEach(() => reset());

  it('starts from the stored offerings', () => {
    h.auth.userDoc = makeUserDoc([{ subject: 'math', levels: ['6e'], rate: 20 }]);
    renderWithProviders(<SubjectsPage />);
    expect(rows()).toHaveLength(1);
  });

  it('adds a row', () => {
    renderWithProviders(<SubjectsPage />);
    expect(rows()).toHaveLength(0);
    fireEvent.click(addBtn());
    expect(rows()).toHaveLength(1);
  });

  it('removes a row', () => {
    h.auth.userDoc = makeUserDoc([
      { subject: 'math', levels: ['6e'], rate: 20 },
      { subject: 'french', levels: ['5e'], rate: 25 },
    ]);
    renderWithProviders(<SubjectsPage />);
    expect(rows()).toHaveLength(2);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /remove/i }));
    expect(rows()).toHaveLength(1);
  });

  it('blocks save when two rows share a subject', async () => {
    renderWithProviders(<SubjectsPage />);
    fireEvent.click(addBtn());
    fireEvent.click(addBtn());
    fillRow(0, { subject: 'math', level: '6e', rate: 20 });
    fillRow(1, { subject: 'math', level: '5e', rate: 25 });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/each subject can only be added once/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks save when a row has no class levels', async () => {
    renderWithProviders(<SubjectsPage />);
    fireEvent.click(addBtn());
    fillRow(0, { subject: 'math', rate: 20 });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/select at least one class level/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks save when a rate is not greater than zero', async () => {
    renderWithProviders(<SubjectsPage />);
    fireEvent.click(addBtn());
    fillRow(0, { subject: 'math', level: '6e', rate: 0 });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/hourly rate greater than 0/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks save when a row has no subject selected', async () => {
    renderWithProviders(<SubjectsPage />);
    fireEvent.click(addBtn());
    fillRow(0, { level: '6e', rate: 20 });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/choose a subject/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('saves valid offerings and refreshes the user doc', async () => {
    renderWithProviders(<SubjectsPage />);
    fireEvent.click(addBtn());
    fillRow(0, { subject: 'math', level: '6e', rate: 25 });
    fireEvent.click(saveBtn());

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.subjects': [{ subject: 'math', levels: ['6e'], rate: 25 }],
          updatedAt: 'ts',
        }),
      ),
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
    // Save confirmation is the shared toast idiom (role=status), not an inline banner.
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i);
  });
});
