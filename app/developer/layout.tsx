import type { ReactNode } from 'react';
import { DocsNavbar } from '@/components/docs/DocsNavbar';
import { API_SPEC } from '@/lib/docs/api-spec';

export default function DeveloperLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <DocsNavbar spec={API_SPEC} />
      {children}
    </div>
  );
}
