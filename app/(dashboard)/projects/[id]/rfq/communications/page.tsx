'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Mail, Clock, Users, CheckCircle, AlertCircle, Send, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

// Mock communication data - replace with API call
const mockCommunications = [
  {
    id: '1',
    rfqName: 'RFQ for 1 Part',
    vendors: ['Vendor A', 'Vendor B', 'Vendor C'],
    status: 'sent',
    sentDate: '2024-02-15',
    dueDate: '2024-02-22',
    responses: 2,
    totalVendors: 3,
    lastActivity: '2 hours ago',
    emailsSent: 3,
    reminders: 1,
  },
  {
    id: '2',
    rfqName: 'RFQ for Engine Components',
    vendors: ['Precision Parts Co', 'MetalWorks Inc'],
    status: 'overdue',
    sentDate: '2024-02-10',
    dueDate: '2024-02-17',
    responses: 0,
    totalVendors: 2,
    lastActivity: '3 days ago',
    emailsSent: 4,
    reminders: 2,
  },
];

const communicationTemplates = [
  { name: 'Initial RFQ Email', description: 'First email sent with RFQ details' },
  { name: 'Follow-up Reminder', description: 'Reminder for pending responses' },
  { name: 'Deadline Extension', description: 'Notification of extended deadline' },
  { name: 'RFQ Clarification', description: 'Request for additional information' },
];

export default function RFQCommunicationsPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [selectedTab, setSelectedTab] = useState<'active' | 'templates' | 'history'>('active');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent': return 'bg-blue-100 text-blue-800';
      case 'overdue': return 'bg-red-100 text-red-800';
      case 'completed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

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
              Manage automated emails, follow-ups, and communication with suppliers
            </p>
          </div>
          <Button className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send Manual Email
          </Button>
        </div>

        {/* TABS */}
        <div className="flex items-center gap-1 border-b">
          {['active', 'templates', 'history'].map((tab) => (
            <Button
              key={tab}
              variant={selectedTab === tab ? 'default' : 'ghost'}
              className="capitalize"
              onClick={() => setSelectedTab(tab as any)}
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
            {/* OVERVIEW CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm text-muted-foreground">Emails Sent</p>
                      <p className="text-2xl font-bold">7</p>
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
                      <p className="text-2xl font-bold">2</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">Pending</p>
                      <p className="text-2xl font-bold">3</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-red-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">Overdue</p>
                      <p className="text-2xl font-bold">1</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ACTIVE RFQ COMMUNICATIONS */}
            <div className="space-y-4">
              {mockCommunications.map((comm) => (
                <Card key={comm.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-semibold">{comm.rfqName}</h3>
                          <Badge className={getStatusColor(comm.status)}>
                            {comm.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Vendors</p>
                            <p className="font-medium">{comm.vendors.join(', ')}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Sent Date</p>
                            <p className="font-medium">{comm.sentDate}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Due Date</p>
                            <p className="font-medium">{comm.dueDate}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Responses</p>
                            <p className="font-medium">{comm.responses}/{comm.totalVendors}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                          <span>📧 {comm.emailsSent} emails sent</span>
                          <span>🔔 {comm.reminders} reminders</span>
                          <span>⏰ Last activity: {comm.lastActivity}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Send className="h-3 w-3 mr-1" />
                          Send Reminder
                        </Button>
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* EMAIL TEMPLATES */}
        {selectedTab === 'templates' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Email Templates</h2>
              <Button>Create New Template</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {communicationTemplates.map((template, index) => (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-medium">{template.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {template.description}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm">Edit</Button>
                        <Button variant="outline" size="sm">Use</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* COMMUNICATION HISTORY */}
        {selectedTab === 'history' && (
          <Card>
            <CardHeader>
              <CardTitle>Communication History</CardTitle>
              <CardDescription>
                Complete log of all supplier communications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">Communication History</p>
                <p className="text-sm">Detailed logs will appear here</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}