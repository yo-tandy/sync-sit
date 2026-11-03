import { createContext, useContext, type ReactNode } from 'react';

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
 */
export const HUB_PATHS = {
  profile: '/account/profile',
  family: '/account/family',
  kids: '/account/kids',
  verification: '/account/verification',
} as const;

const InHubContext = createContext(false);

/** Wraps the hub's outlet: every page below it resolves to hub paths. */
export function HubRouteProvider({ children }: { children: ReactNode }) {
  return <InHubContext.Provider value={true}>{children}</InHubContext.Provider>;
}

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
