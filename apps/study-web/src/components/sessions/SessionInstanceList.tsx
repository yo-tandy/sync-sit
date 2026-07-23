import { Badge, Button } from '@ejm/shared-ui';
import type { StudySessionInstanceDoc } from '@/types/studySession';

/**
 * Shared renderer for a confirmed recurring series' instance list (tutor +
 * family session pages). Presentation only: it sorts the occurrences by date,
 * shows a status chip (completed / skipped / cancelled), and offers a per-date
 * cancel button for still-scheduled future occurrences. The cancel itself is
 * NON-OPTIMISTIC and owned by the parent (via `onCancelInstance` + `cancelKey`).
 * Copy is passed in so each context keeps its own wording.
 */
export interface InstanceListCopy {
  noOccurrences: string;
  cancelInstance: string;
  statusCompleted: string;
  statusSkipped: string;
  statusCancelled: string;
  // Badge shown on the first materialized occurrence of a trial series (V1.1).
  trial: string;
}

interface SessionInstanceListProps {
  sessionId: string;
  instances: StudySessionInstanceDoc[];
  today: string;
  cancelKey: string | null;
  onCancelInstance: (instance: StudySessionInstanceDoc) => void;
  formatDate: (date: string) => string;
  copy: InstanceListCopy;
  // Per-occurrence session notes (V1.1). The parent owns role + timing (it decides
  // whose note is editable within which window), so it injects the note block for
  // each occurrence; the list stays presentation-only. Omitted → no notes shown.
  renderNotes?: (instance: StudySessionInstanceDoc) => React.ReactNode;
}

export function SessionInstanceList({
  sessionId,
  instances,
  today,
  cancelKey,
  onCancelInstance,
  formatDate,
  copy,
  renderNotes,
}: SessionInstanceListProps) {
  const sorted = [...instances].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const chip = (i: StudySessionInstanceDoc): string | null => {
    if (i.status === 'completed') return copy.statusCompleted;
    if (i.status === 'cancelled')
      return i.statusReason === 'conflict_skip' ? copy.statusSkipped : copy.statusCancelled;
    return null; // scheduled
  };

  return (
    <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      {sorted.length === 0 && <li className="text-xs text-gray-400">{copy.noOccurrences}</li>}
      {sorted.map((i) => {
        const label = chip(i);
        const cancelable = i.status === 'scheduled' && i.date >= today;
        const key = `${sessionId}::${i.instanceId}`;
        // Disable while THIS date's cancel is in flight OR while the whole series
        // is being cancelled (cancelKey === sessionId) — the series cancel voids
        // every date, so per-date actions must lock too.
        const rowBusy = cancelKey === key || cancelKey === sessionId;
        return (
          <li key={i.instanceId} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-700">
                {formatDate(i.date)} · {i.startTime}–{i.endTime}
              </span>
              <span className="flex items-center gap-2">
                {i.isTrial && <Badge variant="blue">{copy.trial}</Badge>}
                {label && <Badge variant="gray">{label}</Badge>}
                {cancelable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rowBusy}
                    onClick={() => onCancelInstance(i)}
                  >
                    {copy.cancelInstance}
                  </Button>
                )}
              </span>
            </div>
            {renderNotes?.(i)}
          </li>
        );
      })}
    </ul>
  );
}
