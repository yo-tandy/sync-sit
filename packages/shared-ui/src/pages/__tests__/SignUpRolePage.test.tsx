import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { UserIcon, UsersIcon } from '../../components/Icons.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { SignUpRolePage, type SignUpRoleOption } from '../SignUpRolePage.js';

afterEach(cleanup);

// Regression coverage for the RoleOptionCard extraction (issue #435
// milestone, PR3): SignUpRolePage had no tests of its own before this PR
// (only the consuming apps' orchestrator tests stub it out entirely), and
// this PR changes how its role cards render internally. Pins that the
// visible output is unchanged.
const roles: SignUpRoleOption[] = [
  { key: 'babysitter', labelKey: 'mock.babysitterLabel', descKey: 'mock.babysitterDesc', icon: UserIcon, href: '/signup/babysitter' },
  { key: 'parent', labelKey: 'mock.parentLabel', descKey: 'mock.parentDesc', icon: UsersIcon, href: '/signup/parent' },
];

describe('SignUpRolePage', () => {
  it('renders one card per role, linking to its href, after the RoleOptionCard extraction', () => {
    renderWithProviders(<SignUpRolePage logoSrc="/logo.png" roles={roles} />);

    const babysitterLink = screen.getByRole('link', { name: /mock.babysitterLabel/ });
    expect(babysitterLink).toHaveAttribute('href', '/signup/babysitter');
    expect(screen.getByText('mock.babysitterDesc')).toBeInTheDocument();

    const parentLink = screen.getByRole('link', { name: /mock.parentLabel/ });
    expect(parentLink).toHaveAttribute('href', '/signup/parent');
  });

  it('shows an optional cross-app banner above the cards', () => {
    renderWithProviders(<SignUpRolePage logoSrc="/logo.png" roles={roles} banner="Pick a role to add" />);
    expect(screen.getByText('Pick a role to add')).toBeInTheDocument();
  });
});
