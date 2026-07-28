import { useState } from 'react';
import { Button, Dialog } from '@ejm/shared-ui';

/**
 * A shared cancellation-reason modal for the session pages (tutor + family).
 *
 * The reason textarea + ≥3-char gate live in the inner ReasonForm, which is
 * rendered ONLY while the Dialog is open (Dialog returns null when closed). That
 * remounts the form fresh on every open, so a prior reason never leaks into the
 * next target — no reset effect needed. It calls `onConfirm(trimmedReason)` only
 * when confirm is pressed. The parent keeps the cancel NON-OPTIMISTIC: it passes
 * `submitting` (disables both actions in-flight) and `error`, and closes the
 * modal itself only after its callable resolves. All copy is passed in so each
 * context keeps its own wording (the tutor tells the family; the family the tutor).
 */
export interface ReasonModalProps {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  keepLabel: string;
  submitting: boolean;
  error?: string | null;
  // Optional amber heads-up shown ABOVE the reason field (e.g. a late-cancel
  // warning, V2 feature 7). Purely informational — it changes no behavior.
  warning?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export function ReasonModal({ open, onClose, ...rest }: ReasonModalProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <ReasonForm onClose={onClose} {...rest} />
    </Dialog>
  );
}

function ReasonForm({
  title,
  description,
  placeholder,
  confirmLabel,
  keepLabel,
  submitting,
  error,
  warning,
  onConfirm,
  onClose,
}: Omit<ReasonModalProps, 'open'>) {
  const [reason, setReason] = useState('');
  return (
    <>
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      <p className="mb-3 text-sm text-gray-600">{description}</p>
      {warning && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{warning}</p>
      )}
      <textarea
        className="mb-3 w-full rounded-lg border border-gray-300 p-2 text-sm"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
      />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={reason.trim().length < 3 || submitting}
          onClick={() => onConfirm(reason.trim())}
        >
          {confirmLabel}
        </Button>
        <Button variant="ghost" className="flex-1" disabled={submitting} onClick={onClose}>
          {keepLabel}
        </Button>
      </div>
    </>
  );
}
