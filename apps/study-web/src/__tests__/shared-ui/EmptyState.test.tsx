import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { EmptyState, SearchIcon } from '@ejm/shared-ui';

describe('EmptyState (shared-ui)', () => {
  it('renders the icon and the message', () => {
    renderWithProviders(
      <EmptyState icon={<SearchIcon data-testid="icon" />} message="Nothing here yet" />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('actionTo renders a link with the label pointing at the target', () => {
    renderWithProviders(
      <EmptyState
        icon={<SearchIcon />}
        message="Nothing here yet"
        actionLabel="Find a tutor"
        actionTo="/family/search"
      />,
    );
    const link = screen.getByRole('link', { name: 'Find a tutor' });
    expect(link).toHaveAttribute('href', '/family/search');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('onAction renders a button and clicking fires it', () => {
    const onAction = vi.fn();
    renderWithProviders(
      <EmptyState
        icon={<SearchIcon />}
        message="Nothing here yet"
        actionLabel="Clear filters"
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('without action props it degrades to icon + message only', () => {
    renderWithProviders(<EmptyState icon={<SearchIcon />} message="Nothing here yet" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
