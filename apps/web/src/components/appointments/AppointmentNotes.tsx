import { Button } from '@/components/ui';

/**
 * Shared read-view of an appointment's notes plus the single edit affordance
 * for the viewer's own note kind (issue #238, parity B2 — port of study's
 * SessionNotes). Presentation only: it renders whichever of the pre/post
 * notes exist (each with its author label), and — when the viewer may write
 * their kind within its window — an Add/Edit button wired to `onEdit`. All
 * copy is passed in so the family and babysitter contexts keep their own
 * wording (the family authors the pre-note; the babysitter the post-note).
 */
export interface AppointmentNotesCopy {
  fromFamily: string; // label above the family's pre-note
  fromBabysitter: string; // label above the babysitter's post-note
  add: string; // button when the viewer's own note is absent
  edit: string; // button when the viewer's own note exists
}

interface AppointmentNotesProps {
  pre?: string;
  post?: string;
  /** Which note THIS viewer authors — the other kind is always read-only. */
  editKind: 'pre' | 'post';
  /** Whether the viewer may write their kind now (role + timing window). */
  canEdit: boolean;
  onEdit: () => void;
  copy: AppointmentNotesCopy;
}

function NoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="whitespace-pre-wrap text-xs text-gray-700">{text}</p>
    </div>
  );
}

export function AppointmentNotes({ pre, post, editKind, canEdit, onEdit, copy }: AppointmentNotesProps) {
  const mine = editKind === 'pre' ? pre : post;
  if (pre == null && post == null && !canEdit) return null;
  return (
    <div className="mt-3 space-y-2">
      {pre != null && <NoteBlock label={copy.fromFamily} text={pre} />}
      {post != null && <NoteBlock label={copy.fromBabysitter} text={post} />}
      {canEdit && (
        <Button size="sm" variant="ghost" fullWidth={false} onClick={onEdit}>
          {mine != null ? copy.edit : copy.add}
        </Button>
      )}
    </div>
  );
}
