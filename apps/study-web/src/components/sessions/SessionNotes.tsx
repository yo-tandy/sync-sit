import { Button } from '@ejm/shared-ui';

/**
 * Shared read-view of a session's notes plus the viewer's own-kind affordance
 * (V1.1 session notes). Presentation only: it renders whichever of the
 * pre/post notes exist (each with its author label), and — when the viewer may
 * write their kind within its window — an Add/Edit button wired to `onEdit`.
 * When the window is CLOSED but the viewer's own note exists, an author-only
 * Remove button wired to `onRemove` renders instead (issue #255 erasure
 * carve-out). All copy is passed in so the family and tutor contexts keep
 * their own wording (the family authors the pre-note; the tutor the
 * post-note).
 *
 * `onRemove` and `copy.remove` are an all-or-nothing PAIR: the remove button
 * renders only when both are present. Read-only contexts (guardians) omit
 * both; a write context must wire both or its author strands their note.
 *
 * Used both by the SessionInstanceList (per recurring occurrence) and by the
 * one_time rows on each SessionsPage.
 */
export interface SessionNotesCopy {
  fromFamily: string; // label above the family's pre-note
  fromTutor: string; // label above the tutor's post-note
  add: string; // button when the viewer's own note is absent
  edit: string; // button when the viewer's own note exists
  remove?: string; // button when the window is closed but the note is the viewer's
}

interface SessionNotesProps {
  pre?: string;
  post?: string;
  /** Which note THIS viewer authors — the other kind is always read-only. */
  editKind: 'pre' | 'post';
  /** Whether the viewer may write their kind now (role + timing window). */
  canEdit: boolean;
  onEdit: () => void;
  /**
   * Erasure path (issue #255 carve-out, twin of sit's AppointmentNotes):
   * shown when the viewer's own note exists but the edit window is CLOSED —
   * the callable always lets the author clear their own note, so the note
   * must never be stranded.
   */
  onRemove?: () => void;
  copy: SessionNotesCopy;
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="whitespace-pre-wrap text-xs text-gray-700">{text}</p>
    </div>
  );
}

export function SessionNotes({ pre, post, editKind, canEdit, onEdit, onRemove, copy }: SessionNotesProps) {
  const mine = editKind === 'pre' ? pre : post;
  if (pre == null && post == null && !canEdit) return null;
  return (
    <div className="mt-3 space-y-2">
      {pre != null && <NoteBlock label={copy.fromFamily} text={pre} />}
      {post != null && <NoteBlock label={copy.fromTutor} text={post} />}
      {canEdit && (
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {mine != null ? copy.edit : copy.add}
        </Button>
      )}
      {!canEdit && mine != null && onRemove && copy.remove && (
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {copy.remove}
        </Button>
      )}
    </div>
  );
}
