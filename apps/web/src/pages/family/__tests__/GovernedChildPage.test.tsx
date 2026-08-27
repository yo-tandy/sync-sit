import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

// Everything on this page arrives through getGovernedChildDetail; the
// protective controls are callables too (sit's own plus the study callables,
// which resolve cross-app — one Firebase project). No client Firestore reads.
const h = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {}, auth: {}, db: {}, storage: {} }));

// The ui barrel pulls the auth store (module-scope onAuthStateChanged) — stub it.
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ userDoc: null, firebaseUser: null }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

import i18n from '@/i18n';
import { GovernedChildPage } from '../GovernedChildPage';

function detail(overrides: Record<string, unknown> = {}) {
  return {
    child: {
      childUid: 'c1',
      firstName: 'Noa',
      lastName: 'Weiss',
      photoUrl: null,
      email: 'noa28@ejm.org',
      status: 'active',
      age: 14,
      dateOfBirth: '2012-05-01',
      identityLocked: true,
    },
    link: {
      status: 'active',
      origin: 'parent_created',
      requestedAt: '2026-07-01T10:00:00.000Z',
      confirmedAt: '2026-07-02T10:00:00.000Z',
      consent: {
        tosVersion: '1.0',
        privacyVersion: '1.0',
        supervisionAgreementVersion: '1.0',
        approvedAt: '2026-07-01T10:00:00.000Z',
      },
    },
    providerProfiles: {
      babysitter: { searchable: true, enrollmentComplete: true, hourlyRate: 12 },
      tutor: null,
    },
    schedule: { weekly: null, overrideCount: 0 },
    study: { sessions: [], contactRequests: [] },
    sit: { appointments: [], contactSharingRequests: [] },
    counts: { references: 0, endorsements: 0 },
    ...overrides,
  };
}

function appointment(overrides: Record<string, unknown> = {}) {
  return {
    appointmentId: 'a1',
    type: 'one_time',
    status: 'confirmed',
    statusReason: null,
    familyName: 'Cohen',
    date: '2099-01-10',
    startTime: '19:00',
    endTime: '22:00',
    offeredRate: 12,
    message: 'Saturday evening please',
    additionalInfo: null,
    cancellationReason: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

function sitContact(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'sc1',
    status: 'pending',
    familyName: 'Levi',
    parentName: 'Sara Levi',
    createdAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    type: 'one_time',
    status: 'confirmed',
    statusReason: null,
    familyName: 'Martin',
    subject: 'math',
    level: '6e',
    rate: 20,
    location: 'family_home',
    date: '2099-01-10',
    startTime: '17:00',
    endTime: '18:00',
    message: 'Hello from the family',
    preSessionNote: 'Bring the workbook',
    postSessionNote: 'Great progress today',
    lateCancellation: false,
    cancellationReason: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    proposedBy: 'family',
    recurringSlots: null,
    instances: [],
    ...overrides,
  };
}

function instance(overrides: Record<string, unknown> = {}) {
  return {
    instanceId: '2099-01-17',
    date: '2099-01-17',
    startTime: '17:00',
    endTime: '18:00',
    status: 'scheduled',
    statusReason: null,
    cancellationReason: null,
    lateCancellation: false,
    preSessionNote: null,
    postSessionNote: null,
    ...overrides,
  };
}

function studyContact(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'r1',
    status: 'pending',
    familyName: 'Levi',
    parentName: 'Sara Levi',
    subject: 'physics',
    level: '2nde',
    message: 'Could you help our son?',
    createdAt: '2026-08-02T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/family/governance/c1']}>
      <Routes>
        <Route path="/family/governance/:childUid" element={<GovernedChildPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function reset() {
  i18n.changeLanguage('en');
  h.detail = detail();
  h.callable.mockReset();
  h.callable.mockImplementation((name: string) => {
    if (name === 'getGovernedChildDetail') return Promise.resolve({ data: h.detail });
    return Promise.resolve({ data: { success: true } });
  });
}

const detailCalls = () => h.callable.mock.calls.filter((c) => c[0] === 'getGovernedChildDetail');

describe('GovernedChildPage (sit)', () => {
  beforeEach(() => reset());
  afterEach(() => cleanup());

  it('loads the detail for the childUid in the route', async () => {
    renderPage();
    await screen.findByText(/Noa Weiss/);
    expect(h.callable).toHaveBeenCalledWith('getGovernedChildDetail', { childUid: 'c1' });
  });

  // ── Ruling 8 pin: the guardian sees messages and notes, both apps. ──
  it('shows appointment messages, session notes and request messages (full oversight)', async () => {
    h.detail = detail({
      sit: { appointments: [appointment()], contactSharingRequests: [sitContact()] },
      study: { sessions: [session()], contactRequests: [studyContact()] },
    });
    renderPage();

    expect(await screen.findByText(/Saturday evening please/)).toBeInTheDocument();
    expect(screen.getByText(/Bring the workbook/)).toBeInTheDocument();
    expect(screen.getByText(/Great progress today/)).toBeInTheDocument();
    expect(screen.getByText(/Could you help our son\?/)).toBeInTheDocument();
  });

  // ── The no-accept pin: guardian surfaces NEVER render accept affordances. ──
  it('badges a late-cancelled appointment in history (issue #237 read surface)', async () => {
    h.detail = detail({
      sit: {
        appointments: [
          appointment({ appointmentId: 'late1', status: 'cancelled', lateCancellation: true }),
          appointment({ appointmentId: 'clean1', status: 'cancelled', lateCancellation: false }),
        ],
        contactSharingRequests: [],
      },
    });
    renderPage();
    // Exactly ONE late badge: the flagged cancel, not the clean one.
    expect(await screen.findByText('Cancelled late')).toBeInTheDocument();
    expect(screen.getAllByText('Cancelled late')).toHaveLength(1);
  });

  it('renders NO accept affordance for any pending item of either app', async () => {
    h.detail = detail({
      sit: {
        appointments: [appointment({ status: 'pending' })],
        contactSharingRequests: [sitContact()],
      },
      study: {
        sessions: [
          session({ sessionId: 's3', status: 'pending' }),
          session({ sessionId: 's4', status: 'pending', proposedBy: 'provider' }),
        ],
        contactRequests: [studyContact()],
      },
    });
    renderPage();
    await screen.findByText(/Saturday evening please/);

    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    // Four family-initiated pending items expose decline; the kid's own study
    // proposal exposes withdraw (a cancel) — never accept.
    expect(screen.getAllByRole('button', { name: /decline/i })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /withdraw proposal/i })).toHaveLength(1);
  });

  it('toggling sit searchable confirms, calls guardianSetChildSearchable, then refetches', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /babysitter search visibility/i }));
    expect(h.callable).not.toHaveBeenCalledWith('guardianSetChildSearchable', expect.anything());

    fireEvent.click(await screen.findByRole('button', { name: /yes, hide/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('guardianSetChildSearchable', {
        childUid: 'c1',
        app: 'sit',
        searchable: false,
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('toggling study searchable targets app study', async () => {
    h.detail = detail({
      providerProfiles: {
        babysitter: null,
        tutor: { searchable: false, enrollmentComplete: true, subjects: [] },
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /tutor search visibility/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, make visible/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('guardianSetChildSearchable', {
        childUid: 'c1',
        app: 'study',
        searchable: true,
      }),
    );
  });

  it('cancelling a confirmed appointment requires a reason and calls cancelAppointment, then refetches', async () => {
    h.detail = detail({ sit: { appointments: [appointment()], contactSharingRequests: [] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /cancel appointment/i }));
    fireEvent.change(await screen.findByPlaceholderText(/reason/i), {
      target: { value: 'Family emergency' },
    });
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel appointment/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelAppointment', {
        appointmentId: 'a1',
        reason: 'Family emergency',
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('declining a pending appointment request confirms, calls respondToRequest decline, then refetches', async () => {
    h.detail = detail({
      sit: { appointments: [appointment({ status: 'pending' })], contactSharingRequests: [] },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToRequest', {
        appointmentId: 'a1',
        action: 'decline',
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('declining a contact-sharing request calls respondToContactSharing decline, then refetches', async () => {
    h.detail = detail({ sit: { appointments: [], contactSharingRequests: [sitContact()] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToContactSharing', {
        requestId: 'sc1',
        action: 'decline',
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  // ── Study controls are WIRED cross-app (one Firebase project). ──
  it('cancelling a confirmed study session calls cancelSession with a reason, then refetches', async () => {
    h.detail = detail({ study: { sessions: [session()], contactRequests: [] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /cancel session/i }));
    fireEvent.change(await screen.findByPlaceholderText(/reason/i), {
      target: { value: 'Family emergency' },
    });
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel session/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 's1',
        reason: 'Family emergency',
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('cancelling one occurrence calls cancelSessionInstance with the instanceId', async () => {
    h.detail = detail({
      study: {
        sessions: [session({ sessionId: 's2', type: 'recurring', instances: [instance()] })],
        contactRequests: [],
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /view dates/i }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel this date/i }));
    fireEvent.change(await screen.findByPlaceholderText(/reason/i), {
      target: { value: 'Doctor appointment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel this date/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSessionInstance', {
        sessionId: 's2',
        instanceId: '2099-01-17',
        reason: 'Doctor appointment',
      }),
    );
  });

  it('declining a pending study session calls respondToSession decline; withdrawing a kid proposal cancels', async () => {
    h.detail = detail({
      study: {
        sessions: [session({ sessionId: 's3', status: 'pending' })],
        contactRequests: [],
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));
    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToSession', {
        sessionId: 's3',
        action: 'decline',
      }),
    );
    cleanup();

    reset();
    h.detail = detail({
      study: {
        sessions: [session({ sessionId: 's4', status: 'pending', proposedBy: 'provider' })],
        contactRequests: [],
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /withdraw proposal/i }));
    fireEvent.change(await screen.findByPlaceholderText(/reason/i), {
      target: { value: 'Too many commitments' },
    });
    fireEvent.click(screen.getByRole('button', { name: /yes, withdraw/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelSession', {
        sessionId: 's4',
        reason: 'Too many commitments',
      }),
    );
    expect(h.callable).not.toHaveBeenCalledWith('respondToSession', expect.anything());
  });

  it('declining a FAMILY-initiated study contact request calls respondToTutorContactRequest decline', async () => {
    h.detail = detail({ study: { sessions: [], contactRequests: [studyContact()] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'r1',
        action: 'decline',
      }),
    );
  });

  it('a request the CHILD sent offers Withdraw, never Decline (issue #207 PR4)', async () => {
    // respondToTutorContactRequest refuses a tutor-initiated request outright,
    // so a Decline here could only ever fail — the same shape the page already
    // handles for a session the kid proposed (PR #213 review).
    h.detail = detail({
      study: {
        sessions: [],
        contactRequests: [studyContact({ initiatedBy: 'tutor', publishedSearchId: 'ps1' })],
      },
    });
    renderPage();

    expect(await screen.findByText(/contacted this family/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /withdraw request/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, withdraw/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('cancelContactRequest', { requestId: 'r1' }),
    );
    expect(h.callable).not.toHaveBeenCalledWith(
      'respondToTutorContactRequest',
      expect.anything(),
    );
  });

  it('shows the supervision-not-active screen when the backend denies access', async () => {
    h.callable.mockImplementation(() =>
      Promise.reject({
        code: 'functions/failed-precondition',
        details: { code: 'guardian/not-supervised' },
      }),
    );
    renderPage();

    expect(await screen.findByText(/supervision not active/i)).toBeInTheDocument();
    expect(screen.queryByText(/Noa Weiss/)).not.toBeInTheDocument();
  });
});
