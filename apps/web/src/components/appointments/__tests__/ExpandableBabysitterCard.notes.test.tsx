/**
 * Family-side appointment-note pins (issue #238, parity B2) — mirrors study's
 * "family SessionsPage — session notes (pre)" suite, adapted to sit's card:
 * - an upcoming confirmed one_time offers an add-note (pre) affordance;
 * - saving calls setAppointmentNote with {appointmentId, kind:'pre', text};
 * - a past card shows both notes with author labels and no family edit;
 * - editing an existing pre-note seeds the textarea and clearing it sends
 *   empty text;
 * - a confirmed RECURRING arrangement offers the affordance too (no date —
 *   sit's structural adaptation: the window never closes while confirmed);
 * - a confirmed one_time that already STARTED offers no affordance (window
 *   closed, UX mirror of the callable's gate).
 *
 * i18n is mocked to echo keys, so assertions match on the keys the card
 * renders (familyDashboard.notes.*).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AppointmentDoc, BabysitterSummary } from '@ejm/sit-core';

const h = vi.hoisted(() => ({
  callable: vi.fn(() => Promise.resolve({ data: { success: true } })),
}));

// Echo translation keys so we can assert on them directly.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

import { ExpandableBabysitterCard } from '../ExpandableBabysitterCard';

// Dynamic Paris-safe fixtures: a ±1-day date is unambiguously past/future in
// any timezone the test runs in.
function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
const DAY = 24 * 60 * 60 * 1000;
const TOMORROW = parisDateOf(new Date(Date.now() + DAY));
const YESTERDAY = parisDateOf(new Date(Date.now() - DAY));

const info: BabysitterSummary = {
  uid: 'bs-1',
  firstName: 'Marie',
  lastName: 'Dupont',
  name: 'Marie Dupont',
  age: 22,
  classLevel: 'L3',
};

function apt(overrides: Partial<AppointmentDoc> = {}): AppointmentDoc {
  return {
    appointmentId: 'apt-1',
    babysitterUserId: 'bs-1',
    type: 'one_time',
    date: TOMORROW,
    startTime: '18:00',
    endTime: '22:00',
    ...overrides,
  } as AppointmentDoc;
}

function expandCard() {
  fireEvent.click(screen.getAllByRole('button')[0]);
}

afterEach(() => {
  cleanup();
  h.callable.mockClear();
});

describe('ExpandableBabysitterCard — appointment notes (pre)', () => {
  it('an upcoming confirmed one_time offers an add-note (pre) affordance', () => {
    render(<ExpandableBabysitterCard appointment={apt()} info={info} variant="confirmed" />);
    expandCard();
    expect(screen.getByText('familyDashboard.notes.add')).toBeTruthy();
  });

  it('saving a pre-note calls setAppointmentNote with {appointmentId, kind:pre, text}', async () => {
    render(<ExpandableBabysitterCard appointment={apt()} info={info} variant="confirmed" />);
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('familyDashboard.notes.placeholder'), {
      target: { value: 'Door code 1234B' },
    });
    fireEvent.click(screen.getByText('familyDashboard.notes.save'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'pre',
        text: 'Door code 1234B',
      }),
    );
    // Non-optimistic close: the dialog goes away once the callable resolves.
    await waitFor(() =>
      expect(screen.queryByText('familyDashboard.notes.dialogTitle')).toBeNull(),
    );
  });

  it('a past card shows both notes with author labels and no family edit', () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({
          date: YESTERDAY,
          preAppointmentNote: 'the pre note',
          postAppointmentNote: 'the post note',
        })}
        info={info}
        variant="past"
      />,
    );
    expandCard();
    expect(screen.getByText('familyDashboard.notes.fromFamily')).toBeTruthy();
    expect(screen.getByText('the pre note')).toBeTruthy();
    expect(screen.getByText('familyDashboard.notes.fromBabysitter')).toBeTruthy();
    expect(screen.getByText('the post note')).toBeTruthy();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
    expect(screen.queryByText('familyDashboard.notes.edit')).toBeNull();
  });

  it('editing an existing pre-note seeds the textarea and clearing it sends empty text', async () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({ preAppointmentNote: 'old note' })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.edit'));
    const textarea = screen.getByPlaceholderText(
      'familyDashboard.notes.placeholder',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('old note');
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.click(screen.getByText('familyDashboard.notes.save'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'pre',
        text: '',
      }),
    );
  });

  it('a confirmed recurring arrangement (no date) offers the affordance', () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({ type: 'recurring', date: undefined, startTime: undefined, endTime: undefined })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.getByText('familyDashboard.notes.add')).toBeTruthy();
  });

  it('a failed save surfaces the error and keeps the dialog open', async () => {
    h.callable.mockRejectedValueOnce(new Error('boom'));
    render(<ExpandableBabysitterCard appointment={apt()} info={info} variant="confirmed" />);
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('familyDashboard.notes.placeholder'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('familyDashboard.notes.save'));
    await waitFor(() => expect(screen.getByText('familyDashboard.notes.error')).toBeTruthy());
    // Dialog stays open (non-optimistic) and the save button is re-enabled.
    expect(screen.getByText('familyDashboard.notes.dialogTitle')).toBeTruthy();
    // Naming sweep (issue #305): the labelled dialog carries modal semantics.
    expect(
      screen.getByRole('dialog', { name: 'familyDashboard.notes.dialogTitle' }),
    ).toHaveAttribute('aria-modal', 'true');
    expect(
      (screen.getByText('familyDashboard.notes.save') as HTMLButtonElement).closest('button')!
        .disabled,
    ).toBe(false);
  });

  it('a failed-precondition save shows the dead-end message instead of try-again (issue #255)', async () => {
    // The window closed mid-edit (e.g. the sitting started while the dialog
    // was open) — retrying can never work, so the dialog says so.
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('closed'), { code: 'functions/failed-precondition' }),
    );
    render(<ExpandableBabysitterCard appointment={apt()} info={info} variant="confirmed" />);
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('familyDashboard.notes.placeholder'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('familyDashboard.notes.save'));
    await waitFor(() => expect(screen.getByText('familyDashboard.notes.errorClosed')).toBeTruthy());
    expect(screen.queryByText('familyDashboard.notes.error')).toBeNull();
  });

  it('a confirmed one_time that already started offers NO pre affordance', () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
  });

  it('fails CLOSED like the server: a confirmed non-recurring doc without a date offers NO affordance', () => {
    // The callable would throw failed-precondition on such a doc (no
    // scheduled date), so offering the dialog could only ever produce an
    // error (round-4 review).
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: undefined, startTime: undefined, endTime: undefined })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
  });

  it('a closed window with an existing own note offers REMOVE, confirmed via the shared Dialog', async () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY, preAppointmentNote: 'Door code 1234B' })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
    expect(screen.queryByText('familyDashboard.notes.edit')).toBeNull();
    // The affordance opens the confirm dialog; the dialog's own remove
    // button (same label, rendered second) fires the clear.
    fireEvent.click(screen.getByText('familyDashboard.notes.remove'));
    expect(screen.getByText('familyDashboard.notes.removeTitle')).toBeTruthy();
    // The dialog's destructive confirm carries its OWN label (round 4 of
    // the study port, PR #269): no positional disambiguation needed.
    fireEvent.click(screen.getByText('familyDashboard.notes.removeConfirm'));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('setAppointmentNote', {
        appointmentId: 'apt-1',
        kind: 'pre',
        text: '',
      }),
    );
    // Non-optimistic close on success.
    await waitFor(() =>
      expect(screen.queryByText('familyDashboard.notes.removeTitle')).toBeNull(),
    );
  });

  it('cancelling the remove dialog sends nothing', () => {
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY, preAppointmentNote: 'Door code 1234B' })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.remove'));
    fireEvent.click(screen.getByText('common.cancel'));
    expect(h.callable).not.toHaveBeenCalled();
    expect(screen.queryByText('familyDashboard.notes.removeTitle')).toBeNull();
  });

  it('a failed remove surfaces the error and keeps the confirm dialog open', async () => {
    h.callable.mockRejectedValueOnce(new Error('boom'));
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY, preAppointmentNote: 'Door code 1234B' })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.remove'));
    fireEvent.click(screen.getByText('familyDashboard.notes.removeConfirm'));
    await waitFor(() => expect(screen.getByText('familyDashboard.notes.removeError')).toBeTruthy());
    expect(screen.getByText('familyDashboard.notes.removeTitle')).toBeTruthy();
  });

  it('a backdrop click cannot dismiss the dialog mid-flight (the error must have somewhere to render)', async () => {
    // Hold the callable unresolved so the save is in flight when the
    // backdrop is clicked. Dialog closes on backdrop click unconditionally,
    // so an ungated onClose would unmount NoteForm -- the only element that
    // can render noteError -- and a failed save would turn silent.
    let rejectCall!: (e: Error) => void;
    h.callable.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectCall = reject; }),
    );
    render(<ExpandableBabysitterCard appointment={apt()} info={info} variant="confirmed" />);
    expandCard();
    fireEvent.click(screen.getByText('familyDashboard.notes.add'));
    fireEvent.change(screen.getByPlaceholderText('familyDashboard.notes.placeholder'), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByText('familyDashboard.notes.save'));
    // The dialog overlay (outermost fixed container) IS the backdrop target.
    fireEvent.click(document.querySelector('.fixed.inset-0.z-50')!);
    expect(screen.getByText('familyDashboard.notes.dialogTitle')).toBeTruthy();
    // Settle the call with a FAILURE: the dialog must stay open showing the
    // error (a success would close it via saveNote itself, which would make
    // this half vacuous -- PR #274 review), and NOW the backdrop works
    // again because noteSaving is false.
    rejectCall(new Error('boom'));
    await waitFor(() => expect(screen.getByText('familyDashboard.notes.error')).toBeTruthy());
    expect(screen.getByText('familyDashboard.notes.dialogTitle')).toBeTruthy();
    fireEvent.click(document.querySelector('.fixed.inset-0.z-50')!);
    expect(screen.queryByText('familyDashboard.notes.dialogTitle')).toBeNull();
  });

  it('notes and REMOVE survive a missing babysitter profile (info undefined)', () => {
    // info comes from a profile getDoc that silently swallows a missing doc
    // (hard-deleted sitter) or permission error; the erasure affordance must
    // not vanish with it (round-8 review).
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY, preAppointmentNote: 'Door code 1234B' })}
        info={undefined}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.getByText('Door code 1234B')).toBeTruthy();
    expect(screen.getByText('familyDashboard.notes.remove')).toBeTruthy();
  });

  it('a pending card with an odd-history own note shows it and offers REMOVE (never stranded)', () => {
    // A note cannot be AUTHORED while pending (canEditPre requires
    // confirmed), but pending cards render forever and the cron redaction
    // skips them — so an existing note must stay visible and removable here.
    render(
      <ExpandableBabysitterCard
        appointment={apt({ preAppointmentNote: 'odd history note' })}
        info={info}
        variant="pending"
      />,
    );
    expandCard();
    expect(screen.getByText('odd history note')).toBeTruthy();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
    expect(screen.getByText('familyDashboard.notes.remove')).toBeTruthy();
  });

  it('the OTHER party\'s note alone offers NO remove (the affordance is author-only)', () => {
    // Only a babysitter post-note exists; the family authors pre — nothing
    // of theirs to remove, so no affordance of any kind.
    render(
      <ExpandableBabysitterCard
        appointment={apt({ date: YESTERDAY, postAppointmentNote: 'their debrief' })}
        info={info}
        variant="confirmed"
      />,
    );
    expandCard();
    expect(screen.getByText('their debrief')).toBeTruthy();
    expect(screen.queryByText('familyDashboard.notes.remove')).toBeNull();
    expect(screen.queryByText('familyDashboard.notes.add')).toBeNull();
  });
});
