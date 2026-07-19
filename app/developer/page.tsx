import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Shield,
  FolderKanban,
  FileText,
  Users,
  Database,
  Settings,
  Calculator,
  Factory,
  Sigma,
  GitCompare,
  ArrowRight,
  Zap,
  Lock,
  Code2,
  User,
  Key,
  Activity,
  ClipboardList,
  Cpu,
  GitMerge,
  Layers,
  DollarSign,
  Package,
  Wrench,
  Truck,
  CheckSquare,
  Star,
  Award,
  BarChart3,
  FileSearch,
} from 'lucide-react';
import { API_SPEC } from '@/lib/docs/api-spec';
import { getFirstEndpoint } from '@/lib/docs/docs-navigation';

export const metadata: Metadata = {
  title: 'Mithran API — Developer Documentation',
  description:
    'Integrate with the Mithran manufacturing platform. REST API for BOM management, cost analysis, production planning, and vendor management.',
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  FolderKanban,
  FileText,
  List: FileText,
  Users,
  Database,
  Settings,
  Calculator,
  Factory,
  Sigma,
  GitCompare,
  User,
  Key,
  Activity,
  ClipboardList,
  Cpu,
  GitMerge,
  Layers,
  DollarSign,
  Package,
  Wrench,
  Truck,
  CheckSquare,
  Star,
  Award,
  BarChart3,
  Zap,
  FileSearch,
};

const CATEGORY_MAP: Record<string, string[]> = {
  'Auth & Setup': ['authentication', 'profile', 'developer'],
  'Core Data': ['projects', 'bom', 'bom-items', 'raw-materials', 'vendors'],
  'Manufacturing': ['processes', 'process-routes', 'production-planning', 'quality-control', 'vave'],
  'Costing': ['cost-analysis', 'calculators', 'lhr', 'mhr'],
  'Procurement': ['rfq', 'supplier-evaluation', 'supplier-nominations', 'vendor-quotes', 'delivery', 'benchmarks'],
};

const QUICKSTART = [
  { step: '1', title: 'Get your token', description: 'Authenticate with your Mithran credentials to receive a JWT access token.' },
  { step: '2', title: 'Make your first request', description: 'Use the token to call any endpoint. All requests require Bearer authentication.' },
  { step: '3', title: 'Explore the reference', description: 'Browse the full API reference to discover all available endpoints.' },
];

export default function DeveloperLandingPage() {
  const firstEndpoint = getFirstEndpoint(API_SPEC);

  const groupsByCategory: Record<string, typeof API_SPEC.groups> = {};
  const otherGroups: typeof API_SPEC.groups = [];

  API_SPEC.groups.forEach((group) => {
    let found = false;
    for (const [category, ids] of Object.entries(CATEGORY_MAP)) {
      if (ids.includes(group.id)) {
        if (!groupsByCategory[category]) groupsByCategory[category] = [];
        groupsByCategory[category].push(group);
        found = true;
        break;
      }
    }
    if (!found) otherGroups.push(group);
  });

  const categories = Object.keys(CATEGORY_MAP).filter((c) => groupsByCategory[c]?.length > 0);
  if (otherGroups.length > 0) categories.push('Other');

  return (
    <main className="max-w-5xl mx-auto px-6 py-16">
      {/* Hero */}
      <div className="mb-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary font-medium mb-6">
          <Zap className="h-3 w-3" />
          REST API · v{API_SPEC.version}
        </div>
        <h1 className="text-4xl font-bold text-foreground tracking-tight mb-4">
          Build with Mithran
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl leading-relaxed">
          Integrate the Mithran manufacturing platform into your workflows. Access BOM management,
          cost analysis, production planning, and vendor management via a clean REST API.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-8">
          {firstEndpoint && (
            <Link
              href={`/developer/api-reference/${firstEndpoint.section}/${firstEndpoint.endpoint}`}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              API Reference
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
          <Link
            href="/settings?tab=portal"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
          >
            <Lock className="h-4 w-4" />
            Developer Portal
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mb-16 rounded-xl border border-border/60 bg-muted/10 p-4 flex flex-wrap gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">{API_SPEC.groups.length}</p>
          <p className="text-xs text-muted-foreground">API groups</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">{API_SPEC.groups.reduce((sum, g) => sum + g.endpoints.length, 0)}</p>
          <p className="text-xs text-muted-foreground">Endpoints</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">4</p>
          <p className="text-xs text-muted-foreground">Code languages</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">REST</p>
          <p className="text-xs text-muted-foreground">Architecture</p>
        </div>
      </div>

      {/* Base URL */}
      <div className="mb-16 rounded-xl border border-border/60 bg-muted/20 p-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">Base URL</h2>
        <code className="text-sm font-mono text-primary bg-primary/10 px-3 py-2 rounded-lg">
          {API_SPEC.baseUrl}
        </code>
        <p className="text-sm text-muted-foreground mt-3">
          All API requests must be made over HTTPS. The API accepts JSON request bodies and returns
          JSON responses with a consistent envelope format.
        </p>
        <div className="mt-4 rounded-lg border border-border/40 bg-muted/10 p-4">
          <p className="text-xs text-muted-foreground font-medium mb-2">Response envelope</p>
          <pre className="text-xs text-foreground/70 font-mono leading-relaxed">{`{
  "success": true,
  "data": { ... },
  "metadata": {
    "timestamp": "2025-01-15T10:00:00Z",
    "requestId": "req_abc123"
  }
}`}</pre>
        </div>
      </div>

      {/* Authentication */}
      <div className="mb-16">
        <h2 className="text-xl font-bold text-foreground mb-6">Authentication</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">JWT Token</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{API_SPEC.authenticationMethods.jwt.description}</p>
            <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              {API_SPEC.authenticationMethods.jwt.header}
            </code>
          </div>
          <div className="rounded-xl border border-border/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Code2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">API Key</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">{API_SPEC.authenticationMethods.apiKey.description}</p>
            <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              {API_SPEC.authenticationMethods.apiKey.header}
            </code>
          </div>
        </div>
      </div>

      {/* Quickstart */}
      <div className="mb-16">
        <h2 className="text-xl font-bold text-foreground mb-6">Quickstart</h2>
        <div className="space-y-4">
          {QUICKSTART.map((item) => (
            <div key={item.step} className="flex gap-4">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                {item.step}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Reference — grouped by category */}
      <div>
        <h2 className="text-xl font-bold text-foreground mb-8">API Reference</h2>
        <div className="space-y-10">
          {categories.map((category) => {
            const groups = category === 'Other' ? otherGroups : (groupsByCategory[category] ?? []);
            if (groups.length === 0) return null;
            return (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-4 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border/40" />
                  {category}
                  <span className="h-px flex-1 bg-border/40" />
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {groups.map((group) => {
                    const Icon = group.icon ? (ICON_MAP[group.icon] ?? Code2) : Code2;
                    const firstEp = group.endpoints[0];
                    const previewSummaries = group.endpoints.slice(0, 3).map((ep) => ep.summary).join(' · ');
                    return (
                      <Link
                        key={group.id}
                        href={
                          firstEp
                            ? `/developer/api-reference/${group.id}/${firstEp.id}`
                            : `/developer/api-reference/${group.id}`
                        }
                        className="rounded-xl border border-border/60 p-5 hover:border-primary/40 hover:bg-muted/20 transition-all group"
                      >
                        <div className="flex items-center gap-2.5 mb-3">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed mb-2 line-clamp-2">
                          {group.description}
                        </p>
                        {previewSummaries && (
                          <p className="text-[11px] text-muted-foreground/60 line-clamp-1 mb-3">
                            {previewSummaries}
                          </p>
                        )}
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                          <span>{group.endpoints.length} endpoints</span>
                          <ArrowRight className="h-3 w-3" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
