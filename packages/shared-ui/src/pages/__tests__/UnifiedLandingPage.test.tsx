import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { UserIcon, UsersIcon } from '../../components/Icons.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { UnifiedLandingPage } from '../UnifiedLandingPage.js';
import type { SignUpRoleOption } from '../SignUpRolePage.js';

afterEach(cleanup);

const roles: SignUpRoleOption[] = [
  { key: 'student', labelKey: 'mock.studentLabel', descKey: 'mock.studentDesc', icon: UserIcon, href: '/enroll/student' },
  { key: 'parent', labelKey: 'mock.parentLabel', descKey: 'mock.parentDesc', icon: UsersIcon, href: '/enroll/parent' },
];

describe('UnifiedLandingPage', () => {
  it('shows all three app names, muting only do with a "coming soon" badge', () => {
    renderWithProviders(<UnifiedLandingPage roles={roles} />);

    expect(screen.getByText('sync/sit')).toBeInTheDocument();
    expect(screen.getByText('sync/study')).toBeInTheDocument();
    expect(screen.getByText('sync/do')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();

    // Exactly one badge -- sit/study get no such treatment.
    expect(screen.getAllByText('Coming soon')).toHaveLength(1);
  });

  it('renders the parent/student choice as role cards linking to their hrefs', () => {
    renderWithProviders(<UnifiedLandingPage roles={roles} />);

    const studentLink = screen.getByRole('link', { name: /mock.studentLabel/ });
    expect(studentLink).toHaveAttribute('href', '/enroll/student');
    const parentLink = screen.getByRole('link', { name: /mock.parentLabel/ });
    expect(parentLink).toHaveAttribute('href', '/enroll/parent');
  });

  it('none of the three app tiles are links -- they are brand identity only, not navigation', () => {
    renderWithProviders(<UnifiedLandingPage roles={roles} />);
    const links = screen.getAllByRole('link').map((el) => el.getAttribute('href'));
    // Only the role cards and the login footer link -- no app-tile hrefs.
    expect(links.sort()).toEqual(['/enroll/parent', '/enroll/student', '/login']);
  });

  it('stamps the neutral admin ground on <html> while mounted, and clears it on unmount', () => {
    expect(document.documentElement.getAttribute('data-ground')).toBeNull();
    const { unmount } = renderWithProviders(<UnifiedLandingPage roles={roles} />);
    expect(document.documentElement.getAttribute('data-ground')).toBe('admin');
    unmount();
    expect(document.documentElement.getAttribute('data-ground')).toBeNull();
  });

  it('offers a login link for an existing account', () => {
    renderWithProviders(<UnifiedLandingPage roles={roles} />);
    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('renders with an empty roles list without crashing (defensive)', () => {
    expect(() => renderWithProviders(<UnifiedLandingPage roles={[]} />)).not.toThrow();
  });
});
