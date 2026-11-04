import type { ReactNode } from 'react';
import { InHubContext } from '@/lib/hubRoutes';

/** Wraps the hub's outlet: every page below it resolves to hub paths. */
export function HubRouteProvider({ children }: { children: ReactNode }) {
  return <InHubContext.Provider value={true}>{children}</InHubContext.Provider>;
}
