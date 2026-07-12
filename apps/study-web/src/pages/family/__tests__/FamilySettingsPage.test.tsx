import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The settings page loads families/{id} +
// its kids subcollection, then writes family fields via updateDoc and syncs
// kids via addDoc / updateDoc / deleteDoc.
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as unknown,
  },
  familyData: null as Record<string, unknown> | null,
  kids: [] as { id: string; data: Record<string, unknown> }[],
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  updateDoc: vi.fn(() => Promise.resolve()),
  addDoc: vi.fn(() => Promise.resolve({ id: 'newkid' })),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
  getDocs: (...args: unknown[]) => h.getDocs(...args),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  addDoc: (...args: unknown[]) => h.addDoc(...args),
  deleteDoc: (...args: unknown[]) => h.deleteDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { FamilySettingsPage } from '../FamilySettingsPage';

function reset() {
  h.auth.userDoc = {
    uid: 'p1',
    profiles: { parent: { enrollmentComplete: true, familyId: 'fam1' } },
  };
  h.familyData = { familyName: 'Cohen', address: '1 Rue de Paris', latLng: { lat: 48, lng: 2 } };
  h.kids = [];
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.familyData != null, data: () => h.familyData }),
  );
  h.getDocs.mockImplementation(() =>
    Promise.resolve({ docs: h.kids.map((k) => ({ id: k.id, data: () => k.data })) }),
  );
  h.updateDoc.mockClear();
  h.addDoc.mockClear();
  h.deleteDoc.mockClear();
}

describe('family FamilySettingsPage', () => {
  beforeEach(() => reset());

  it('loads and renders the family name and address', async () => {
    renderWithProviders(<FamilySettingsPage />);
    const nameInput = (await screen.findByLabelText(/family name/i)) as HTMLInputElement;
    expect(nameInput.value).toBe('Cohen');
    expect(screen.getByDisplayValue('1 Rue de Paris')).toBeInTheDocument();
  });

  it('saves the family name/address to families/{id}', async () => {
    renderWithProviders(<FamilySettingsPage />);
    const nameInput = (await screen.findByLabelText(/family name/i)) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Levy' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/fam1' }),
        expect.objectContaining({ familyName: 'Levy', updatedAt: 'ts' }),
      ),
    );
  });

  it('adds a new child to families/{id}/kids on save', async () => {
    renderWithProviders(<FamilySettingsPage />);
    await screen.findByLabelText(/family name/i);

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Noa' } });
    fireEvent.change(screen.getByLabelText(/^age$/i), { target: { value: '7' } });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.addDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/fam1/kids' }),
        expect.objectContaining({ firstName: 'Noa', age: 7 }),
      ),
    );
  });
});
