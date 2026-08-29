/**
 * Pulse-animated placeholder for a loading list row (UX F12, issue #126).
 * Renders the Card idiom (same rounded/border/padding as <Card>) with grey
 * bars sized like a real row, so the list keeps its footprint while data
 * loads and nothing jumps when content lands.
 *
 * Use 2-3 of these in place of a centered list-area <Spinner>; spinners stay
 * for buttons and inline actions. `avatar` prepends a circle for lists whose
 * rows lead with an <Avatar> (md, h-12 w-12).
 *
 * Motion: the pulse is `motion-safe:` so users who ask for reduced motion get
 * a static placeholder (on top of the global base.css animation collapse).
 * The whole card is aria-hidden — screen readers should hear the page's real
 * loading/loaded announcements, not a decorative placeholder.
 */
interface SkeletonCardProps {
  /** Number of grey bars (default 3). */
  lines?: number;
  /** Prepend an avatar-sized circle, for lists whose rows lead with one. */
  avatar?: boolean;
  className?: string;
}

// Cycle of bar widths: a shortish title line, a full body line, a trailing
// meta line. Repeats for lines > 3 so tall skeletons still look organic.
const barWidths = ['w-3/5', 'w-full', 'w-2/5'];

export function SkeletonCard({ lines = 3, avatar = false, className = '' }: SkeletonCardProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton-card"
      className={`motion-safe:animate-pulse rounded-lg border border-gray-200 bg-ground-raised p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        {avatar && <div className="h-12 w-12 flex-shrink-0 rounded-full bg-gray-200" />}
        <div className="min-w-0 flex-1 space-y-3 py-0.5">
          {Array.from({ length: Math.max(1, lines) }, (_, i) => (
            <div key={i} className={`h-3.5 rounded bg-gray-200 ${barWidths[i % barWidths.length]}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
