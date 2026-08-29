import { Link } from 'react-router';

/**
 * The "see all" foot of a capped dashboard section.
 *
 * Both landing pages cap their sections at `SECTION_ROWS` so a dashboard
 * SUMMARISES rather than re-listing what /family/tasks, /doer/offers and
 * /doer/work already own (the owner's redundancy report: `/family` and
 * `/family/tasks` were showing the same rows). A silent cap would be the
 * worse defect of the two — a family with eleven open tasks seeing five and
 * no sign of the rest — so every cap that bites renders this line, and its
 * label carries the FULL count.
 *
 * The label is passed in rather than built here: each section names its own
 * rows ("See all 11 open tasks"), and a generic "See all" would make the six
 * call sites indistinguishable to a screen-reader running the page's link
 * list.
 *
 * A LINK, never a button: it navigates, and the dashboards' standing rule is
 * that a landing page fires no callable — the list page it points at owns
 * every action. Shape borrowed from study's board preview
 * (`PublishedSearchesPreview`'s "See more"), which is the only other
 * summary-with-a-tail surface in the programme.
 */
export function SeeAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="block pt-1 text-sm font-medium text-brand-600 hover:underline"
    >
      {label}
    </Link>
  );
}
