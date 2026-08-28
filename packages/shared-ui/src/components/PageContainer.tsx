import type { ReactNode } from 'react';

/**
 * Desktop content-width cap for the portal shells (issue #119, UX F5).
 *
 * Wraps each portal layout's routed content in a centered column: reading and
 * form pages get the default `max-w-2xl` cap; grid/table pages opt into the
 * wider `max-w-5xl` tier by putting `data-page-width="wide"` on their root
 * element (picked up via CSS `:has()`, so the opt-in needs no context or
 * double render; the direct-child `>` scoping enforces the on-the-root
 * contract, so a wide component reused deep inside a narrow page cannot
 * widen the route from a distance). Both caps are inert below their own
 * width, which is what keeps the phone shell untouched without any
 * breakpoint prefix.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl has-[>[data-page-width=wide]]:max-w-5xl">
      {children}
    </div>
  );
}
