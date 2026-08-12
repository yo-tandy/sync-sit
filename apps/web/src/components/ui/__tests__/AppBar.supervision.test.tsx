import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import type { SitUser, UserRole } from '@ejm/sit-core';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));

const mocks = vi.hoisted(() => ({
  state: {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' } as Partial<SitUser>,
    logout: vi.fn(),
  },
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => mocks.state;
  useAuthStore.getState = () => mocks.state;
  return { useAuthStore };
});

import i18n from '@/i18n';
import { AppBar } from '../AppBar';

const governedBy = {
  familyId: 'fam1',
  linkedAt: { seconds: 0, nanoseconds: 0 },
} as SitUser['governedBy'];

function renderBar(role: UserRole) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AppBar role={role} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// Same convention as the h-11/w-11 icon targets pinned in AppBar.test.tsx,
// adapted to a pill: height + min-width.
const CHIP_HIT_TARGET = /\bh-11\b[\s\S]*\bmin-w-11\b|\bmin-w-11\b[\s\S]*\bh-11\b/;

describe('babysitter AppBar supervision chip', () => {
  beforeEach(() => {
    cleanup();
    mocks.state.userDoc = { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' };
  });

  it('governed babysitter: shield chip links to /supervision-info with a 44px target', () => {
    mocks.state.userDoc.governedBy = governedBy;
    renderBar('babysitter');
    const chip = screen.getByRole('link', { name: /supervised account/i });
    expect(chip).toHaveAttribute('href', '/supervision-info');
    expect(chip).toHaveTextContent('Supervised');
    expect(chip.className).toMatch(CHIP_HIT_TARGET);
  });

  it('non-governed babysitter: no supervision chip', () => {
    renderBar('babysitter');
    expect(screen.queryByRole('link', { name: /supervised account/i })).not.toBeInTheDocument();
  });

  it.each(['parent', 'admin'] as const)(
    'never renders in the %s bar, even if the doc had governedBy',
    (role) => {
      mocks.state.userDoc.governedBy = governedBy;
      renderBar(role);
      expect(screen.queryByRole('link', { name: /supervised account/i })).not.toBeInTheDocument();
    },
  );

  it('governed babysitter (fr): chip label and aria-label are French', async () => {
    mocks.state.userDoc.governedBy = governedBy;
    await i18n.changeLanguage('fr');
    try {
      renderBar('babysitter');
      const chip = screen.getByRole('link', { name: /compte supervisé/i });
      expect(chip).toHaveTextContent('Supervisé');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
