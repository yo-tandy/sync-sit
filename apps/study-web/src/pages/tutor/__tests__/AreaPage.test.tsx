import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { AddressResult } from '@ejm/shared-ui';

// Stub AddressAutocomplete like StepPrefs.test.tsx does: "pick-address" fires
// onChange with a fixed geocoded result; "type-without-picking" fires
// onChange(null), which is exactly what the real component does when the user
// edits the text without selecting a suggestion (see AddressAutocomplete's
// handleInputChange) — the behavior the no-fake-coordinates pin rides on.
const PICKED = {
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
        <span data-testid="address-value">{value?.fullAddress ?? ''}</span>
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

const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { AreaPage } from '../AreaPage';

// The five dot-paths every save writes (both modes, irrelevant ones nulled the
// way enrollTutor stores them: `?? null`, arrondissements `?? []`) + updatedAt.
const AREA_KEYS = [
  'profiles.tutor.areaAddress',
  'profiles.tutor.areaLatLng',
  'profiles.tutor.areaMode',
  'profiles.tutor.areaRadiusKm',
  'profiles.tutor.arrondissements',
  'updatedAt',
];

function makeUserDoc(area: Record<string, unknown>) {
  return {
    uid: 't1',
    email: 'login@ejm.org',
    firstName: 'Alice',
    lastName: 'Martin',
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'alice.martin24@ejm.org',
        classLevel: 'Terminale',
        ...area,
      },
    },
  };
}

function seed(area: Record<string, unknown>) {
  h.auth.userDoc = makeUserDoc(area);
}

function savedPayload(): Record<string, unknown> {
  const call = h.updateDoc.mock.calls[0] as unknown[];
  expect(call[0]).toEqual(expect.objectContaining({ path: 'users/t1' }));
  return call[1] as Record<string, unknown>;
}

describe('tutor AreaPage', () => {
  beforeEach(() => {
    h.auth.firebaseUser = { uid: 't1' };
    h.auth.userDoc = null;
    h.auth.refreshUserDoc.mockClear();
    h.updateDoc.mockClear();
  });

  it('seeds arrondissement mode from the stored profile', () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    expect(screen.getByRole('button', { name: /by arrondissement/i, pressed: true })).toBeInTheDocument();
    expect((screen.getByLabelText(/arrondissement/i) as HTMLInputElement).value).toBe('75016');
  });

  it('seeds distance mode with the stored address and radius', () => {
    seed({
      areaMode: 'distance',
      arrondissements: [],
      areaAddress: '16 rue de Passy, 75016 Paris',
      areaLatLng: { lat: 48.8571, lng: 2.2795 },
      areaRadiusKm: 5,
    });
    renderWithProviders(<AreaPage />);

    expect(screen.getByRole('button', { name: /by distance/i, pressed: true })).toBeInTheDocument();
    expect(screen.getByTestId('address-value').textContent).toBe('16 rue de Passy, 75016 Paris');
    expect((screen.getByLabelText(/max distance/i) as HTMLInputElement).value).toBe('5');
    // A doc WITH coordinates shows no missing-location warning.
    expect(screen.queryByText(/distance unknown/i)).not.toBeInTheDocument();
  });

  // ── The acceptance case: legacy pre-fix enrollee, distance mode, NO coords ──
  it('legacy no-coordinates doc: shows the honest note, and picking an address saves real coordinates', async () => {
    seed({ areaMode: 'distance', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    // Honest state: the tutor learns WHY they're invisible in distance sort.
    expect(screen.getByText(/distance unknown/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /pick-address/i }));
    // Note clears once coordinates exist.
    expect(screen.queryByText(/distance unknown/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());

    const payload = savedPayload();
    expect(Object.keys(payload).sort()).toEqual(AREA_KEYS);
    expect(payload['profiles.tutor.areaMode']).toBe('distance');
    expect(payload['profiles.tutor.areaAddress']).toBe('16 rue de Passy, 75016 Paris');
    expect(payload['profiles.tutor.areaLatLng']).toEqual({ lat: 48.8571, lng: 2.2795 });
    expect(payload['profiles.tutor.arrondissements']).toEqual([]);
    expect(payload['profiles.tutor.areaRadiusKm']).toBeNull();
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  // ── The no-fake-coordinates pin ──
  it('typing without picking blocks save on a no-coordinates doc (never fakes areaLatLng)', async () => {
    seed({ areaMode: 'distance', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /type-without-picking/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(await screen.findByText(/pick an address from the suggestions/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('typing without picking after a stored address clears it and blocks save (no stale coords written)', async () => {
    seed({
      areaMode: 'distance',
      arrondissements: [],
      areaAddress: '16 rue de Passy, 75016 Paris',
      areaLatLng: { lat: 48.8571, lng: 2.2795 },
      areaRadiusKm: null,
    });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /type-without-picking/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(await screen.findByText(/pick an address from the suggestions/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  // ── Mode-switch clearing pins (must match enrollTutor's stored shape) ──
  it('switching distance → arrondissement nulls the distance fields exactly like enrollment', async () => {
    seed({
      areaMode: 'distance',
      arrondissements: [],
      areaAddress: '16 rue de Passy, 75016 Paris',
      areaLatLng: { lat: 48.8571, lng: 2.2795 },
      areaRadiusKm: 5,
    });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /by arrondissement/i }));
    fireEvent.change(screen.getByLabelText(/arrondissement/i), { target: { value: '75017, 75016' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = savedPayload();
    expect(Object.keys(payload).sort()).toEqual(AREA_KEYS);
    expect(payload['profiles.tutor.areaMode']).toBe('arrondissement');
    expect(payload['profiles.tutor.arrondissements']).toEqual(['75017', '75016']);
    expect(payload['profiles.tutor.areaAddress']).toBeNull();
    expect(payload['profiles.tutor.areaLatLng']).toBeNull();
    expect(payload['profiles.tutor.areaRadiusKm']).toBeNull();
  });

  it('switching arrondissement → distance empties arrondissements and writes the pick + radius', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /by distance/i }));
    fireEvent.click(screen.getByRole('button', { name: /pick-address/i }));
    fireEvent.change(screen.getByLabelText(/max distance/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = savedPayload();
    expect(Object.keys(payload).sort()).toEqual(AREA_KEYS);
    expect(payload['profiles.tutor.areaMode']).toBe('distance');
    expect(payload['profiles.tutor.arrondissements']).toEqual([]);
    expect(payload['profiles.tutor.areaAddress']).toBe('16 rue de Passy, 75016 Paris');
    expect(payload['profiles.tutor.areaLatLng']).toEqual({ lat: 48.8571, lng: 2.2795 });
    expect(payload['profiles.tutor.areaRadiusKm']).toBe(8); // NUMBER, not '8'
  });

  it('rejects an out-of-range radius before any write (UX guard; rules carry the bound)', async () => {
    seed({ areaMode: 'distance', areaAddress: '5 Rue X', areaLatLng: { lat: 48.85, lng: 2.35 }, areaRadiusKm: 8 });
    renderWithProviders(<AreaPage />);
    const radius = await screen.findByLabelText(/max distance/i);
    fireEvent.change(radius, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/between 0 and 50/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects more than 20 arrondissements before any write', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'] });
    renderWithProviders(<AreaPage />);
    const input = await screen.findByLabelText(/arrondissement/i);
    fireEvent.change(input, { target: { value: Array.from({ length: 21 }, (_, i) => `750${String(i).padStart(2, '0')}`).join(', ') } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/up to 20/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an over-long arrondissement entry before any write', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'] });
    renderWithProviders(<AreaPage />);
    const input = await screen.findByLabelText(/arrondissement/i);
    fireEvent.change(input, { target: { value: 'not-an-arrondissement-code' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/up to 20/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('surfaces a save failure instead of a silent success', async () => {
    seed({ areaMode: 'distance', areaAddress: '5 Rue X', areaLatLng: { lat: 48.85, lng: 2.35 }, areaRadiusKm: 8 });
    h.updateDoc.mockRejectedValueOnce(new Error('unavailable'));
    renderWithProviders(<AreaPage />);
    await screen.findByLabelText(/max distance/i);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/error|erreur|wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
