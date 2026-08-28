/**
 * Babysitter-side appointment-note pins (issue #238, parity B2) — mirrors
 * study's "tutor SessionsPage — session notes (post)" suite, adapted to sit's
 * request detail page:
 * - the family pre-note shows read-only on an upcoming (not-started)
 *   confirmed appointment — no post affordance yet (window closed);
 * - once started, the post affordance appears and saving calls
 *   setAppointmentNote with {appointmentId, kind:'post', text};
 * - editing an existing post-note seeds the textarea and clearing it sends
 *   empty text;
 * - a confirmed RECURRING arrangement offers the post affordance with no
 *   timing gate (sit's structural adaptation).
 *
 * i18n is mocked to echo keys (request.notes.*).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppointmentDoc } from '@ejm/sit-core';

const h = vi.hoisted(() => ({
  callable: vi.fn((name: string) =>
    name === 'getParentContacts'
      ? Promise.resolve({ data: { contacts: [] } })
      : Promise.resolve({ data: { success: true } }),
  ),
  docNext: null as null | ((snap: unknown) => void),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ appointmentId: 'apt-1' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: () => ({ userDoc: null }) }));
vi.mock('@/components/ui/PhotoLightbox', () => ({
  PhotoLightbox: () => <div data-testid="lightbox" />,
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ size: 0, docs: [] }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void) => {
    h.docNext = next;
    return vi.fn();
  },
}));

import { RequestDetailPage } from '../RequestDetailPage';

function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
const DAY = 24 * 60 * 60 * 1000;
const TOMORROW = parisDateOf(new Date(Date.now() + DAY));
const YESTERDAY = parisDateOf(new Date(Date.now() - DAY));

function baseApt(overrides: Partial<AppointmentDoc> = {}) {
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    familyId: 'fam-1',
    status: 'confirmed',
    type: 'one_time',
    date: TOMORROW,
    startTime: '18:00',
    endTime: '22:00',
    kidIds: ['kid1'],
    address: '15 Rue de Passy',
    latLng: { lat: 48.85, lng: 2.27 },
    familyName: 'Dupont',
    ...overrides,
  };
}

function renderWithApt(overrides: Partial<AppointmentDoc> = {}) {
  render(<RequestDetailPage />);
  act(() => {
    h.docNext!({ exists: () => true, data: () => baseApt(overrides) });
  });
}

afterEach(() => {
  cleanup();
  h.callable.mockClear();
  // Restore the default implementation (the failure-path test overrides it).
  h.callable.mockImplementation((name: string) =>
    name === 'getParentContacts'
      ? Promise.resolve({ data: { contacts: [] } })
      : Promise.resolve({ data: { success: true } }),
  );
  h.docNext = null;
});

describe('RequestDetailPage — appointment notes (post)', () => {
  it('shows the family pre-note read-only on an upcoming (not-started) appointment — no post affordance', () => {
    renderWithApt({ preAppointmentNote: 'Door code 1234B' });
    expect(screen.getByText('request.notes.fromFamily')).toBeTruthy();
    expect(screen.getByText('Door code 1234B')).toBeTruthy();
    expect(screen.queryByText('request.notes.add')).toBeNull();
    expect(screen.queryByText('request.notes.edit')).toBeNull();
  });

  it('no notes card at all on an upcoming appointment without notes', () => {
    renderWithApt();
    expect(screen.queryByText('request.notes.title')).toBeNull();
  });

  it('saving a post-note on a started appointment calls setAppointmentNote with {appointmentId, kind:post, text}', async () => {
    renderWithApt({ date: YESTERDAY });
    fireEvent.click(screen.getByText('request.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('request.notes.placeholder'), {
      target: { value: 'All went well' },
    });
    fireEvent.click(screen.getByText('request.notes.save'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'post',
        text: 'All went well',
      }),
    );
    await waitFor(() => expect(screen.queryByText('request.notes.dialogTitle')).toBeNull());
  });

  it('editing an existing post-note seeds the textarea and clearing it sends empty text', async () => {
    renderWithApt({ date: YESTERDAY, postAppointmentNote: 'old debrief' });
    fireEvent.click(screen.getByText('request.notes.edit'));
    const textarea = screen.getByPlaceholderText('request.notes.placeholder') as HTMLTextAreaElement;
    expect(textarea.value).toBe('old debrief');
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.click(screen.getByText('request.notes.save'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'post',
        text: '',
      }),
    );
  });

  it('a failed save surfaces the error and keeps the dialog open', async () => {
    // getParentContacts fires first on load and must keep resolving; only the
    // note save rejects. (afterEach restores the default implementation.)
    h.callable.mockImplementation((name: string) =>
      name === 'getParentContacts'
        ? Promise.resolve({ data: { contacts: [] } })
        : Promise.reject(new Error('boom')),
    );
    renderWithApt({ date: YESTERDAY });
    fireEvent.click(screen.getByText('request.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('request.notes.placeholder'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('request.notes.save'));
    await waitFor(() => expect(screen.getByText('request.notes.error')).toBeTruthy());
    // Dialog stays open (non-optimistic) and the save button is re-enabled.
    expect(screen.getByText('request.notes.dialogTitle')).toBeTruthy();
    expect(
      (screen.getByText('request.notes.save') as HTMLButtonElement).closest('button')!.disabled,
    ).toBe(false);
  });

  it('a cancelled appointment with an own post-note offers REMOVE, confirmed via the shared Dialog', async () => {
    renderWithApt({ status: 'cancelled', date: YESTERDAY, postAppointmentNote: 'old debrief' });
    expect(screen.queryByText('request.notes.add')).toBeNull();
    expect(screen.queryByText('request.notes.edit')).toBeNull();
    fireEvent.click(screen.getByText('request.notes.remove'));
    expect(screen.getByText('request.notes.removeTitle')).toBeTruthy();
    // Distinct destructive-confirm label (round 4 of the study port, PR #269).
    fireEvent.click(screen.getByText('request.notes.removeConfirm'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'post',
        text: '',
      }),
    );
    await waitFor(() => expect(screen.queryByText('request.notes.removeTitle')).toBeNull());
  });

  it('a backdrop click cannot dismiss the remove dialog mid-flight', async () => {
    let rejectCall!: (e: Error) => void;
    renderWithApt({ status: 'cancelled', date: YESTERDAY, postAppointmentNote: 'old debrief' });
    // Only the note callable hangs; getParentContacts (fired on load) keeps
    // resolving through the default implementation.
    h.callable.mockImplementation((name: string) =>
      name === 'getParentContacts'
        ? Promise.resolve({ data: { contacts: [] } })
        : new Promise((_resolve, reject) => { rejectCall = reject; }),
    );
    fireEvent.click(screen.getByText('request.notes.remove'));
    const buttons = screen.getAllByText('request.notes.remove');
    fireEvent.click(buttons[buttons.length - 1]);
    // Backdrop click while the erasure is in flight: dialog must survive.
    fireEvent.click(document.querySelector('.fixed.inset-0.z-50')!);
    expect(screen.getByText('request.notes.removeTitle')).toBeTruthy();
    // Settle with a FAILURE (a success closes the dialog itself, which
    // would make this half vacuous -- PR #274 review): the error renders,
    // the dialog stays, and the backdrop is functional again.
    rejectCall(new Error('boom'));
    await waitFor(() => expect(screen.getByText('request.notes.error')).toBeTruthy());
    fireEvent.click(document.querySelector('.fixed.inset-0.z-50')!);
    expect(screen.queryByText('request.notes.removeTitle')).toBeNull();
  });

  it('a confirmed recurring arrangement offers the post affordance (no timing gate)', () => {
    renderWithApt({
      type: 'recurring',
      date: undefined,
      startTime: undefined,
      endTime: undefined,
      recurringSlots: [{ day: 'mon', startTime: '18:00', endTime: '20:00' }],
    });
    expect(screen.getByText('request.notes.add')).toBeTruthy();
  });
});
