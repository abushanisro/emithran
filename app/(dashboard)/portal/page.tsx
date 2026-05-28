'use client';

import Link from 'next/link';
import { Key, Activity, CheckCircle2, Clock, ArrowRight, ExternalLink, Code2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLogStats } from '@/lib/api/hooks/useDeveloper';
import { useApiKeys } from '@/lib/api/hooks/useDeveloper';

export default function DeveloperPortalPage() {
  const { data: stats, isLoading: statsLoading } = useLogStats();
  const { data: keys } = useApiKeys();

  const statCards = [
    {
      label: 'Active API Keys',
      value: keys?.length ?? 0,
      icon: Key,
      color: 'text-primary',
      bg: 'bg-primary/10',
      border: 'border-l-primary',
    },
    {
      label: 'Requests (30d)',
      value: statsLoading ? '...' : (stats?.total ?? 0).toLocaleString(),
      icon: Activity,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-l-blue-500',
    },
    {
      label: 'Success Rate',
      value: statsLoading ? '...' : `${stats?.successRate ?? 0}%`,
      icon: CheckCircle2,
      color: 'text-green-400',
      bg: 'bg-green-500/10',
      border: 'border-l-green-500',
    },
    {
      label: 'Avg Response',
      value: statsLoading ? '...' : `${stats?.avgDurationMs ?? 0}ms`,
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-l-amber-500',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Developer Portal"
        description="Manage API keys, monitor request logs, and access the API reference"
      >
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/developer" target="_blank">
            <ExternalLink className="h-4 w-4" />
            API Reference
          </Link>
        </Button>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label} className={`border-l-4 ${card.border}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-xl ${card.bg} flex items-center justify-center`}>
                  <card.icon className={`h-6 w-6 ${card.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
                  <p className="text-2xl font-bold text-foreground">{card.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Navigation cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="hover:border-primary/40 transition-colors group">
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">API Keys</CardTitle>
            <CardDescription className="text-sm">
              Generate, view, and revoke API keys for authenticating programmatic access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="gap-2 w-full">
              <Link href="/portal/api-keys">
                Manage Keys
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors group">
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
              <Activity className="h-5 w-5 text-blue-400" />
            </div>
            <CardTitle className="text-base">Request Logs</CardTitle>
            <CardDescription className="text-sm">
              View your API request history with status codes, response times, and errors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="gap-2 w-full">
              <Link href="/portal/logs">
                View Logs
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors group">
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center mb-2">
              <Code2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">API Reference</CardTitle>
            <CardDescription className="text-sm">
              Browse the full API reference with interactive examples, Try It, and code snippets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="gap-2 w-full">
              <Link href="/developer" target="_blank">
                Open Docs
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Top endpoints */}
      {stats?.topEndpoints && stats.topEndpoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Endpoints (Last 30 Days)</CardTitle>
            <CardDescription>Most frequently called API endpoints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topEndpoints.map((ep) => (
                <div key={ep.path} className="flex items-center justify-between">
                  <code className="text-xs font-mono text-muted-foreground">{ep.path}</code>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1.5 rounded-full bg-primary/40"
                      style={{ width: `${Math.max(20, (ep.count / (stats.topEndpoints[0]?.count ?? 1)) * 120)}px` }}
                    />
                    <span className="text-xs text-muted-foreground w-16 text-right">
                      {ep.count.toLocaleString()} req
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
