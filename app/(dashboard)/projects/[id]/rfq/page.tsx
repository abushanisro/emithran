'use client';

import { useParams } from 'next/navigation';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileText, Send, Users, Calendar, Clock, DollarSign, CheckCircle } from 'lucide-react';
import Link from 'next/link';

export default function RFQPage() {
  const params = useParams();
  const projectId = params.id as string;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* BREADCRUMB & HEADER */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link 
                href={`/projects/${projectId}`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Project
              </Link>
              <span>/</span>
              <span>RFQ Management</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Request for Quotation (RFQ) Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Create and manage RFQ processes with nominated suppliers
            </p>
          </div>
          <Button className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Create New RFQ
          </Button>
        </div>

        {/* OVERVIEW CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active RFQs</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">8</div>
              <p className="text-xs text-muted-foreground">
                Currently in process
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Suppliers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">15</div>
              <p className="text-xs text-muted-foreground">
                Invited to quote
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Responses</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">12</div>
              <p className="text-xs text-muted-foreground">
                Quotes received
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">3.2</div>
              <p className="text-xs text-muted-foreground">
                Days to respond
              </p>
            </CardContent>
          </Card>
        </div>

        {/* MAIN CONTENT */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ACTIVE RFQS */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Active RFQs
              </CardTitle>
              <CardDescription>
                Current RFQ processes and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">RFQ-001 - Mechanical Components</p>
                    <p className="text-sm text-muted-foreground">5 suppliers invited • Due: Tomorrow</p>
                  </div>
                  <Badge>Active</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">RFQ-002 - Electronic Parts</p>
                    <p className="text-sm text-muted-foreground">3 suppliers invited • Due: 3 days</p>
                  </div>
                  <Badge variant="secondary">Pending</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">RFQ-003 - Raw Materials</p>
                    <p className="text-sm text-muted-foreground">8 suppliers invited • Due: 1 week</p>
                  </div>
                  <Badge variant="outline">Draft</Badge>
                </div>
                
                <Button className="w-full">
                  View All RFQs
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SUPPLIER RESPONSES */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5" />
                Supplier Responses
              </CardTitle>
              <CardDescription>
                Track quotations and supplier engagement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">ABC Manufacturing</p>
                    <p className="text-sm text-muted-foreground">Quote: ₹2,45,000 • Response time: 2 days</p>
                  </div>
                  <Badge>Received</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">XYZ Industries</p>
                    <p className="text-sm text-muted-foreground">Quote: ₹2,38,000 • Response time: 1 day</p>
                  </div>
                  <Badge>Received</Badge>
                </div>
                
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Delta Components</p>
                    <p className="text-sm text-muted-foreground">Invited • Deadline: Tomorrow</p>
                  </div>
                  <Badge variant="outline">Pending</Badge>
                </div>
                
                <Button className="w-full">
                  Compare All Quotes
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* RFQ TEMPLATES & MANAGEMENT */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              RFQ Templates & Management
            </CardTitle>
            <CardDescription>
              Standard templates and RFQ process management tools
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Standard Templates</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Pre-configured RFQ templates for different part categories
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Browse Templates
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Quote Comparison</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Side-by-side comparison of supplier quotations
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Compare Quotes
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Supplier Communication</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Automated emails and follow-up reminders
                </p>
                <Button variant="outline" size="sm" className="w-full">
                  Manage Communications
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QUOTE ANALYSIS */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Quote Analysis & Selection
            </CardTitle>
            <CardDescription>
              Analyze received quotes and make informed supplier selections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8">
              <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-muted-foreground mb-2">
                Comprehensive Quote Analysis
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Compare pricing, delivery terms, quality standards, and supplier capabilities.
              </p>
              <Button>
                Start Quote Analysis
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Workflow Navigation */}
        <WorkflowNavigation 
          currentModuleId="rfq" 
          projectId={projectId}
        />
      </div>
    </div>
  );
}