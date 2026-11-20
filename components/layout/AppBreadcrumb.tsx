'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

/** Display names for the fixed URL segments of the app. */
const SEGMENT_LABELS: Partial<Record<string, string>> = {
  projects: 'Projects',
  bom: 'BOM',
  items: 'Items',
  benchmarks: 'Benchmarking',
  vave: 'VAVE',
  vendors: 'Vendors',
  'raw-materials': 'Raw Materials',
  'hr-rates': 'HR Rates',
  'mhr-database': 'MHR Database',
  process: 'Process',
  calculators: 'Calculators',
  builder: 'Builder',
  settings: 'Settings',
  electronics: 'Electronics',
  'process-planning': 'Process Planning',
  'production-planning': 'Production Planning',
  'quality-control': 'Quality Control',
  reports: 'Reports',
  rfq: 'RFQ',
  communications: 'Communications',
  quotes: 'Quotes',
  templates: 'Templates',
  'supplier-evaluation': 'Supplier Evaluation',
  'supplier-evaluations': 'Supplier Evaluation',
  'supplier-nomination': 'Supplier Nomination',
  'supplier-nominations': 'Supplier Nominations',
  'database-viewer': 'Database Viewer',
  'manufacturing-intelligence': 'Manufacturing Intelligence',
};

/** Label for an id-like segment, named after what its parent segment holds. */
const ID_LABELS: Partial<Record<string, string>> = {
  projects: 'Project',
  bom: 'BOM',
  items: 'Item',
  electronics: 'Design',
  'quality-control': 'Inspection',
  'production-planning': 'Lot',
  vendors: 'Vendor',
  calculators: 'Calculator',
  builder: 'Calculator',
  'mhr-database': 'Record',
};

/**
 * Paths that have a page of their own (app/(dashboard)/**). Only these crumbs
 * are links; in-between segments with no page are shown as plain text.
 */
const ROUTABLE: RegExp[] = [
  /^\/(projects|bom|benchmarks|vave|vendors|raw-materials|hr-rates|process|calculators|settings|process-planning|production-planning|supplier-evaluation|supplier-nominations|database-viewer)$/,
  /^\/(vendors|calculators|production-planning|mhr-database)\/[^/]+$/,
  /^\/calculators\/builder\/[^/]+$/,
  /^\/projects\/[^/]+$/,
  /^\/projects\/[^/]+\/(electronics|process-planning|production-planning|quality-control|reports|rfq|supplier-evaluation|supplier-nomination)$/,
  /^\/projects\/[^/]+\/bom\/[^/]+$/,
  /^\/projects\/[^/]+\/electronics\/[^/]+$/,
  /^\/projects\/[^/]+\/quality-control\/[^/]+$/,
  /^\/projects\/[^/]+\/rfq\/(communications|quotes|templates)$/,
  /^\/projects\/[^/]+\/bom\/[^/]+\/items\/[^/]+\/manufacturing-intelligence$/,
  /^\/projects\/[^/]+\/electronics\/[^/]+\/manufacturing-intelligence$/,
];

const isRoutable = (path: string) => ROUTABLE.some((re) => re.test(path));

interface Crumb {
  label: string;
  href: string | null;
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: 'Dashboard', href: '/' }];
  let path = '';
  segments.forEach((segment, i) => {
    path += `/${segment}`;
    const known = SEGMENT_LABELS[segment];
    const parent = segments[i - 1] ?? '';
    const label = known ?? ID_LABELS[parent] ?? 'Details';
    crumbs.push({ label, href: isRoutable(path) ? path : null });
  });
  return crumbs;
}

/** Top-bar breadcrumb built from the current URL; no data is fetched. */
export function AppBreadcrumb() {
  const pathname = usePathname();
  const crumbs = pathname === '/' ? [{ label: 'Dashboard', href: null }] : buildCrumbs(pathname);
  const last = crumbs.length - 1;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap sm:gap-2">
        {crumbs.map((crumb, i) => (
          <Fragment key={`${crumb.label}-${i}`}>
            <BreadcrumbItem className={i === last ? 'min-w-0' : 'hidden md:inline-flex'}>
              {i === last ? (
                <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
              ) : crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <span>{crumb.label}</span>
              )}
            </BreadcrumbItem>
            {i < last && <BreadcrumbSeparator className="hidden md:block" />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
