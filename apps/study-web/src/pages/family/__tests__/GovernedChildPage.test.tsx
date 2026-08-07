import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router';
import { renderWithProviders } from '@/__tests__/test-utils';

// Everything on this page arrives through getGovernedChildDetail; the
// protective controls are callables too. No client Firestore reads.
const h = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>,
  callable: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ functions: {} }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload?: unknown) => h.callable(name, payload),
}));

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
      babysitter: null,
      tutor: {
        subjects: [{ subject: 'math', levels: ['6e', '5e'], rate: 20 }],
        searchable: true,
        enrollmentComplete: true,
      },
    },
    schedule: { weekly: null, overrideCount: 0 },
    study: { sessions: [], contactRequests: [] },
    sit: { appointments: [], contactSharingRequests: [] },
    counts: { references: 0, endorsements: 2 },
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    type: 'one_time',
    status: 'confirmed',
    statusReason: null,
    familyName: 'Cohen',
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
    instances: [],
    ...overrides,
  };
}

function contactRequest(overrides: Record<string, unknown> = {}) {
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
  return renderWithProviders(
    <Routes>
      <Route path="/family/governance/:childUid" element={<GovernedChildPage />} />
    </Routes>,
    '/family/governance/c1',
  );
}

function reset() {
  h.detail = detail();
  h.callable.mockReset();
  h.callable.mockImplementation((name: string) => {
    if (name === 'getGovernedChildDetail') return Promise.resolve({ data: h.detail });
    return Promise.resolve({ data: { success: true } });
  });
}

const detailCalls = () => h.callable.mock.calls.filter((c) => c[0] === 'getGovernedChildDetail');

describe('GovernedChildPage', () => {
  beforeEach(() => reset());

  it('loads the detail for the childUid in the route', async () => {
    renderPage();
    await screen.findByText(/Noa Weiss/);
    expect(h.callable).toHaveBeenCalledWith('getGovernedChildDetail', { childUid: 'c1' });
  });

  // ── Ruling 8 pin: the guardian sees notes and message content. ──
  it('shows session messages and pre/post session notes (full oversight)', async () => {
    h.detail = detail({
      study: { sessions: [session()], contactRequests: [contactRequest()] },
      sit: { appointments: [], contactSharingRequests: [] },
    });
    renderPage();

    expect(await screen.findByText(/Hello from the family/)).toBeInTheDocument();
    expect(screen.getByText(/Bring the workbook/)).toBeInTheDocument();
    expect(screen.getByText(/Great progress today/)).toBeInTheDocument();
    // Contact-request message too.
    expect(screen.getByText(/Could you help our son\?/)).toBeInTheDocument();
  });

  it('shows instance notes when a recurring series is expanded', async () => {
    h.detail = detail({
      study: {
        sessions: [
          session({
            sessionId: 's2',
            type: 'recurring',
            instances: [
              {
                date: '2099-01-17',
                startTime: '17:00',
                endTime: '18:00',
                status: 'scheduled',
                statusReason: null,
                cancellationReason: null,
                lateCancellation: false,
                preSessionNote: 'Chapter 4 revision',
                postSessionNote: null,
              },
            ],
          }),
        ],
        contactRequests: [],
      },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /view dates/i }));
    expect(await screen.findByText(/Chapter 4 revision/)).toBeInTheDocument();
  });

  // ── The no-accept pin: guardian surfaces NEVER render accept affordances. ──
  it('renders NO accept affordance for pending sessions or contact requests', async () => {
    h.detail = detail({
      study: {
        sessions: [session({ sessionId: 's3', status: 'pending' })],
        contactRequests: [contactRequest()],
      },
    });
    renderPage();
    await screen.findByText(/Hello from the family/);

    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    // Both pending items expose decline only.
    expect(screen.getAllByRole('button', { name: /decline/i })).toHaveLength(2);
  });

  it('toggling searchable confirms, calls guardianSetChildSearchable, then refetches', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /tutor search visibility/i }));
    // Nothing sent before the confirm dialog resolves.
    expect(h.callable).not.toHaveBeenCalledWith('guardianSetChildSearchable', expect.anything());

    fireEvent.click(await screen.findByRole('button', { name: /yes, hide/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('guardianSetChildSearchable', {
        childUid: 'c1',
        app: 'study',
        searchable: false,
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('cancelling a confirmed session requires a reason and calls cancelSession, then refetches', async () => {
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

  it('declining a pending session request confirms, calls respondToSession decline, then refetches', async () => {
    h.detail = detail({
      study: { sessions: [session({ sessionId: 's3', status: 'pending' })], contactRequests: [] },
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
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
  });

  it('declining a pending contact request calls respondToTutorContactRequest decline, then refetches', async () => {
    h.detail = detail({ study: { sessions: [], contactRequests: [contactRequest()] } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /decline/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() =>
      expect(h.callable).toHaveBeenCalledWith('respondToTutorContactRequest', {
        requestId: 'r1',
        action: 'decline',
      }),
    );
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
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

  it('does not flash content while the callable is in flight', () => {
    h.callable.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.queryByText(/supervision not active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Noa Weiss/)).not.toBeInTheDocument();
  });
});
