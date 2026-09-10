import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, render, cleanup, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  calls: [] as { name: string; payload: unknown }[],
  navigate: vi.fn(),
  auth: {
    firebaseUser: null as unknown,
    userDoc: null as Record<string, unknown> | null,
    loading: false,
  },
  refreshUserDoc: vi.fn(() => Promise.resolve()),
  enrollBabysitterError: null as unknown,
  handoffError: null as unknown,
  assignedUrls: [] as string[],
}));

vi.mock('@/config/firebase', () => ({ functions: {}, db: {}, auth: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    h.calls.push({ name, payload });
    if (name === 'enrollBabysitter') {
      if (h.enrollBabysitterError) return Promise.reject(h.enrollBabysitterError);
      return Promise.resolve({ data: { success: true, uid: 'u1' } });
    }
    if (name === 'createAppHandoffCode') {
      if (h.handoffError) return Promise.reject(h.handoffError);
      return Promise.resolve({ data: { code: 'abc123' } });
    }
    return Promise.resolve({ data: {} });
  },
}));
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  useNavigate: () => h.navigate,
}));
vi.mock('@/stores/authStore', () => {
  const storeState = () => ({
    firebaseUser: h.auth.firebaseUser,
    userDoc: h.auth.userDoc,
    loading: h.auth.loading,
    refreshUserDoc: h.refreshUserDoc,
  });
  return {
    useAuthStore: Object.assign(() => storeState(), {
      getState: () => storeState(),
      subscribe: () => () => {},
    }),
  };
});
vi.mock('@ejm/sit-core', () => ({
  getSitRole: (userDoc: { profiles?: { babysitter?: unknown; parent?: unknown }; isAdmin?: boolean } | null) => {
    if (userDoc?.profiles?.babysitter) return 'babysitter';
    if (userDoc?.profiles?.parent) return 'parent';
    if (userDoc?.isAdmin) return 'admin';
    return undefined;
  },
}));
vi.mock('@/components/ui', () => ({
  Spinner: () => <div>spinner</div>,
}));
vi.mock('@ejm/shared-ui', () => ({
  APP_NAME: { sit: 'sync/sit', study: 'sync/study', do: 'sync/do' },
  BRAND_MARKS: {
    sit: { sm: 'sit.png', md: 'sit@2x.png' },
    study: { sm: 'study.png', md: 'study@2x.png' },
    do: { sm: 'do.png', md: 'do@2x.png' },
  },
  useDocumentGround: () => {},
  LanguageSelector: () => <div>lang-selector</div>,
  enrollmentErrorReason: (err: { details?: { reason?: unknown } } | null) => {
    const reason = err?.details?.reason;
    return reason === 'profile-exists' || reason === 'role-exclusive' || reason === 'send-cap'
      ? reason
      : null;
  },
  ageGateErrorCode: (err: { details?: { code?: unknown } } | null) => {
    const code = err?.details?.code;
    return code === 'age/under-15' || code === 'age/mismatch' ? code : null;
  },
}));

import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/i18n';
import { ChooseAppPage } from '../ChooseAppPage';

const rootOnlyDoc = {
  firstName: 'Iris',
  ejemEmail: 'iris28@ejm.org',
  profiles: {},
};

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ChooseAppPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const originalAssign = window.location.assign;

beforeEach(() => {
  cleanup();
  h.calls.length = 0;
  h.navigate = vi.fn();
  h.auth = { firebaseUser: { uid: 'u1' }, userDoc: rootOnlyDoc, loading: false };
  h.refreshUserDoc = vi.fn(() => Promise.resolve());
  h.enrollBabysitterError = null;
  h.handoffError = null;
  h.assignedUrls = [];
  i18n.changeLanguage('en');
  // window.location.assign is not implemented in jsdom.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: (url: string) => h.assignedUrls.push(url) },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: originalAssign } });
});

describe('ChooseAppPage', () => {
  it('renders sit and study as selectable, and do as disabled with a coming-soon badge', () => {
    renderPage();
    expect(screen.getByText('sync/sit')).toBeInTheDocument();
    expect(screen.getByText('sync/study')).toBeInTheDocument();
    expect(screen.getByText('sync/do')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('unifiedEnrollment.comingSoon'))).toBeInTheDocument();
    // do's tile is not a clickable button — only sit/study are.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  // Decision 20 forbids sit/study reachability INTO do — unaffected by this
  // page's gate accepting a broader set of verified identities (issue #435
  // PR4 review discussion on #474): a sync-do doer-only user reaching this
  // screen still sees do as a disabled "coming soon" tile, not a third
  // option.
  it('do stays a disabled coming-soon tile for a doer-only user too', () => {
    h.auth.userDoc = {
      firstName: 'Dana',
      ejemEmail: 'dana28@ejm.org',
      profiles: { doer: { enrollmentComplete: true } },
    };
    renderPage();
    expect(screen.getByText(i18n.t('unifiedEnrollment.comingSoon'))).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('choosing sit calls enrollBabysitter in crossApp mode and resumes at /enroll/babysitter', async () => {
    renderPage();
    fireEvent.click(screen.getByText('sync/sit'));

    await waitFor(() => {
      expect(h.navigate).toHaveBeenCalledWith('/enroll/babysitter');
    });
    const call = h.calls.find((c) => c.name === 'enrollBabysitter');
    expect(call?.payload).toEqual({ crossApp: true, consentVersion: '1.0' });
    expect(h.refreshUserDoc).toHaveBeenCalled();
  });

  it('choosing study mints a handoff code and navigates to the study handoff URL', async () => {
    renderPage();
    fireEvent.click(screen.getByText('sync/study'));

    await waitFor(() => {
      expect(h.assignedUrls).toHaveLength(1);
    });
    expect(h.calls.some((c) => c.name === 'createAppHandoffCode')).toBe(true);
    expect(h.assignedUrls[0]).toContain('/handoff#code=abc123');
    expect(h.assignedUrls[0]).toContain('lang=en');
  });

  it('surfaces a translated error on enrollBabysitter rejection without navigating', async () => {
    h.enrollBabysitterError = { code: 'functions/failed-precondition', details: { reason: 'role-exclusive' } };
    renderPage();
    fireEvent.click(screen.getByText('sync/sit'));

    const msg = i18n.t('signup.roleExclusiveBabysitter');
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalledWith('/enroll/babysitter');
  });
});
