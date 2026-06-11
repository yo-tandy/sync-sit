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
      <div className="px-5 pt-4 pb-20 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </div>
  );
}
