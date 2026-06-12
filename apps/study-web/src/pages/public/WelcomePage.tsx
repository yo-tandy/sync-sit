import { WelcomePage as SharedWelcomePage } from '@ejm/shared-ui';

// Sync-study does not auto-redirect logged-in users from welcome yet —
// no per-role dashboards exist. Leaving redirectPath unset until Plan D
// + tutor dashboard land.
export function WelcomePage() {
  return <SharedWelcomePage logoSrc="/logo.png" logoAlt="Sync/Study" />;
}
