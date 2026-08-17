import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable state. The account page reads the auth store for
// identity (read-only) and contact (editable) fields and writes contact +
// notifPrefs back via updateDoc; password reset goes through resetPassword.
const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 't1' } as { uid: string } | null,
    userDoc: null as unknown,
    refreshUserDoc: vi.fn(() => Promise.resolve()),
    resetPassword: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn(() => Promise.resolve()),
  uploadBytes: vi.fn(() => Promise.resolve()),
  getDownloadURL: vi.fn(() => Promise.resolve('https://cdn.example/photo.png')),
  deleteObject: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/config/firebase', () => ({ db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytes: (...args: unknown[]) => h.uploadBytes(...args),
  deleteObject: (...args: unknown[]) => h.deleteObject(...args),
  getDownloadURL: (...args: unknown[]) => h.getDownloadURL(...args),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import { AccountPage } from '../AccountPage';

function makeUserDoc() {
  return {
    uid: 't1',
    email: 'login@ejm.org',
    firstName: 'Alice',
    lastName: 'Martin',
    dateOfBirth: '2008-05-01',
    notifPrefs: {
      newRequest: { push: true, email: true },
      confirmed: { push: true, email: true },
      cancelled: { push: true, email: true },
      reminders: { push: true, email: false },
    },
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'alice.martin24@ejm.org',
        classLevel: 'Terminale',
        contactEmail: 'old@example.com',
        contactPhone: '+33 600000000',
        whatsapp: '+33 600000000',
      },
    },
  };
}

function reset() {
  h.auth.firebaseUser = { uid: 't1' };
  h.auth.userDoc = makeUserDoc();
  h.auth.refreshUserDoc.mockClear();
  h.auth.resetPassword.mockClear();
  h.updateDoc.mockClear();
  h.uploadBytes.mockClear();
  h.getDownloadURL.mockClear();
  h.deleteObject.mockClear();
}

describe('tutor AccountPage', () => {
  beforeEach(() => reset());

  it('renders the read-only identity fields', () => {
    renderWithProviders(<AccountPage />);
    // Name, EJM email and class level come straight from the doc (read-only).
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Martin')).toBeInTheDocument();
    expect(screen.getByText('alice.martin24@ejm.org')).toBeInTheDocument();
    expect(screen.getByText('Terminale')).toBeInTheDocument();
    expect(screen.getByText('login@ejm.org')).toBeInTheDocument();
  });

  it('saves contact info to the nested tutor fields', async () => {
    renderWithProviders(<AccountPage />);
    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    expect(emailInput.value).toBe('old@example.com');
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save contact/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.contactEmail': 'new@example.com',
          'profiles.tutor.contactPhone': '+33 600000000',
          'profiles.tutor.whatsapp': '+33 600000000',
          updatedAt: 'ts',
        }),
      ),
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('sends a password reset email to the login address', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: /password reset/i }));
    await waitFor(() =>
      expect(h.auth.resetPassword).toHaveBeenCalledWith('login@ejm.org'),
    );
  });

  // ── Profile photo (issue #143 — same mechanism as sit) ──

  it('uploads a picked photo to profile-photos/{uid} and saves the top-level photoUrl', async () => {
    renderWithProviders(<AccountPage />);
    const input = screen.getByTestId('photo-input');
    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalled());
    // Storage path is uid-keyed — the owner-write gate in storage.rules.
    expect((h.uploadBytes.mock.calls[0][0] as { path: string }).path).toBe('profile-photos/t1.png');
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        // TOP-LEVEL photoUrl (like sit): the field searchTutors projects.
        expect.objectContaining({ photoUrl: 'https://cdn.example/photo.png', updatedAt: 'ts' }),
      ),
    );
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('rejects a non-image file without uploading', async () => {
    renderWithProviders(<AccountPage />);
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });

    expect(await screen.findByText(/select an image/i)).toBeInTheDocument();
    expect(h.uploadBytes).not.toHaveBeenCalled();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects an oversized file without uploading', async () => {
    renderWithProviders(<AccountPage />);
    const big = new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [big] } });

    expect(await screen.findByText(/under 5 MB/i)).toBeInTheDocument();
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });

  it('removes the photo by nulling the top-level photoUrl', async () => {
    const userDoc = makeUserDoc() as Record<string, unknown>;
    userDoc.photoUrl = 'https://cdn.example/old.png';
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({ photoUrl: null, updatedAt: 'ts' }),
      ),
    );
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });

  it('a photo save does NOT clobber unsaved edits elsewhere on the page', async () => {
    // refreshUserDoc replaces userDoc; re-seeding every field from it wiped
    // in-progress edits (typed bio reverts when picking a photo). The form
    // seeds once per mount; only the photo preview tracks refreshes.
    h.auth.refreshUserDoc.mockImplementation(() => {
      h.auth.userDoc = { ...(h.auth.userDoc as Record<string, unknown>), photoUrl: 'https://cdn.example/photo.png' };
      return Promise.resolve();
    });
    renderWithProviders(<AccountPage />);

    const bio = screen.getByLabelText(/about me/i);
    fireEvent.change(bio, { target: { value: 'draft bio not yet saved' } });

    const file = new File(['x'], 'me.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());

    expect(screen.getByLabelText(/about me/i)).toHaveValue('draft bio not yet saved');
  });

  it('a refresh blip AFTER a successful removal stays silent (the photo IS removed)', async () => {
    const userDoc = makeUserDoc() as Record<string, unknown>;
    userDoc.photoUrl = 'https://cdn.example/old.png';
    h.auth.userDoc = userDoc;
    h.auth.refreshUserDoc.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({ photoUrl: null }),
      ),
    );
    // No backwards error, and the stale thumbnail is gone.
    expect(screen.queryByText(/could not remove the photo/i)).toBeNull();
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });

  it('remove also deletes the storage object recovered from the download URL', async () => {
    const userDoc = makeUserDoc() as Record<string, unknown>;
    userDoc.photoUrl =
      'https://firebasestorage.example/v0/b/x/o/profile-photos%2Ft1.jpg?alt=media&token=abc';
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    await waitFor(() =>
      expect(h.deleteObject).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'profile-photos/t1.jpg' }),
      ),
    );
  });

  it('a failed removal shows an inline error and keeps showing the photo', async () => {
    const userDoc = makeUserDoc() as Record<string, unknown>;
    userDoc.photoUrl = 'https://cdn.example/old.png';
    h.auth.userDoc = userDoc;
    h.updateDoc.mockRejectedValueOnce(new Error('offline'));
    renderWithProviders(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    // Honest failure: the error names the consequence and the photo (still
    // live on the public card) is still rendered — not silently "removed".
    expect(await screen.findByText(/could not remove the photo/i)).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(h.deleteObject).not.toHaveBeenCalled();
  });

  it('a failed upload shows the inline photo error and reverts the preview', async () => {
    const userDoc = makeUserDoc() as Record<string, unknown>;
    userDoc.photoUrl = 'https://cdn.example/old.png';
    h.auth.userDoc = userDoc;
    h.uploadBytes.mockRejectedValueOnce(new Error('storage down'));
    renderWithProviders(<AccountPage />);

    const file = new File(['x'], 'new.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [file] } });

    expect(await screen.findByText(/failed to upload photo/i)).toBeInTheDocument();
    // The preview falls back to the STORED photo — the picked image did not save.
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('src', 'https://cdn.example/old.png'),
    );
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  // ── Cancellation policy (V2 feature 7) ──
  it('seeds the cancellation-policy selector from the stored value', () => {
    const userDoc = makeUserDoc();
    (userDoc.profiles.tutor as Record<string, unknown>).cancellationNoticeHours = 48;
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('48');
  });

  it('defaults the selector to 0 (no policy) when the field is absent', () => {
    renderWithProviders(<AccountPage />);
    const select = screen.getByLabelText(/cancellation policy/i) as HTMLSelectElement;
    expect(select.value).toBe('0');
  });

  it('saves the selected policy to the numeric dot-path and refreshes', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({
          'profiles.tutor.cancellationNoticeHours': 48,
          updatedAt: 'ts',
        }),
      ),
    );
    // The value is the NUMBER 48, never the string '48'.
    const call = h.updateDoc.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)['profiles.tutor.cancellationNoticeHours'] !== undefined,
    );
    expect(call?.[1]['profiles.tutor.cancellationNoticeHours']).toBe(48);
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('saves the 1-week (168) preset as its numeric value', async () => {
    renderWithProviders(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/cancellation policy/i), { target: { value: '168' } });
    fireEvent.click(screen.getByRole('button', { name: /save policy/i }));

    await waitFor(() =>
      expect(h.updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/t1' }),
        expect.objectContaining({ 'profiles.tutor.cancellationNoticeHours': 168 }),
      ),
    );
  });

  // ── Session preferences (issue #123 — un-freeze enrollment-only fields) ──

  function seedSessionPrefs() {
    const userDoc = makeUserDoc();
    Object.assign(userDoc.profiles.tutor as Record<string, unknown>, {
      sessionLengthsMin: [45, 60],
      locationPrefs: ['online', 'family_home'],
      paddingMin: 15,
    });
    h.auth.userDoc = userDoc;
  }

  it('seeds the session-preferences section from the stored profile', () => {
    seedSessionPrefs();
    renderWithProviders(<AccountPage />);

    expect(screen.getByRole('button', { name: '45 min', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '60 min', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 min', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '75 min', pressed: false })).toBeInTheDocument();

    expect(screen.getByLabelText('Online')).toBeChecked();
    expect(screen.getByLabelText("At the family's home")).toBeChecked();
    expect(screen.getByLabelText('At your home')).not.toBeChecked();
    expect(screen.getByLabelText('Library / public space')).not.toBeChecked();

    expect((screen.getByLabelText(/appointment padding/i) as HTMLInputElement).value).toBe('15');
  });

  it('renders the section without crashing when the fields are absent (legacy doc)', () => {
    renderWithProviders(<AccountPage />);
    expect(screen.getByRole('button', { name: '45 min', pressed: false })).toBeInTheDocument();
    expect(screen.getByLabelText('Online')).not.toBeChecked();
    expect((screen.getByLabelText(/appointment padding/i) as HTMLInputElement).value).toBe('0');
  });

  it('saves exactly the four dot-paths (+updatedAt) with the edited values', async () => {
    seedSessionPrefs();
    renderWithProviders(<AccountPage />);

    fireEvent.click(screen.getByRole('button', { name: '75 min' }));
    fireEvent.click(screen.getByLabelText('At your home'));
    fireEvent.change(screen.getByLabelText(/padding/i), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/about me/i), { target: { value: 'I teach maths.' } });
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const call = h.updateDoc.mock.calls[0] as unknown[];
    expect(call[0]).toEqual(expect.objectContaining({ path: 'users/t1' }));
    const payload = call[1] as Record<string, unknown>;
    // Pin the FULL key set: dot-paths only — never a wholesale profiles.tutor
    // rewrite (would clobber server-owned siblings like approvedFamilies).
    expect(Object.keys(payload).sort()).toEqual([
      'profiles.tutor.aboutMe',
      'profiles.tutor.locationPrefs',
      'profiles.tutor.paddingMin',
      'profiles.tutor.sessionLengthsMin',
      'updatedAt',
    ]);
    expect(payload['profiles.tutor.sessionLengthsMin']).toEqual([45, 60, 75]);
    expect(payload['profiles.tutor.locationPrefs']).toEqual(['online', 'family_home', 'tutor_home']);
    expect(payload['profiles.tutor.paddingMin']).toBe(30); // NUMBER, not '30'
    expect(payload['profiles.tutor.aboutMe']).toBe('I teach maths.');
    await waitFor(() => expect(h.auth.refreshUserDoc).toHaveBeenCalled());
  });

  it('saves an emptied about-me as null (not an empty string)', async () => {
    seedSessionPrefs();
    renderWithProviders(<AccountPage />);
    fireEvent.change(screen.getByLabelText(/about me/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(payload['profiles.tutor.aboutMe']).toBeNull();
  });

  it('blocks save when no session length is selected', async () => {
    seedSessionPrefs();
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: '45 min' }));
    fireEvent.click(screen.getByRole('button', { name: '60 min' }));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(await screen.findByText(/at least one session length/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('blocks save when no location is selected', async () => {
    seedSessionPrefs();
    renderWithProviders(<AccountPage />);
    fireEvent.click(screen.getByLabelText('Online'));
    fireEvent.click(screen.getByLabelText("At the family's home"));
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(await screen.findByText(/at least one session location/i)).toBeInTheDocument();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('links to the area editor so it is findable from Account', () => {
    renderWithProviders(<AccountPage />);
    const link = screen.getByRole('link', { name: /area you cover/i });
    expect(link).toHaveAttribute('href', '/tutor/area');
  });

  // ── Supervised-account indicator (governedBy mirror) ──

  it('shows the supervised-account indicator when governedBy is set', () => {
    h.auth.userDoc = {
      ...makeUserDoc(),
      governedBy: { familyId: 'fam1', linkedAt: { seconds: 1, nanoseconds: 0 } },
    };
    renderWithProviders(<AccountPage />);

    expect(screen.getByText(/supervised account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /what supervision means/i })).toHaveAttribute(
      'href',
      '/supervision-info',
    );
  });

  it('shows no supervised-account indicator without governedBy', () => {
    renderWithProviders(<AccountPage />);
    expect(screen.queryByText(/supervised account/i)).not.toBeInTheDocument();
  });

  it('surfaces a session-prefs save failure instead of a silent success', async () => {
    seedSessionPrefs();
    h.updateDoc.mockRejectedValueOnce(new Error('unavailable'));
    renderWithProviders(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^save preferences$/i }));

    expect(await screen.findByText(/error|wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
  });

  it('rejects out-of-range padding before any write (UX guard; rules carry the bound)', async () => {
    const userDoc = makeUserDoc();
    (userDoc.profiles.tutor as Record<string, unknown>).sessionLengthsMin = [45, 60];
    (userDoc.profiles.tutor as Record<string, unknown>).locationPrefs = ['online'];
    (userDoc.profiles.tutor as Record<string, unknown>).paddingMin = 15;
    h.auth.userDoc = userDoc;
    renderWithProviders(<AccountPage />);
    const padding = await screen.findByLabelText(/padding/i);
    fireEvent.change(padding, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /^save preferences$/i }));

    expect(await screen.findByText(/between 0 and 60/i)).toBeInTheDocument();
    const calls = h.updateDoc.mock.calls.filter((c) => JSON.stringify(c[1] ?? {}).includes('paddingMin'));
    expect(calls).toHaveLength(0);
  });
});
