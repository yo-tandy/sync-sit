import { createContext, useContext } from 'react';

/**
 * The account hub's own copies of the account pages.
 *
 * The hub (`/account`, `AccountLayout`) links to My account, My family,
 * Supervised kids and Verification. Those pages also live inside the
 * family/babysitter portals, under the branded `AppBar`, with a back arrow
 * to the portal home. Opened FROM the hub they must stay in the hub's
 * neutral chrome and go back to the hub -- so the hub mounts the same page
 * components on its own routes, and the pages ask this module where "back"
 * and "the kids list" are rather than hard-coding the portal paths.
 *
 * The footer's Help (and its About / Privacy / Terms / Report pages) and
 * Share are mounted the same way; those pages go "back" in history, which
 * from the hub is the hub's own Help page.
 */
export const HUB_PATHS = {
  profile: '/account/profile',
  family: '/account/family',
  kids: '/account/kids',
  verification: '/account/verification',
  help: '/account/help',
  about: '/account/help/about',
  privacy: '/account/help/privacy',
  terms: '/account/help/terms',
  report: '/account/help/report',
  share: '/account/share',
} as const;

/** True below the hub's outlet (`HubRouteProvider`). */
export const InHubContext = createContext(false);


/**
 * Where an account page's links point, depending on which shell mounted it.
 * `back(portalPath)` is the hub itself inside the hub, else the portal path
 * the page always used; `kidsBase` roots the supervised-kids pages.
 */
export function useHubPaths() {
  const inHub = useContext(InHubContext);
  return {
    inHub,
    back: (portalPath: string) => (inHub ? '/account' : portalPath),
    kidsBase: inHub ? HUB_PATHS.kids : '/family/governance',
  };
}
