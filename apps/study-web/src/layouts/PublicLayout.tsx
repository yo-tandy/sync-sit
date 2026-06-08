import { Outlet } from 'react-router';

export function PublicLayout() {
  return (
    <div className="min-h-screen bg-white">
      <Outlet />
    </div>
  );
}
