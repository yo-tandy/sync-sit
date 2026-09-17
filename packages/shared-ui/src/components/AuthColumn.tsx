import type { ReactNode } from 'react';

/**
 * Desktop content-width cap for the auth and enrollment surfaces (issue
 * #528): the sign-in page, every enrollment wizard, and the /enroll landing
 * screens. The sibling of `PageContainer` (portal shells, `max-w-2xl`): a
 * single-column form reads best around 28rem, so this one caps at
 * `max-w-md` and centres. Inert below its own width, which is what keeps
 * the phone rendering byte-identical without any breakpoint prefix.
 *
 * Wraps the whole page root — top bar and step indicator included — so at
 * desktop the wizard reads as one centred column rather than a full-width
 * bar over a narrow form.
 */
export function AuthColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md">{children}</div>;
}
