import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Shared-identity pins (issue #203, PR #206 review): this step is an
// enrollment WRITER of the canonical root contact fields — it dual-writes
// root + nested like the server callables — and its resume-prefill effect
// must seed ONCE (the derived babysitter view is a fresh object per render,
// so an unguarded effect reverts every keystroke).
const h = vi.hoisted(() => ({
  auth: {
    userDoc: null as Record<string, unknown> | null,
    firebaseUser: { uid: 'bs1' },
    refreshUserDoc: vi.fn(() => Promise.resolve()),
  },
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve(),
  ),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  serverTimestamp: () => 'ts',
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => h.auth,
}));

import '@/i18n';
import { StepPreferences } from '../StepPreferences';

function renderStep() {
  return render(
    <MemoryRouter>
      <StepPreferences uid="bs1" onComplete={() => {}} />
    </MemoryRouter>,
  );
}

describe('StepPreferences shared-identity contact (issue #203)', () => {
  beforeEach(() => {
    h.auth.userDoc = {
      uid: 'bs1',
      firstName: 'Lea',
      lastName: 'Bernard',
      profiles: { babysitter: { ejemEmail: 'lea@ejm.org' } },
    };
    h.updateDoc.mockClear();
  });

  afterEach(() => cleanup());

  it('saving dual-writes contact to the ROOT and the nested copy', async () => {
    renderStep();
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: 'lea@contact.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload.contactEmail).toBe('lea@contact.com');
    expect(payload['profiles.babysitter.contactEmail']).toBe('lea@contact.com');
    // A channel the user NEVER supplied is omitted at the ROOT (presence
    // means set-or-cleared; a null would read as a deliberate clear and
    // block the nested fallback — PR #206 rounds 6-8). The nested copy keeps
    // its null convention.
    expect(payload).not.toHaveProperty('contactPhone');
    expect(payload['profiles.babysitter.contactPhone']).toBeNull();
  });

  it('CLEARING a channel that exists at the root writes an explicit null', async () => {
    h.auth.userDoc = {
      uid: 'bs1',
      contactEmail: 'old@x.com',
      profiles: { babysitter: { ejemEmail: 'lea@ejm.org', contactEmail: 'old@x.com' } },
    };
    renderStep();
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).toHaveProperty('contactEmail', null);
  });

  it('clearing a NESTED-seeded value (un-backfilled doc) still records the clear', async () => {
    // A tutor with only a nested contactEmail does a classic sit enrollment:
    // the prefill shows the nested value, so deleting it must write an
    // explicit root null. Keying "cleared" off root presence alone dropped
    // it, and getContact then resurrected the tutor copy (PR #206 review).
    h.auth.userDoc = {
      uid: 'bs1',
      profiles: {
        babysitter: { ejemEmail: 'lea@ejm.org' },
        tutor: { contactEmail: 'old@x.com' },
      },
    };
    renderStep();
    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    expect(email.value).toBe('old@x.com');
    fireEvent.change(email, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload).toHaveProperty('contactEmail', null);
    // A channel that was never shown stays absent at the root.
    expect(payload).not.toHaveProperty('contactPhone');
  });

  it('prefills contact from the canonical ROOT over a stale nested copy', () => {
    h.auth.userDoc = {
      uid: 'bs1',
      contactEmail: 'fresh@x.com',
      profiles: { babysitter: { ejemEmail: 'lea@ejm.org', contactEmail: 'stale@x.com' } },
    };
    renderStep();
    expect((screen.getByLabelText(/^email$/i) as HTMLInputElement).value).toBe('fresh@x.com');
  });

  it('a CLEARED whatsapp does not come back through the "same as phone" default', async () => {
    // crossApp arrival after the user deleted WhatsApp in the other app:
    // the checkbox defaults to checked, so an unguarded prefill would write
    // whatsapp = contactPhone on save (PR #206 review).
    h.auth.userDoc = {
      uid: 'bs1',
      contactPhone: '+33 600000000',
      whatsapp: null,
      profiles: { babysitter: { ejemEmail: 'lea@ejm.org' }, tutor: { whatsapp: '+33 600000000' } },
    };
    renderStep();
    const sameAsPhone = screen.getByRole('checkbox', { name: /same as phone/i }) as HTMLInputElement;
    expect(sameAsPhone.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(h.updateDoc).toHaveBeenCalled());
    const payload = h.updateDoc.mock.calls[0][1];
    expect(payload.whatsapp).toBeNull();
    expect(payload['profiles.babysitter.whatsapp']).toBeNull();
  });

  it('seeds ONCE: typing is not reverted by the resume-prefill effect', async () => {
    h.auth.userDoc = {
      uid: 'bs1',
      contactEmail: 'seed@x.com',
      profiles: { babysitter: { ejemEmail: 'lea@ejm.org', aboutMe: 'I love kids' } },
    };
    renderStep();
    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    expect(email.value).toBe('seed@x.com');
    fireEvent.change(email, { target: { value: 'seed@x.commm' } });
    // The change triggers a rerender; an unguarded effect would reset the
    // field to the stored value (the PR #206 review failure scenario).
    await waitFor(() => expect(email.value).toBe('seed@x.commm'));

    const about = screen.getByLabelText(/about me/i) as HTMLTextAreaElement;
    expect(about.value).toBe('I love kids');
    fireEvent.change(about, { target: { value: 'I love kids!' } });
    await waitFor(() => expect(about.value).toBe('I love kids!'));
  });
});
