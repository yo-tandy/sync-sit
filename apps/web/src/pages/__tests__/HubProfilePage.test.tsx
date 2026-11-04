import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const h = vi.hoisted(() => ({ userDoc: null as unknown }));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { userDoc: unknown }) => unknown) => selector({ userDoc: h.userDoc }),
}));
vi.mock('@/pages/family/AccountPage', () => ({ AccountPage: () => <p>PARENT PROFILE</p> }));
vi.mock('@/pages/babysitter/AccountPage', () => ({
  BabysitterAccountPage: () => <p>STUDENT PROFILE</p>,
}));

import { HubProfilePage } from '../HubProfilePage';

function renderAt(userDoc: unknown) {
  h.userDoc = userDoc;
  render(
    <MemoryRouter initialEntries={['/account/profile']}>
      <Routes>
        <Route path="/account/profile" element={<HubProfilePage />} />
        <Route path="/account" element={<p>SETTINGS HUB</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('HubProfilePage -- the hub\'s one "My account" path', () => {
  afterEach(cleanup);

  it("renders the parent's profile page for a parent", () => {
    renderAt({ uid: 'p1', profiles: { parent: { familyId: 'f1' } } });
    expect(screen.getByText('PARENT PROFILE')).toBeInTheDocument();
  });

  it("renders the student's profile page for a student", () => {
    renderAt({ uid: 's1', profiles: { babysitter: { enrollmentComplete: true } } });
    expect(screen.getByText('STUDENT PROFILE')).toBeInTheDocument();
  });

  it('sends a member with no sit profile back to the hub', () => {
    renderAt({ uid: 't1', profiles: { tutor: { enrollmentComplete: true } } });
    expect(screen.getByText('SETTINGS HUB')).toBeInTheDocument();
  });
});
