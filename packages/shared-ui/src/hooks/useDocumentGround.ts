import { useLayoutEffect } from 'react';

/**
 * Push a shell's ground color all the way to the document canvas (#424).
 *
 * The Recess grounds (#366) live on each layout's `min-h-screen` div, but
 * `html`/`body` carry no background — so iOS Safari's rubber-band overscroll
 * paints the default white canvas past the top/bottom of a tinted page, and
 * every authed route flashes white while AuthGuard resolves (the tinted div
 * is AuthGuard's CHILD and does not exist yet). Both are canvas problems: the
 * overscroll area sits outside every element's box, so no descendant's
 * background — and no `background-color: inherit` trick, which only ever
 * propagates DOWN — can reach it. Only `html`/`body`'s own background does.
 *
 * A blanket `body { background: var(--color-ground) }` in base.css would be
 * wrong for admin, which is neutral by decision 25 (`--color-ground-admin`),
 * and one shared element cannot carry two per-route classes. So each layout
 * declares WHICH ground it sits on by stamping `data-ground` on `<html>`,
 * and base.css turns that into a background with one attribute-selector rule
 * per ground instead of eight imperative style writes.
 *
 * useLayoutEffect, not useEffect: the attribute must be on `html` before the
 * first paint of the mounting shell, or the flash this exists to remove gets
 * one frame to happen in. On a route transition between shells (admin <->
 * regular) React runs the outgoing layout's cleanup before the incoming
 * layout's effect within the same commit, so the attribute can't go stale;
 * the cleanup removes it entirely so public surfaces (PublicLayout is
 * deliberately white) fall back to the default canvas.
 *
 * AuthGuard leans on this: the guard renders inside the layout, so the
 * layout's hook has already stamped the ground while the guard's spinner (or
 * study/do's `null`) is up — the resolve state sits on the right ground with
 * no background of its own, INCLUDING the admin one, which the guard itself
 * has no way to know about.
 */
export function useDocumentGround(ground: 'app' | 'admin'): void {
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-ground', ground);
    return () => {
      document.documentElement.removeAttribute('data-ground');
    };
  }, [ground]);
}
