/**
 * Regression test for the parent "cancel pending request" control.
 *
 * Bug: ExpandableBabysitterCard rendered the cancel button only for the
 * `confirmed` variant, so a parent expanding a *pending* request saw an
 * Edit button but no way to withdraw the request — even though the
 * dashboard wired up `onCancel` and the backend already supported
 * family-initiated cancellation of pending appointments. See
 * apps/web/src/components/appointments/ExpandableBabysitterCard.tsx
 * (the `(variant === 'pending' || variant === 'confirmed') && onCancel`
 * block).
 *
 * The card is collapsed by default; actions live behind the expand
 * toggle, so each test clicks the header button first. i18n is mocked to
 * echo translation keys, so assertions match on the key the button
 * renders (`appointment.cancelRequest` for pending, `appointment.cancel`
 * for confirmed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppointmentDoc, BabysitterSummary } from '@ejm/sit-core';
import { ExpandableBabysitterCard } from '../ExpandableBabysitterCard';

// Echo translation keys so we can assert on them directly.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Keep the card off the network: stub the firebase handle and the
// holidays hook, and no-op the firestore/auth reads pulled in via the
// `@/components/ui` barrel and the expanded view.
vi.mock('@/config/firebase', () => ({ db: {}, auth: {}, functions: {}, storage: {} }));
vi.mock('@/hooks/useHolidays', () => ({ useHolidays: () => ({ periods: [] }) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }));
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

const info: BabysitterSummary = {
  uid: 'bs-1',
  firstName: 'Marie',
  lastName: 'Dupont',
  name: 'Marie Dupont',
  age: 22,
  classLevel: 'L3',
};

const appointment = {
  appointmentId: 'apt-1',
  babysitterUserId: 'bs-1',
  date: '2026-07-01',
  startTime: '18:00',
  endTime: '22:00',
} as AppointmentDoc;

function expandCard() {
  // The header toggle is the first button; clicking it reveals actions.
  fireEvent.click(screen.getAllByRole('button')[0]);
}

afterEach(cleanup);

describe('ExpandableBabysitterCard cancel control', () => {
  it('renders a Cancel Request button for a pending request', () => {
    const onCancel = vi.fn();
    render(
      <ExpandableBabysitterCard
        appointment={appointment}
        info={info}
        variant="pending"
        onCancel={onCancel}
      />,
    );
    expandCard();

    const btn = screen.getByText('appointment.cancelRequest');
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders the Cancel button for a confirmed appointment', () => {
    const onCancel = vi.fn();
    render(
      <ExpandableBabysitterCard
        appointment={appointment}
        info={info}
        variant="confirmed"
        onCancel={onCancel}
      />,
    );
    expandCard();

    expect(screen.getByText('appointment.cancel')).toBeInTheDocument();
  });

  it('does not render a cancel control for a past appointment', () => {
    render(
      <ExpandableBabysitterCard
        appointment={appointment}
        info={info}
        variant="past"
        onCancel={vi.fn()}
      />,
    );
    expandCard();

    expect(screen.queryByText('appointment.cancelRequest')).not.toBeInTheDocument();
    expect(screen.queryByText('appointment.cancel')).not.toBeInTheDocument();
  });
});

/**
 * Contact inversion (issue #207 PR3): a card for a BABYSITTER-initiated
 * pending is the family's to answer. It must say so without being expanded,
 * offer Accept/Decline, and drop the edit/cancel controls that only make
 * sense on a request the family itself authored.
 */
const answeredAppointment = {
  ...appointment,
  appointmentId: 'apt-2',
  initiatedBy: 'babysitter',
  publishedSearchId: 'ps-1',
} as AppointmentDoc;

describe('ExpandableBabysitterCard babysitter-initiated pending', () => {
  it('labels the request as answering a published search without expanding', () => {
    render(
      <ExpandableBabysitterCard
        appointment={answeredAppointment}
        info={info}
        variant="pending"
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expect(screen.getByText('familyDashboard.answeredPublishedSearch')).toBeInTheDocument();
  });

  it('offers Accept and Decline, and wires each to its handler', () => {
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    render(
      <ExpandableBabysitterCard
        appointment={answeredAppointment}
        info={info}
        variant="pending"
        onAccept={onAccept}
        onDecline={onDecline}
      />,
    );
    expandCard();

    fireEvent.click(screen.getByText('request.accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('request.decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('drops edit and cancel for a babysitter-initiated pending', () => {
    render(
      <ExpandableBabysitterCard
        appointment={answeredAppointment}
        info={info}
        variant="pending"
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expandCard();

    expect(screen.queryByText('appointment.edit')).not.toBeInTheDocument();
    expect(screen.queryByText('appointment.cancelRequest')).not.toBeInTheDocument();
  });

  it('leaves a FAMILY-initiated pending exactly as it was (regression pin)', () => {
    render(
      <ExpandableBabysitterCard
        appointment={appointment}
        info={info}
        variant="pending"
        onCancel={vi.fn()}
        onEdit={vi.fn()}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
      />,
    );
    expandCard();

    expect(screen.getByText('appointment.edit')).toBeInTheDocument();
    expect(screen.getByText('appointment.cancelRequest')).toBeInTheDocument();
    expect(screen.queryByText('request.accept')).not.toBeInTheDocument();
    expect(screen.queryByText('familyDashboard.answeredPublishedSearch')).not.toBeInTheDocument();
  });
});

describe('rejected cards: who declined decides the affordance', () => {
  // resubmitAppointment re-derives the family address onto the resubmission,
  // so offering Resubmit on a request the FAMILY just declined would silently
  // disclose it to that sitter — the invariant this PR exists to establish
  // (PR #212 review). The distinction is three sibling conditionals keyed on
  // statusReason, so it needs pinning against a refactor.
  const declinedByFamily = {
    ...answeredAppointment,
    status: 'rejected',
    statusReason: 'declined_by_family',
  } as AppointmentDoc;

  it('a family-declined card says so and offers no Resubmit', () => {
    render(
      <ExpandableBabysitterCard
        appointment={declinedByFamily}
        info={info}
        variant="rejected"
        onResubmit={vi.fn()}
      />,
    );
    expandCard();
    expect(screen.getByText('appointment.declinedByYou')).toBeInTheDocument();
    expect(screen.queryByText('appointment.resubmit')).toBeNull();
  });

  it('a sitter-declined card still offers Resubmit', () => {
    const declinedBySitter = {
      ...appointment,
      status: 'rejected',
      statusReason: 'declined_by_babysitter',
    } as AppointmentDoc;
    render(
      <ExpandableBabysitterCard
        appointment={declinedBySitter}
        info={info}
        variant="rejected"
        onResubmit={vi.fn()}
      />,
    );
    expandCard();
    expect(screen.getByText('appointment.resubmit')).toBeInTheDocument();
    expect(screen.queryByText('appointment.declinedByYou')).toBeNull();
  });

  it('a sitter-WITHDRAWN contact says who withdrew and offers no Resubmit', () => {
    // cancelAppointment writes cancelled/cancelled_by_babysitter, and
    // useFamilyAppointments funnels cancelled into rejectedRecent — so this
    // card renders with variant="rejected" while its status is 'cancelled'.
    // resubmitAppointment only accepts 'rejected', so a Resubmit button here
    // could only ever produce an error alert (PR #212 review).
    const withdrawn = {
      ...answeredAppointment,
      status: 'cancelled',
      statusReason: 'cancelled_by_babysitter',
    } as AppointmentDoc;
    render(
      <ExpandableBabysitterCard
        appointment={withdrawn}
        info={info}
        variant="rejected"
        onResubmit={vi.fn()}
      />,
    );
    expandCard();
    expect(screen.getByText('appointment.withdrawnBySitter')).toBeInTheDocument();
    expect(screen.queryByText('appointment.resubmit')).toBeNull();
  });

  it('a family accepting a sitter answer can still EDIT the confirmed sitting', () => {
    // Edit is dropped only while such a request is pending; once accepted it
    // is a mutual commitment like any other confirmed appointment.
    render(
      <ExpandableBabysitterCard
        appointment={{ ...answeredAppointment, status: 'confirmed' } as AppointmentDoc}
        info={info}
        variant="confirmed"
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expandCard();
    expect(screen.getByText('appointment.edit')).toBeInTheDocument();
  });
});
