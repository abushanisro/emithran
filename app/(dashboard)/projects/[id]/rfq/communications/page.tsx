'use client';

import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Mail, Clock, CheckCircle, AlertCircle, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent': return 'bg-blue-100 text-blue-800';
      case 'responded': return 'bg-amber-100 text-amber-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const suppliersInvited = records?.reduce((sum, r) => sum + r.vendorCount, 0);
  const responses = records?.reduce((sum, r) => sum + r.responseCount, 0);
  const stat = (v: number | undefined) => (isLoading || v === undefined ? '—' : v);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link
                href={`/projects/${projectId}/rfq`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to RFQ Management
              </Link>
              <span>/</span>
              <span>Supplier Communications</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Supplier Communications
            </h1>
            <p className="text-sm text-muted-foreground">
              RFQs sent to suppliers and their responses
            </p>
          </div>
        </div>

        {/* TABS */}
        <div className="flex items-center gap-1 border-b">
          {(['active', 'templates', 'history'] as const).map((tab) => (
            <Button
              key={tab}
              variant={selectedTab === tab ? 'default' : 'ghost'}
              className="capitalize"
              onClick={() => { setSelectedTab(tab); }}
            >
              {tab === 'active' && <Mail className="h-4 w-4 mr-2" />}
              {tab === 'templates' && <MessageSquare className="h-4 w-4 mr-2" />}
              {tab === 'history' && <Clock className="h-4 w-4 mr-2" />}
              {tab}
            </Button>
          ))}
        </div>

        {/* ACTIVE COMMUNICATIONS */}
        {selectedTab === 'active' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">RFQs Sent</p>
                      <p className="text-2xl font-bold">{stat(records?.length)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Suppliers Invited</p>
                      <p className="text-2xl font-bold">{stat(suppliersInvited)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">Responses</p>
                      <p className="text-2xl font-bold">{stat(responses)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
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
                    <CardContent className="p-6 space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold">{record.rfqName}</h3>
                        <span className="text-sm text-muted-foreground">{record.rfqNumber}</span>
                        <Badge className={getStatusColor(record.status)}>{record.status}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
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
