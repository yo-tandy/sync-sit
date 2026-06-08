import { Outlet } from 'react-router';

// Placeholder for future auth guard — just renders children for this PR.
export function AuthGuard() {
  return <Outlet />;
}
