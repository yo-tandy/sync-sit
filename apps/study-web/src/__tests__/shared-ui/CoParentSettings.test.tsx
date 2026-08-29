import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { CoParentSettings, type CoParentMember } from '@ejm/shared-ui';

/**
 * CoParentSettings is shared chrome that study renders for the first time
 * (issue #340), so it is exercised here against STUDY's own i18n instance:
 * a key that only sit's catalogue defines renders as the raw key string in
 * this app, and only a study-side render catches that.
 */
const MEMBERS: CoParentMember[] = [
  { uid: 'me', name: 'Claire Moreau' },
  { uid: 'other', name: 'Marc Moreau' },
];

function renderSettings(overrides: Partial<Parameters<typeof CoParentSettings>[0]> = {}) {
  const props = {
    members: MEMBERS,
    loading: false,
    currentUid: 'me',
    inviteLink: null,
    generating: false,
    error: null,
    copied: false,
    onGenerate: vi.fn(),
    onCopy: vi.fn(),
    onRemove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  renderWithProviders(<CoParentSettings {...props} />);
  return props;
}

/**
 * Open the confirm dialog from the member row, then press its confirm.
 * Both buttons read 'Remove', so the row button is taken before the dialog
 * exists and the dialog's own button is resolved inside the dialog.
 */
function openConfirmAndAccept() {
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
}

describe('CoParentSettings (shared-ui, study i18n)', () => {
  it('every label it renders resolves in this app\'s catalogue', () => {
    renderSettings();
    // i18next is configured without a missing-key handler, so an absent key
    // renders as the key itself. Assert on the resolved English strings and
    // then sweep the subtree for anything still shaped like a key.
    expect(screen.getByRole('heading', { name: 'Co-Parent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Family members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate invite link' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(menu|invite|coParent|common)\.[a-zA-Z]/);
  });

  it('marks the current user and offers removal only for the others', () => {
    renderSettings();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  it('surfaces a failed removal in the dialog instead of failing silently', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('You cannot remove yourself'));
    renderSettings({ onRemove });

    openConfirmAndAccept();

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You cannot remove yourself',
    );
    // The dialog must stay open so the message is reachable, and the confirm
    // must be usable again rather than stuck in its pending state.
    expect(within(dialog).getByRole('heading', { name: 'Remove Co-Parent' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('falls back to the generic message when the rejection carries none', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error(''));
    renderSettings({ onRemove });
    openConfirmAndAccept();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'An error occurred',
    );
  });

  it('clears a previous failure when the dialog is reopened', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('You cannot remove yourself'));
    renderSettings({ onRemove });

    openConfirmAndAccept();
    await within(screen.getByRole('dialog')).findByRole('alert');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull(),
    );
  });

  it('shows a generate failure whether or not a link already exists', () => {
    // onGenerate doubles as "New link" once a link exists, so an error
    // confined to the no-link branch makes a failed regeneration silent
    // (PR #343 round 3).
    renderSettings({ error: 'Could not generate a link', inviteLink: null });
    expect(screen.getByText('Could not generate a link')).toBeInTheDocument();
    cleanup();

    renderSettings({ error: 'Could not generate a link', inviteLink: 'https://x/invite/tok' });
    expect(screen.getByRole('button', { name: 'New link' })).toBeInTheDocument();
    expect(screen.getByText('Could not generate a link')).toBeInTheDocument();
  });

  it('renders the French catalogue with its diacritics intact', async () => {
    await i18n.changeLanguage('fr');
    try {
      renderSettings();
      // Accent-stripped copy is still valid JS and renders fine, so only an
      // assertion on the accented form catches it (PR #343 round 3).
      expect(screen.getByText(/Générer un lien d'invitation/)).toBeInTheDocument();
      expect(screen.getByText(/Invitez un autre parent à rejoindre/)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/Generer|Invitez un autre parent a rejoindre/);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('closes the dialog when the removal succeeds', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderSettings({ onRemove });
    openConfirmAndAccept();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Remove Co-Parent' })).toBeNull(),
    );
    expect(onRemove).toHaveBeenCalledWith(MEMBERS[1]);
    expect(screen.queryByText('You cannot remove yourself')).toBeNull();
  });
});
