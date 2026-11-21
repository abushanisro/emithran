'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface ProjectNavProps {
  projectId: string;
  className?: string;
}

interface ProjectNavTab {
  label: string;
  href: string;
  /** Path prefixes that mark this tab as the current page. */
  match: string[];
  exact?: boolean;
}

/** The project's workflow tabs. Hrefs are the same links the overview page has always used. */
export function getProjectNavTabs(projectId: string): ProjectNavTab[] {
  const base = `/projects/${projectId}`;
  return [
    { label: 'Overview', href: base, match: [base], exact: true },
    { label: 'BOM', href: `/bom?projectId=${projectId}`, match: ['/bom', `${base}/bom`] },
    { label: 'Process Planning', href: `${base}/process-planning`, match: [`${base}/process-planning`] },
    { label: 'RFQ', href: `${base}/rfq`, match: [`${base}/rfq`] },
    { label: 'Supplier Evaluation', href: `${base}/supplier-evaluation`, match: [`${base}/supplier-evaluation`] },
    { label: 'Nomination', href: `${base}/supplier-nomination`, match: [`${base}/supplier-nomination`] },
    { label: 'Production', href: `${base}/production-planning`, match: [`${base}/production-planning`] },
    { label: 'Quality', href: `${base}/quality-control`, match: [`${base}/quality-control`] },
    { label: 'Reports', href: `${base}/reports`, match: [`${base}/reports`] },
  ];
}

export function isProjectNavTabActive(tab: ProjectNavTab, pathname: string): boolean {
  return tab.match.some((prefix) =>
    tab.exact ? pathname === prefix : pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Horizontal project tab bar with an active state, shared by the project pages. */
export function ProjectNav({ projectId, className }: ProjectNavProps) {
  const pathname = usePathname();
  const tabs = getProjectNavTabs(projectId);

  return (
    <nav aria-label="Project sections" className={cn('overflow-x-auto border-b', className)}>
      <ul className="flex min-w-max items-center gap-1">
        {tabs.map((tab) => {
          const active = isProjectNavTabActive(tab, pathname);
          return (
            <li key={tab.label}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
