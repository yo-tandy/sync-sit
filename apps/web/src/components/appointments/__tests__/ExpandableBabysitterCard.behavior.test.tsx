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
