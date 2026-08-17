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

// Stub AddressAutocomplete: an input mirroring the value (keeps the
// display-value assertions), a deterministic geocoded pick, and a
// type-without-picking action that fires onChange(null) exactly like the real
// component does on manual edits — the stale-postcode-clearing pin rides on it.
import type { AddressResult } from '@ejm/shared-ui';
const PICKED: AddressResult = {
  fullAddress: '16 rue de Passy, 75016 Paris',
  street: '16 rue de Passy',
  city: 'Paris',
  postcode: '75016',
  lat: 48.8571,
  lng: 2.2795,
};
vi.mock('@ejm/shared-ui', async (importActual) => {
  const actual = await importActual<typeof import('@ejm/shared-ui')>();
  return {
    ...actual,
    AddressAutocomplete: ({
      value,
      onChange,
    }: {
      value: AddressResult | null;
      onChange: (a: AddressResult | null) => void;
    }) => (
      <div>
        <input aria-label="address" readOnly value={value?.fullAddress ?? ''} />
        <button type="button" onClick={() => onChange(PICKED)}>
          pick-address
        </button>
        <button type="button" onClick={() => onChange(null)}>
          type-without-picking
        </button>
      </div>
    ),
  };
});

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

  // ── Postcode/city persistence (issue #167) ──

  it('saves postcode and city from an autocomplete pick alongside address/latLng', async () => {
    renderWithProviders(<FamilySettingsPage />);
    await screen.findByLabelText(/family name/i);
    fireEvent.click(screen.getByRole('button', { name: /pick-address/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/fam1' }),
        expect.objectContaining({
          address: '16 rue de Passy, 75016 Paris',
          latLng: { lat: 48.8571, lng: 2.2795 },
          postcode: '75016',
          city: 'Paris',
        }),
      ),
    );
  });

  it('clears stored postcode/city when the address is edited without a pick (no stale geocode)', async () => {
    h.familyData = {
      familyName: 'Cohen',
      address: '1 Rue de Paris',
      latLng: { lat: 48, lng: 2 },
      postcode: '75001',
      city: 'Paris',
    };
    renderWithProviders(<FamilySettingsPage />);
    await screen.findByLabelText(/family name/i);
    fireEvent.click(screen.getByRole('button', { name: /type-without-picking/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/fam1' }),
        expect.objectContaining({ postcode: null, city: null, latLng: null }),
      ),
    );
  });

  it('updating an existing kid does NOT write the languages key (preserves cross-app data)', async () => {
    h.kids = [{ id: 'kid1', data: { firstName: 'Existing', age: 5, languages: ['en', 'fr'] } }];
    renderWithProviders(<FamilySettingsPage />);
    await screen.findByLabelText(/family name/i);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(
        h.updateDoc.mock.calls.some((c) => (c[0] as { path: string }).path === 'families/fam1/kids/kid1'),
      ).toBe(true),
    );
    const kidCall = h.updateDoc.mock.calls.find(
      (c) => (c[0] as { path: string }).path === 'families/fam1/kids/kid1',
    )!;
    expect(kidCall[1]).not.toHaveProperty('languages');
    expect(kidCall[1]).toMatchObject({ firstName: 'Existing', age: 5 });
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
