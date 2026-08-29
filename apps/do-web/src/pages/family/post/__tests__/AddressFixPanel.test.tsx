import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The one client-side Firestore WRITE in PR7 — its payload is pinned
 * exactly, because it must stay inside the family-doc update rule's
 * `hasOnly([...])` allow-list: one extra convenience field here (say
 * `areaLabel`) turns every save into a runtime PERMISSION_DENIED with
 * nothing in the suite going red (PR #331 round 1).
 */

// The `doc` mock below collapses a Firestore reference to just its path, so
// `{ docPath: string }` is the reference type `updateDoc` actually receives.
const h = vi.hoisted(() => ({
  updateDoc: vi.fn<(ref: { docPath: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ docPath: path.join('/') }),
  updateDoc: (...args: [ref: { docPath: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

import { AddressFixPanel } from '../AddressFixPanel';

/** One api-adresse.data.gouv.fr feature, the shape AddressAutocomplete
 * consumes. */
const FEATURE = {
  properties: {
    label: '1 Rue de la Paix 75002 Paris',
    name: '1 Rue de la Paix',
    city: 'Paris',
    postcode: '75002',
    context: '75, Paris, Île-de-France',
  },
  geometry: { coordinates: [2.3317, 48.8687] }, // [lng, lat]
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ features: [FEATURE] }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function pickAddress() {
  fireEvent.change(screen.getByPlaceholderText('Start typing an address...'), {
    target: { value: '1 Rue de la Paix' },
  });
  // AddressAutocomplete debounces 300ms before fetching; the suggestion row
  // renders name + "postcode city" (not the full label).
  await waitFor(() => expect(screen.getByText('75002 Paris')).toBeInTheDocument());
  fireEvent.click(screen.getByText('75002 Paris'));
}

describe('AddressFixPanel (decision-17 in-wizard save)', () => {
  it('writes EXACTLY the allow-listed family-doc fields — nothing else', async () => {
    renderWithProviders(<AddressFixPanel familyId="fam1" onSaved={vi.fn()} onBack={vi.fn()} />);
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1));
    const [ref, payload] = h.updateDoc.mock.calls[0];
    expect(ref).toEqual({ docPath: 'families/fam1' });
    // Exact field set: inside firestore.rules' hasOnly allow-list, with the
    // lat/lng order right ([lng, lat] on the wire → {lat, lng} stored) and
    // the postcode/city shape the rules also check.
    expect(payload).toEqual({
      address: '1 Rue de la Paix 75002 Paris',
      latLng: { lat: 48.8687, lng: 2.3317 },
      postcode: '75002',
      city: 'Paris',
      updatedAt: { __serverTimestamp: true },
    });
  });

  it('an out-of-coverage address SAVES but shows the honest no-area copy and does NOT return to review', async () => {
    // resolveAreaLabel (the same check doPostTask runs) resolves nothing
    // for a non-750xx postcode outside NEARBY_TOWNS — "you can publish
    // now" would send the family into the address_required loop with no
    // exit (PR #331 round 2).
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve({
            features: [
              {
                properties: {
                  label: '3 Rue Grande 77300 Fontainebleau',
                  name: '3 Rue Grande',
                  city: 'Fontainebleau',
                  postcode: '77300',
                  context: '77, Seine-et-Marne',
                },
                geometry: { coordinates: [2.7016, 48.4046] },
              },
            ],
          }),
      }),
    );
    const onSaved = vi.fn();
    renderWithProviders(<AddressFixPanel familyId="fam1" onSaved={onSaved} onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Start typing an address...'), {
      target: { value: '3 Rue Grande' },
    });
    await waitFor(() => expect(screen.getByText('77300 Fontainebleau')).toBeInTheDocument());
    fireEvent.click(screen.getByText('77300 Fontainebleau'));
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    // The address IS saved — it is their real address...
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalledTimes(1));
    // ...but the panel states the coverage truth instead of returning to
    // review with "you can publish now".
    await waitFor(() =>
      expect(screen.getByText(/outside the area Sync\/Do currently covers/)).toBeInTheDocument(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('signals onSaved after a successful save, and disables Save with no pick', async () => {
    const onSaved = vi.fn();
    renderWithProviders(<AddressFixPanel familyId="fam1" onSaved={onSaved} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save address' })).toBeDisabled();
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('shows the save-error copy on a failed write and stays on the panel', async () => {
    h.updateDoc.mockRejectedValueOnce(new Error('denied'));
    renderWithProviders(<AddressFixPanel familyId="fam1" onSaved={vi.fn()} onBack={vi.fn()} />);
    await pickAddress();
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not save the address/)).toBeInTheDocument(),
    );
  });
});
