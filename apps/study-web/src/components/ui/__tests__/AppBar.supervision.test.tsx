import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import type { StudyUser } from '@ejm/study-core';

vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}),
}));

const mocks = vi.hoisted(() => ({
  state: {
    userDoc: { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' } as Partial<StudyUser>,
    logout: vi.fn(),
  },
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = () => mocks.state;
  useAuthStore.getState = () => mocks.state;
  return { useAuthStore };
});

import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { AppBar } from '../AppBar';

const governedBy = {
  familyId: 'fam1',
  linkedAt: { seconds: 0, nanoseconds: 0 },
} as StudyUser['governedBy'];

// Same convention as the h-11/w-11 icon targets pinned in
// AppBarSwitchEntry.test.tsx, adapted to a pill: height + min-width.
const CHIP_HIT_TARGET = /\bh-11\b[\s\S]*\bmin-w-11\b|\bmin-w-11\b[\s\S]*\bh-11\b/;

describe('tutor AppBar supervision chip', () => {
  beforeEach(() => {
    mocks.state.userDoc = { firstName: 'Ada', lastName: 'L', email: 'ada@x.com' };
  });

  it('governed tutor: shield chip links to /supervision-info with a 44px target', () => {
    mocks.state.userDoc.governedBy = governedBy;
    renderWithProviders(<AppBar />);
    const chip = screen.getByRole('link', { name: /supervised account/i });
    expect(chip).toHaveAttribute('href', '/supervision-info');
    expect(chip).toHaveTextContent('Supervised');
    expect(chip.className).toMatch(CHIP_HIT_TARGET);
  });

  it('non-governed tutor: no supervision chip', () => {
    renderWithProviders(<AppBar />);
    expect(screen.queryByRole('link', { name: /supervised account/i })).not.toBeInTheDocument();
  });

  it('governed tutor (fr): chip label and aria-label are French', async () => {
    mocks.state.userDoc.governedBy = governedBy;
    await i18n.changeLanguage('fr');
    try {
      renderWithProviders(<AppBar />);
      const chip = screen.getByRole('link', { name: /compte supervisé/i });
      expect(chip).toHaveTextContent('Supervisé');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
