import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { AddressResult } from '@ejm/shared-ui';

// Stub AddressAutocomplete: "pick-address" fires
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

  it('seeds arrondissement mode from the stored profile with the stored areas checked', () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['16e', 'Vincennes'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    expect(screen.getByRole('button', { name: /by arrondissement/i, pressed: true })).toBeInTheDocument();
    // Chip prefixes its label with a check mark when selected.
    expect(screen.getByRole('button', { name: '✓ 16e' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✓ Vincennes' })).toBeInTheDocument();
    // Unselected entries render without the mark.
    expect(screen.getByRole('button', { name: '15e' })).toBeInTheDocument();
  });

  it('renders the full sit-style grid: all 20 arrondissements and every nearby town', () => {
    seed({ areaMode: 'arrondissement', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    for (const arr of ['1er', '2e', '10e', '20e']) {
      expect(screen.getByRole('button', { name: arr })).toBeInTheDocument();
    }
    for (const town of ['Boulogne-Billancourt', 'Suresnes', 'Saint-Mandé']) {
      expect(screen.getByRole('button', { name: town })).toBeInTheDocument();
    }
    // A clean doc renders no legacy "Other saved areas" group at all.
    expect(screen.queryByText(/other saved areas/i)).not.toBeInTheDocument();
  });

  // ── Migration: free-text-era postcodes canonicalize onto their chips ──
  it("seeds a legacy postcode ('75016') onto the canonical 16e chip and saves canonical values", async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    // The canonical chip is checked; no legacy group — the postcode mapped.
    expect(screen.getByRole('button', { name: '✓ 16e' })).toBeInTheDocument();
    expect(screen.queryByText(/other saved areas/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /75016/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    // The save migrates the doc to the canonical vocabulary.
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual(['16e']);
  });

  it('dedupes a doc holding both the postcode and its canonical label', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016', '16e'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    expect(screen.getByRole('button', { name: '✓ 16e' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual(['16e']);
  });

  it('renders UNMAPPABLE stored values as checked extra chips and keeps them across a save', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['Clamart', '16e'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    expect(screen.getByText(/other saved areas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '✓ Clamart' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = savedPayload();
    // The unmappable value is NOT silently dropped by the grid rewrite.
    expect(payload['profiles.tutor.arrondissements']).toEqual(['Clamart', '16e']);
  });

  it('lets the tutor explicitly uncheck an unmappable legacy value, removing it from the save', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['Clamart', '16e'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: '✓ Clamart' }));
    // Still visible (derived from the stored doc), just unchecked.
    expect(screen.getByRole('button', { name: 'Clamart' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual(['16e']);
  });

  // ── Requirement gate (issue #167): in-person-at-family prefs need an area ──
  it('blocks an empty-area save for a family_home tutor with the requirement error', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null, locationPrefs: ['online', 'family_home'] });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(await screen.findByText(/pick at least one area/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks a library tutor in distance mode with no address, with the requirement error', async () => {
    seed({ areaMode: 'distance', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null, locationPrefs: ['library'] });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(await screen.findByText(/pick at least one area/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks a family_home tutor whose ONLY selection is an unmappable legacy value', async () => {
    // 'Clamart' is outside the vocabulary: it renders as a checked legacy
    // chip and survives saves, but no family address can ever resolve to it,
    // so it must not satisfy the coverage requirement.
    seed({ areaMode: 'arrondissement', arrondissements: ['Clamart'], areaAddress: null, areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    expect(await screen.findByText(/pick at least one area/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();

    // Adding one matchable area unblocks; the legacy chip is still preserved.
    fireEvent.click(screen.getByRole('button', { name: '5e' }));
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual(['Clamart', '5e']);
  });

  it('lets an online-only tutor save an empty area', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null, locationPrefs: ['online', 'tutor_home'] });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual([]);
    expect(screen.queryByText(/pick at least one area/i)).not.toBeInTheDocument();
  });

  it('unblocks the family_home tutor once an area is checked', async () => {
    seed({ areaMode: 'arrondissement', arrondissements: [], areaAddress: null, areaLatLng: null, areaRadiusKm: null, locationPrefs: ['family_home'] });
    renderWithProviders(<AreaPage />);

    fireEvent.click(screen.getByRole('button', { name: '5e' }));
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    expect(savedPayload()['profiles.tutor.arrondissements']).toEqual(['5e']);
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
    fireEvent.click(screen.getByRole('button', { name: '17e' }));
    fireEvent.click(screen.getByRole('button', { name: '16e' }));
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = savedPayload();
    expect(Object.keys(payload).sort()).toEqual(AREA_KEYS);
    expect(payload['profiles.tutor.areaMode']).toBe('arrondissement');
    expect(payload['profiles.tutor.arrondissements']).toEqual(['17e', '16e']);
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

    expect(await screen.findByText(/between 1 and 50/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects radius 0 — it would exclude the tutor from every distance search', async () => {
    // searchTutors caps at min(tutor radius, family filter), so 0 matches
    // nothing; empty already means the 5 km default. The editor floors at 1.
    seed({ areaMode: 'distance', areaAddress: '5 Rue X', areaLatLng: { lat: 48.85, lng: 2.35 }, areaRadiusKm: 8 });
    renderWithProviders(<AreaPage />);
    const radius = await screen.findByLabelText(/max distance/i);
    fireEvent.change(radius, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/between 1 and 50/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  // ── Mode-switch warning pins ──
  it('warns before an arrondissement-mode save discards a stored geocode', () => {
    seed({
      areaMode: 'distance',
      arrondissements: [],
      areaAddress: '16 rue de Passy, 75016 Paris',
      areaLatLng: { lat: 48.8571, lng: 2.2795 },
      areaRadiusKm: 5,
    });
    renderWithProviders(<AreaPage />);

    // Still in distance mode: no warning.
    expect(screen.queryByText(/removes your stored address location/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /by arrondissement/i }));
    expect(screen.getByText(/removes your stored address location/i)).toBeInTheDocument();
  });

  it('shows no mode-switch warning when there is no stored geocode to lose', () => {
    seed({ areaMode: 'arrondissement', arrondissements: ['75016'], areaAddress: null, areaLatLng: null, areaRadiusKm: null });
    renderWithProviders(<AreaPage />);

    expect(screen.getByRole('button', { name: /by arrondissement/i, pressed: true })).toBeInTheDocument();
    expect(screen.queryByText(/removes your stored address location/i)).not.toBeInTheDocument();
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
