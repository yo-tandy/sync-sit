import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// The card performs the ONLY client-side guardian Firestore read: a doc get of
// guardianLinks/{ownUid} (child-readable by rules). Responses go through the
// respondToSupervisionRequest callable.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'kid1' } as { uid: string } | null,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  linkData: null as Record<string, unknown> | null,
  getDoc: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => h.getDoc(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { SupervisionRequestCard } from '../SupervisionRequestCard';

function pendingClaim(overrides: Record<string, unknown> = {}) {
  return {
    childUid: 'kid1',
    familyId: 'fam1',
    createdByParentUid: 'p1',
    status: 'pending',
    origin: 'claim',
    ...overrides,
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 'kid1' };
  h.auth.refreshUserDoc.mockClear();
  h.linkData = null;
  h.getDoc.mockReset();
  h.getDoc.mockImplementation(() =>
    Promise.resolve({ exists: () => h.linkData != null, data: () => h.linkData }),
  );
  h.callable.mockReset();
  h.callable.mockResolvedValue({ data: { success: true } });
}

describe('SupervisionRequestCard', () => {
  beforeEach(() => reset());

  it('reads guardianLinks/{ownUid} (doc get) and renders nothing without a link doc', async () => {
    renderWithProviders(<SupervisionRequestCard />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());

    const ref = h.getDoc.mock.calls[0][0] as { path: string };
    expect(ref.path).toBe('guardianLinks/kid1');
    expect(screen.queryByText(/supervise your account/i)).not.toBeInTheDocument();
  });

  it('renders nothing for an active link or a parent_created pending link', async () => {
    h.linkData = pendingClaim({ status: 'active' });
    const { unmount } = renderWithProviders(<SupervisionRequestCard />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalled());
    expect(screen.queryByText(/supervise your account/i)).not.toBeInTheDocument();
    unmount();

    h.linkData = pendingClaim({ origin: 'parent_created' });
    renderWithProviders(<SupervisionRequestCard />);
    await waitFor(() => expect(h.getDoc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/supervise your account/i)).not.toBeInTheDocument();
  });

  it('renders the request with accept/decline for a pending claim', async () => {
    h.linkData = pendingClaim();
    renderWithProviders(<SupervisionRequestCard />);

    expect(await screen.findByText(/supervise your account/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /decline/i })).toBeInTheDocument();
    // Explains what supervision means before deciding.
    expect(screen.getByRole('link', { name: /what supervision means/i })).toHaveAttribute(
      'href',
      '/supervision-info',
    );
  });

  it('accept calls respondToSupervisionRequest {accept:true}, refetches and refreshes the user doc', async () => {
    h.linkData = pendingClaim();
    renderWithProviders(<SupervisionRequestCard />);

    fireEvent.click(await screen.findByRole('button', { name: /accept/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToSupervisionRequest', { accept: true }),
    );
    // Non-optimistic: the card re-reads the link doc and refreshes the user doc
    // (the governedBy mirror) only after the callable resolves.
    await waitFor(() => expect(h.getDoc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('decline confirms first (the parent is not told), then sends {accept:false}', async () => {
    h.linkData = pendingClaim();
    renderWithProviders(<SupervisionRequestCard />);

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    // Nothing sent before the confirmation.
    expect(h.callable).not.toHaveBeenCalled();
    expect(screen.getByText(/not notified/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToSupervisionRequest', { accept: false }),
    );
    await waitFor(() => expect(h.getDoc).toHaveBeenCalledTimes(2));
  });

  it('dismissing the decline confirmation sends nothing', async () => {
    h.linkData = pendingClaim();
    renderWithProviders(<SupervisionRequestCard />);

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(h.callable).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument();
  });
});
