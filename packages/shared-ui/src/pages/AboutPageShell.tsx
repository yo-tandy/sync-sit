import type { ReactNode } from 'react';
import { TopNav } from '../components/TopNav.js';

interface AboutPageShellProps {
  title: string;
  children: ReactNode;
}

export function AboutPageShell({ title, children }: AboutPageShellProps) {
  return (
    <div>
      <TopNav title={title} backTo="back" />
      {children}
    </div>
  );
}
