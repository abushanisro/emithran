'use client';

import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { RfqStatusBadge } from '@/components/features/rfq/RfqStatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Mail, Clock, CheckCircle, AlertCircle, MessageSquare } from '@/components/ui/icons';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';

// Supplier communications are the RFQs the backend has recorded as sent
// (GET /rfq/tracking). The backend stores no email templates and no per-email
// log, so those tabs say so instead of showing sample rows.
export default function RFQCommunicationsPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [selectedTab, setSelectedTab] = useState<'active' | 'templates' | 'history'>('active');
  const recordsQuery = useRfqTrackingRecords(projectId);
  const records = recordsQuery.data;
  const { isLoading } = recordsQuery;
  const error = recordsQuery.error as unknown;

  const getStatusTone = (status: string): 'primary' | 'warning' | 'success' | 'destructive' | 'muted' => {
    switch (status) {
      case 'sent': return 'primary';
      case 'responded': return 'warning';
      case 'completed': return 'success';
      case 'cancelled': return 'destructive';
      default: return 'muted';
    }
  };

  const suppliersInvited = records?.reduce((sum, r) => sum + r.vendorCount, 0);
  const responses = records?.reduce((sum, r) => sum + r.responseCount, 0);
  const stat = (v: number | undefined) => (isLoading || v === undefined ? '—' : v);

  const tiles = [
    { label: 'RFQs Sent', icon: Mail, value: stat(records?.length) },
    { label: 'Suppliers Invited', icon: AlertCircle, value: stat(suppliersInvited) },
    { label: 'Responses', icon: CheckCircle, value: stat(responses) },
  ];

  return (
    <div className="animate-fade-in">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to RFQ management" asChild>
            <Link href={`/projects/${projectId}/rfq`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <PageHeader
              title="Supplier Communications"
              description="RFQs sent to suppliers and their responses"
            />
          </div>
        </div>

        {/* Project sections: shared tab bar, RFQ is the active tab */}
        <ProjectNav projectId={projectId} />

        {/* Tabs (shadcn Tabs: same selectedTab state, adds arrow-key navigation) */}
        <Tabs
          value={selectedTab}
          onValueChange={(value) => {
            if (value === 'active' || value === 'templates' || value === 'history') setSelectedTab(value);
          }}
        >
          <TabsList aria-label="Communication views" className="w-full overflow-x-auto">
            <TabsTrigger value="active" className="gap-2">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Active
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Clock className="h-4 w-4" aria-hidden="true" />
              History
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* ACTIVE COMMUNICATIONS */}
        {selectedTab === 'active' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {tiles.map(({ label, icon: Icon, value }) => (
                <Card key={label}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
                    </div>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="space-y-4">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : error ? (
                <Card>
                  <CardContent className="p-6 text-sm text-destructive">
                    Could not load RFQ communications: {error instanceof Error ? error.message : 'unknown error'}
                  </CardContent>
                </Card>
              ) : records && records.length > 0 ? (
                records.map((record) => (
                  <Card key={record.id}>
                    <CardContent className="space-y-3 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-base font-semibold">{record.rfqName}</h3>
                        <span className="text-sm text-muted-foreground">{record.rfqNumber}</span>
                        <RfqStatusBadge tone={getStatusTone(record.status)}>{record.status}</RfqStatusBadge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                        <div>
                          <p className="text-muted-foreground">Vendors</p>
                          <p className="font-medium">
                            {record.vendors.length ? record.vendors.map(v => v.name || 'Unknown vendor').join(', ') : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sent</p>
                          <p className="font-medium">
                            {formatDistanceToNow(new Date(record.sentAt), { addSuffix: true })}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Responses</p>
                          <p className="font-medium">{record.responseCount}/{record.vendorCount}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Mail className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No communications recorded yet</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* EMAIL TEMPLATES */}
        {selectedTab === 'templates' && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No email templates yet. Templates are not stored by the system.</p>
            </CardContent>
          </Card>
        )}

        {/* COMMUNICATION HISTORY */}
        {selectedTab === 'history' && (
          <Card>
            <CardHeader>
              <CardTitle>Communication History</CardTitle>
              <CardDescription>
                Individual emails, reminders and replies are not logged; sent RFQs are listed under Active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">No communications recorded yet</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
