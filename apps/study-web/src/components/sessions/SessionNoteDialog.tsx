import { useState } from 'react';
import { Button, Dialog } from '@ejm/shared-ui';

/**
 * Shared write dialog for a session note (V1.1). Serves the family's pre-note and
 * the tutor's post-note alike — copy is passed in per context.
 *
 * Like ReasonModal, the inner form renders ONLY while the Dialog is open (Dialog
 * returns null when closed), so it remounts fresh on every open and the textarea
 * seeds cleanly from `initialText` — no reset effect. The save is NON-OPTIMISTIC:
 * the parent passes `submitting` (disables the actions in-flight) and `error`, and
 * closes the dialog itself only after its callable resolves. An EMPTY save is
 * allowed and clears the note (the callable deletes the field), so Save is gated
 * only on `submitting`, never on emptiness.
 */
export interface SessionNoteDialogProps {
  open: boolean;
  title: string;
  description: string;
  placeholder: string;
  initialText: string;
  saveLabel: string;
  cancelLabel: string;
  maxLength: number;
  submitting: boolean;
  error?: string | null;
  onSave: (text: string) => void;
  onClose: () => void;
}

export function SessionNoteDialog({ open, onClose, ...rest }: SessionNoteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <NoteForm onClose={onClose} {...rest} />
    </Dialog>
  );
}

function NoteForm({
  title,
  description,
  placeholder,
  initialText,
  saveLabel,
  cancelLabel,
  maxLength,
  submitting,
  error,
  onSave,
  onClose,
}: Omit<SessionNoteDialogProps, 'open'>) {
  const [text, setText] = useState(initialText);
  return (
    <>
      <h3 className="mb-2 text-lg font-bold">{title}</h3>
      <p className="mb-3 text-sm text-gray-600">{description}</p>
      <textarea
        className="mb-1 w-full rounded-lg border border-gray-300 p-2 text-sm"
        rows={5}
        maxLength={maxLength}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
      />
      <p className="mb-3 text-right text-[11px] text-gray-400">
        {text.length}/{maxLength}
      </p>
      {error && <p className="mb-3 text-sm text-brand-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={submitting}
          onClick={() => onSave(text)}
        >
          {saveLabel}
        </Button>
        <Button variant="ghost" className="flex-1" disabled={submitting} onClick={onClose}>
          {cancelLabel}
        </Button>
      </div>
    </>
  );
}
