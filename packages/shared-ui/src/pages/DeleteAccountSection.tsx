import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { Input } from '../components/Input.js';
import { LogOutIcon, TrashIcon } from '../components/Icons.js';
import { accountDeleteErrorCode, callableErrorCode } from '../utils/callableErrors.js';

/**
 * The word `deleteMyAccount`'s own guard requires in its payload
 * (`packages/shared-functions/src/account/deleteMyAccount.ts`,
 * `CONFIRMATION_TOKEN`). Fixed, never localised — the server comment
 * explains why: a French member types the SAME word, so the server never
 * has to know which locale sent the request. The French copy below keeps
 * this literal English word inside its sentence for the same reason; do not
 * translate it.
 */
const CONFIRM_WORD = 'DELETE';

/**
 * Maps a `deleteMyAccount` rejection to this dialog's own message key.
 * Mirrors `CoParentSettings.tsx`'s `removeErrorKey` / `UsersPage.tsx`'s
 * confirm-error mapping: a code, never `err.message` (the callable's own
 * guard messages are English-only server strings).
 */
function deleteErrorKey(err: unknown): string {
  // Checked FIRST: `admin/last-admin` is carried as `details.code` on a
  // `failed-precondition`, the SAME top-level code the plain re-auth guard
  // below throws with no details at all -- so the specific case has to be
  // read before the generic one, not after.
  if (accountDeleteErrorCode(err) === 'admin/last-admin') {
    return 'accountHub.deleteErrorLastAdmin';
  }
  if (callableErrorCode(err) === 'failed-precondition') {
    return 'accountHub.deleteErrorReauth';
  }
  return 'common.error';
}

export interface DeleteAccountSectionProps {
  /** Sign out — no confirmation, mirrors the app bar's own row. */
  onSignOut: () => void | Promise<void>;
  /**
   * Calls the `deleteMyAccount` callable (`{ confirm: 'DELETE' }`). Its
   * rejection shape is what `deleteErrorKey` reads — pass the callable's
   * promise through unchanged, do not catch it upstream.
   */
  onDeleteAccount: () => Promise<void>;
  /**
   * Called once the callable AND sign-out have both resolved, so the host
   * can navigate to the post-deletion page. Never called on failure.
   */
  onDeleted: () => void;
}

/**
 * The account hub footer (#491, `AccountHome`'s `footer` slot — its
 * docstring has reserved this for "sign out, delete account" since #367).
 *
 * Presentational plus the destructive dialog, no firebase dependency
 * (mirrors `CoParentSettings`): each host app supplies the three actions and
 * this owns the confirmation gate, the error mapping, and the styling — so
 * the destructive affordance cannot drift between sit, study and do as each
 * one wires `AccountHome` in turn.
 */
export function DeleteAccountSection({
  onSignOut,
  onDeleteAccount,
  onDeleted,
}: DeleteAccountSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    // A confirm in flight must not be yanked out from under itself by an
    // Escape/backdrop close (the Dialog issues both) — the request already
    // committed the server side of an irreversible action.
    if (deleting) return;
    setOpen(false);
    setConfirmText('');
    setError('');
  };

  const confirmMatches = confirmText === CONFIRM_WORD;

  const handleDelete = async () => {
    if (!confirmMatches || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await onDeleteAccount();
    } catch (err: unknown) {
      // Only the ERASURE's own rejection is mapped and shown -- the account
      // still exists, the dialog stays open, and the button re-enables so
      // the member can retry or read why.
      setError(t(deleteErrorKey(err)));
      setDeleting(false);
      return;
    }
    // The erasure already succeeded past this point: the account is gone
    // either way, so a sign-out failure is NOT a delete failure and must
    // never show the delete-failed copy or re-enable a button whose account
    // no longer exists (review round 1). Best-effort and swallowed, same
    // shape as the server's own post-erasure notification sends.
    try {
      await onSignOut();
    } catch (err: unknown) {
      console.error('[account] sign-out after deletion failed', err);
    }
    onDeleted();
  };

  return (
    <>
      {/* focus-ring-inset (issue #325's opt-in), mirroring AccountHome's own
          row list: overflow-hidden clips the rounded corners, the rows are
          full-bleed (px-4 py-3, no gap from the <ul>), so a focused row's
          ring at the default 2px offset is cut off on every edge. The
          opt-in draws it inside the row instead. */}
      <ul className="focus-ring-inset overflow-hidden rounded-lg border border-gray-200 bg-white">
        <li>
          <button
            type="button"
            onClick={() => void onSignOut()}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
          >
            <LogOutIcon className="h-4 w-4 shrink-0 text-gray-500" />
            <span className="text-sm font-semibold text-gray-900">{t('common.signOut')}</span>
          </button>
        </li>
        <li className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-error-50"
          >
            <TrashIcon className="h-4 w-4 shrink-0 text-error-600" />
            <span className="text-sm font-semibold text-error-600">
              {t('accountHub.deleteMyAccount')}
            </span>
          </button>
        </li>
      </ul>

      <Dialog open={open} onClose={close} ariaLabel={t('accountHub.deleteDialogTitle')}>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">
          {t('accountHub.deleteDialogTitle')}
        </h3>
        <p className="mb-4 text-sm text-gray-600">{t('accountHub.deleteDialogBody')}</p>
        <Input
          label={t('accountHub.deleteConfirmLabel', { word: CONFIRM_WORD })}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_WORD}
          disabled={deleting}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {error && (
          <p className="mb-4 text-sm text-error-600" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={close} disabled={deleting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={!confirmMatches || deleting}
          >
            {deleting ? '...' : t('accountHub.deleteConfirmButton')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
