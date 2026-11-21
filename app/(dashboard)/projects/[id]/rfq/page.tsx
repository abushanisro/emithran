'use client';

import { formatDistanceToNow, isAfter } from 'date-fns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { RfqStatusBadge } from '@/components/features/rfq/RfqStatusBadge';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, FileText, Send, Users, Calendar, Clock, CheckCircle, Mail, Download, Eye, Paperclip, AlertCircle } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mark } from '@/components/ui/status-mark';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiConfig } from '@/lib/api/config';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { useRfqs } from '@/lib/api/hooks/useRfq';
import { useRfqTrackingStats, useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';
import { useSupplierNominations } from '@/lib/api/hooks/useSupplierNominations';
import { useVendors } from '@/lib/api/hooks/useVendors';


export default function RFQPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [selectedRfq, setSelectedRfq] = useState<string | null>(null);
  const [emailView, setEmailView] = useState<'overview' | 'compose' | 'history'>('overview');

  // Fetch real data from APIs
  const { data: rfqs, isLoading: rfqsLoading } = useRfqs({ projectId });
  useRfqTrackingStats(projectId);
  const { data: trackingRecords, isLoading: trackingLoading } = useRfqTrackingRecords(projectId);
  useSupplierNominations(projectId);
  useVendors();
  
  // Get project BOMs first, then get BOM items
  const { data: projectBOMs, isLoading: bomsLoading } = useBOMs({ projectId });
  const primaryBomId = projectBOMs?.boms?.[0]?.id; // Use first BOM for now
  const { data: bomItems, isLoading: bomItemsLoading } = useBOMItems(primaryBomId);

  // Calculate real statistics from data
  const activeRfqsCount = rfqs?.filter(rfq => ['draft', 'sent', 'in_progress'].includes(rfq.status || '')).length || 0;
  const totalSuppliersInvited = trackingRecords?.reduce((sum, record) => sum + (record.vendorCount || 0), 0) || 0;
  const totalResponses = trackingRecords?.reduce((sum, record) => sum + (record.responseCount || 0), 0) || 0;
  
  // Calculate average response time from tracking records
  const calculateAvgResponseTime = () => {
    if (!trackingRecords) return 0;
    const responseTimes: number[] = [];
    trackingRecords.forEach(record => {
      if (record.firstResponseAt && record.sentAt) {
        const sentDate = new Date(record.sentAt);
        const responseDate = new Date(record.firstResponseAt);
        const daysDiff = (responseDate.getTime() - sentDate.getTime()) / (1000 * 3600 * 24);
        if (daysDiff > 0) responseTimes.push(daysDiff);
      }
    });
    return responseTimes.length > 0 ? (responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length) : 0;
  };

  const avgResponseTime = calculateAvgResponseTime();

  // File download function - industry standard approach  
  const handleFileDownload = async (bomItemId: string, fileType: '2d' | '3d', fileName: string, partNumber?: string) => {
    try {
      const apiUrl = `${apiConfig.endpoints.api.v1}/bom-items/${bomItemId}/file-url/${fileType}`;
      console.log('Attempting download:', { bomItemId, fileType, fileName, partNumber, apiUrl });
      
      // The API checks access and returns a short-lived signed link.
      const response = await fetch(apiUrl, {
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const responseData = await response.json();
        console.log('API Response:', responseData);
        
        // Try different possible response structures
        const url = responseData.url || 
                    responseData.downloadUrl || 
                    responseData.signedUrl || 
                    responseData.fileUrl ||
                    responseData.data?.url ||  // Handle nested structure: {data: {url: "..."}}
                    responseData.data?.downloadUrl ||
                    responseData.data?.signedUrl;
        
        if (url) {
          console.log('✅ Download URL found:', url);
          console.log('🔥 Starting download with filename:', fileName);
          
          // Create temporary link for download
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.target = '_blank'; // Fallback for some browsers
          link.rel = 'noopener noreferrer'; // Security best practice
          
          // Append to DOM, click, and remove (required for some browsers)
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          console.log('✅ Download initiated successfully');
          return; // Exit function after successful download
        } else {
          console.error('❌ No download URL found in API response');
          console.error('Response data received:', responseData);
          console.error('Checked for these URL properties:', ['url', 'downloadUrl', 'signedUrl', 'fileUrl']);
          
          // Check if it's an empty response (API endpoint exists but returns empty)
          if (Object.keys(responseData).length === 0) {
            alert('The file download service returned an empty response. This usually means:\n\n' +
                  '• The file may not exist in storage\n' +
                  '• The BOM item may not have file attachments\n' +
                  '• The backend API endpoint may need to be implemented\n\n' +
                  'Please check with your system administrator.');
          } else {
            alert('Unable to get download link. The API response format has changed.');
          }
        }
      } else {
        const errorData = await response.text();
        console.error('Failed to get download URL:', response.status, errorData);
        alert(`Failed to download file: ${response.status === 404 ? 'File not found' : 'Server error'}`);
      }
    } catch (error) {
      console.error('Download error:', error);
      alert('Network error. Please check your connection and try again.');
    }
  };

  // Get BOM item details for parts
  const getBOMItemDetails = (partNumber: string) => {
    return bomItems?.items?.find(item => item.partNumber === partNumber) || null;
  };

  // Get clean file name from path
  const getFileName = (filePath: string) => {
    if (!filePath) return null;
    const pathParts = filePath.split('/');
    let fileName = pathParts[pathParts.length - 1] ?? filePath; // Get the last part (filename)

    // Remove timestamp prefix if present (pattern: numbers_actualname.ext)
    const timestampMatch = fileName.match(/^\d+_(.+)$/);
    if (timestampMatch) {
      fileName = timestampMatch[1] ?? fileName;
    }
    
    // Clean up the filename - replace underscores and hyphens with spaces, capitalize
    fileName = fileName
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[-_]/g, ' ') // Replace - and _ with spaces
      .replace(/\b\w/g, l => l.toUpperCase()) // Capitalize first letter of each word
      .trim();
      
    return fileName;
  };

  // Get file extension
  const getFileExtension = (filePath: string) => {
    if (!filePath) return null;
    return filePath.split('.').pop()?.toLowerCase() || null;
  };

  return (
    <div className="animate-fade-in">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" className="mt-0.5 h-8 w-8 shrink-0" aria-label="Back to project" asChild>
            <Link href={`/projects/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <PageHeader
              title="RFQ Management"
              description="Create and manage RFQ processes with nominated suppliers"
            >
              <Button className="gap-2" asChild>
                <Link href={`/projects/${projectId}/supplier-evaluation`}>
                  <Send className="h-4 w-4" />
                  Create New RFQ
                </Link>
              </Button>
            </PageHeader>
          </div>
        </div>

        {/* Project sections: shared tab bar, RFQ is the active tab */}
        <ProjectNav projectId={projectId} />

        {/* Overview cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Active RFQs', icon: FileText, value: rfqsLoading ? '-' : activeRfqsCount, hint: 'Currently in process' },
            { label: 'Suppliers', icon: Users, value: trackingLoading ? '-' : totalSuppliersInvited, hint: 'Invited to quote' },
            { label: 'Responses', icon: CheckCircle, value: trackingLoading ? '-' : totalResponses, hint: 'Quotes received' },
            { label: 'Avg Response Time', icon: Clock, value: trackingLoading ? '-' : avgResponseTime.toFixed(1), hint: 'Days to respond' },
          ].map(({ label, icon: Icon, value, hint }) => (
            <Card key={label}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* MAIN CONTENT */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ACTIVE RFQS - Real Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5" />
                Active RFQs
              </CardTitle>
              <CardDescription>
                Current RFQ processes and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {rfqsLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-3 animate-pulse">
                        <div className="space-y-2">
                          <div className="h-4 w-48 bg-muted rounded"></div>
                          <div className="h-3 w-32 bg-muted rounded"></div>
                        </div>
                        <div className="h-6 w-16 bg-muted rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : rfqs && rfqs.length > 0 ? (
                  <>
                    {rfqs.slice(0, 3).map((rfq) => {
                      const trackingRecord = trackingRecords?.find(record => record.rfqId === rfq.id);
                      const vendorCount = trackingRecord?.vendorCount || 0;
                      const dueDate = rfq.quoteDeadline ? new Date(rfq.quoteDeadline) : null;
                      const dueDateText = dueDate ? 
                        isAfter(dueDate, new Date()) 
                          ? `Due: ${formatDistanceToNow(dueDate, { addSuffix: true })}`
                          : 'Overdue'
                        : 'No deadline';
                      
                      const getStatusBadge = (status: string) => {
                        switch (status?.toLowerCase()) {
                          case 'sent':
                          case 'in_progress':
                            return <RfqStatusBadge tone="primary">Active</RfqStatusBadge>;
                          case 'draft':
                            return <RfqStatusBadge tone="warning">Draft</RfqStatusBadge>;
                          case 'closed':
                            return <RfqStatusBadge tone="muted">Closed</RfqStatusBadge>;
                          default:
                            return <RfqStatusBadge tone="muted">Pending</RfqStatusBadge>;
                        }
                      };

                      return (
                        <div key={rfq.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                          <div>
                            <p className="font-medium">{rfq.rfqName}</p>
                            <p className="text-sm text-muted-foreground">
                              {vendorCount} supplier{vendorCount !== 1 ? 's' : ''} invited • {dueDateText}
                            </p>
                          </div>
                          {getStatusBadge(rfq.status || '')}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">No Active RFQs</p>
                    <p className="text-sm">Create your first RFQ to get started</p>
                    <Button className="mt-4" asChild>
                      <Link href={`/projects/${projectId}/supplier-evaluation`}>
                        Create RFQ
                      </Link>
                    </Button>
                  </div>
                )}
                
                <Button className="w-full" asChild>
                  <Link href={`/projects/${projectId}/supplier-evaluation`}>
                    View All RFQs
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SUPPLIER RESPONSES - Real Data */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-5 w-5" />
                Supplier Responses
              </CardTitle>
              <CardDescription>
                Track quotations and supplier engagement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {trackingLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-3 animate-pulse">
                        <div className="space-y-2">
                          <div className="h-4 w-40 bg-muted rounded"></div>
                          <div className="h-3 w-56 bg-muted rounded"></div>
                        </div>
                        <div className="h-6 w-20 bg-muted rounded"></div>
                      </div>
                    ))}
                  </div>
                ) : trackingRecords && trackingRecords.length > 0 ? (
                  <>
                    {trackingRecords.flatMap(record => 
                      record.vendors?.map(vendor => {
                        const responseTime = vendor.responseReceivedAt && record.sentAt ? 
                          Math.ceil((new Date(vendor.responseReceivedAt).getTime() - new Date(record.sentAt).getTime()) / (1000 * 3600 * 24)) 
                          : null;
                        
                        const formatCurrency = (amount: number) => 
                          new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
                        
                        const getStatusBadge = (responded: boolean) => {
                          if (responded) {
                            return <RfqStatusBadge tone="success">Received</RfqStatusBadge>;
                          } else {
                            return <RfqStatusBadge tone="warning">Pending</RfqStatusBadge>;
                          }
                        };

                        return (
                          <div key={`${record.id}-${vendor.id}`} className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div>
                              <p className="font-medium">{vendor.name || 'Unknown Vendor'}</p>
                              <p className="text-sm text-muted-foreground">
                                {vendor.responded ? (
                                  <>
                                    {vendor.quoteAmount ? `Quote: ${formatCurrency(vendor.quoteAmount)}` : 'Quote received'} 
                                    {responseTime && ` • Response time: ${responseTime} day${responseTime !== 1 ? 's' : ''}`}
                                  </>
                                ) : (
                                  `Invited • No response yet`
                                )}
                              </p>
                            </div>
                            {getStatusBadge(vendor.responded)}
                          </div>
                        );
                      }) || []
                    ).slice(0, 3)}
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="text-lg font-medium">No Supplier Responses</p>
                    <p className="text-sm">Send RFQs to suppliers to see their responses</p>
                  </div>
                )}
                
                <Button className="w-full" asChild>
                  <Link href={`/projects/${projectId}/supplier-nomination`}>
                    Compare All Quotes
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* BOM PARTS & EMAIL MANAGEMENT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-5 w-5" />
              Email Management & BOM Parts
            </CardTitle>
            <CardDescription>
              Manage supplier communications with detailed BOM parts, 2D/3D files, and email tracking
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Email Management Tabs (shadcn Tabs: same emailView state, adds arrow-key navigation) */}
              <Tabs
                value={emailView}
                onValueChange={(value) => {
                  if (value === 'overview' || value === 'compose' || value === 'history') setEmailView(value);
                }}
              >
                <TabsList aria-label="Email management" className="w-full overflow-x-auto">
                  <TabsTrigger value="overview" className="gap-2">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="compose" className="gap-2">
                    <Send className="h-4 w-4" aria-hidden="true" />
                    Compose
                  </TabsTrigger>
                  <TabsTrigger value="history" className="gap-2">
                    <Clock className="h-4 w-4" aria-hidden="true" />
                    History
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Overview - RFQ with BOM Details */}
              {emailView === 'overview' && (
                <div className="space-y-4">
                  {rfqs && rfqs.length > 0 ? (
                    rfqs.map((rfq) => {
                      const trackingRecord = trackingRecords?.find(record => record.rfqId === rfq.id);
                      
                      return (
                        <div key={rfq.id} className="border rounded-lg p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h4 className="font-medium">{rfq.rfqName}</h4>
                              <p className="text-sm text-muted-foreground">
                                RFQ #{rfq.rfqNumber} • {trackingRecord?.vendorCount || 0} suppliers
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => setEmailView('compose')}>
                                <Send className="h-3 w-3 mr-1" />
                                Send Email
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedRfq(selectedRfq === rfq.id ? null : rfq.id)}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                {selectedRfq === rfq.id ? 'Hide' : 'View'} BOM Parts
                              </Button>
                            </div>
                          </div>

                          {/* BOM Parts Details */}
                          {selectedRfq === rfq.id && trackingRecord && (
                            <div className="mt-4 pt-4 border-t">
                              <h5 className="font-medium mb-3 flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                BOM Parts ({trackingRecord.partCount} items)
                                {(bomsLoading || bomItemsLoading) && (
                                  <span className="text-xs text-muted-foreground">(Loading BOM data...)</span>
                                )}
                                {projectBOMs?.boms && projectBOMs.boms.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    (Using BOM: {projectBOMs.boms[0]?.name || 'Primary BOM'})
                                  </span>
                                )}
                              </h5>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {trackingRecord.parts?.map((part) => {
                                  const bomItem = getBOMItemDetails(part.partNumber);
                                  const file2dPath = bomItem?.file2dPath;
                                  const file3dPath = bomItem?.file3dPath;

                                  return (
                                    <div key={part.id} className="border rounded-lg p-4 space-y-3">
                                      <div className="flex items-start justify-between">
                                        <div>
                                          <h6 className="font-medium">{part.partNumber}</h6>
                                          <p className="text-sm text-muted-foreground">{part.description}</p>
                                          <div className="flex items-center gap-4 mt-2 text-sm">
                                            <span>Process: <strong>{part.process}</strong></span>
                                            <span>Qty: <strong>{part.quantity}</strong></span>
                                            {bomItem?.material && (
                                              <span>Material: <strong>{bomItem.material}</strong></span>
                                            )}
                                          </div>
                                          {bomItem && (
                                            <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                              <span>Type: {bomItem.itemType?.replace('_', ' ')}</span>
                                              {bomItem.unit && <span>Unit: {bomItem.unit}</span>}
                                              {bomItem.unitCost && <span>Unit Cost: ${bomItem.unitCost}</span>}
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      {/* File Attachments */}
                                      <div className="space-y-2">
                                        <p className="text-sm font-medium flex items-center gap-1">
                                          <Paperclip className="h-3 w-3" />
                                          Attached Files
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                          {bomItem && file2dPath ? (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="text-xs max-w-[200px] flex items-center gap-2"
                                              onClick={() => handleFileDownload(bomItem.id, '2d', getFileName(file2dPath) || `${part.partNumber}_2D`, part.partNumber)}
                                              title={`Download ${getFileName(file2dPath)} (${getFileExtension(file2dPath)?.toUpperCase()} file)`}
                                            >
                                              <Download className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{getFileName(file2dPath) || 'Drawing'}</span>
                                              <Badge variant="secondary" className="text-xs ml-1">
                                                {getFileExtension(file2dPath)?.toUpperCase()}
                                              </Badge>
                                            </Button>
                                          ) : (
                                            <Badge variant="outline" className="text-xs opacity-50">No 2D File</Badge>
                                          )}
                                          {bomItem && file3dPath ? (
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="text-xs max-w-[200px] flex items-center gap-2"
                                              onClick={() => handleFileDownload(bomItem.id, '3d', getFileName(file3dPath) || `${part.partNumber}_3D`, part.partNumber)}
                                              title={`Download ${getFileName(file3dPath)} (${getFileExtension(file3dPath)?.toUpperCase()} file)`}
                                            >
                                              <Download className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{getFileName(file3dPath) || 'Model'}</span>
                                              <Badge variant="secondary" className="text-xs ml-1">
                                                {getFileExtension(file3dPath)?.toUpperCase()}
                                              </Badge>
                                            </Button>
                                          ) : (
                                            <Badge variant="outline" className="text-xs opacity-50">No 3D File</Badge>
                                          )}
                                        </div>
                                        {bomItem ? (
                                          <div className="mt-2 p-2 bg-primary/10 rounded text-xs text-primary">
                                            <p className="flex items-center gap-1">
                                              <CheckCircle className="h-3 w-3" />
                                              BOM Item Found: {bomItem.id}
                                            </p>
                                            {(bomItem.file2dPath || bomItem.file3dPath) && (
                                              <p className="text-xs">
                                                Files: {bomItem.file2dPath ? <><Mark kind="ok" /> 2D</> : <><Mark kind="fail" /> 2D</>} | {bomItem.file3dPath ? <><Mark kind="ok" /> 3D</> : <><Mark kind="fail" /> 3D</>}
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <div className="mt-2 p-2 bg-warning/10 rounded text-xs text-warning">
                                            <p className="flex items-center gap-1">
                                              <AlertCircle className="h-3 w-3" />
                                              No BOM item found for part: {part.partNumber}
                                            </p>
                                            <p className="text-xs">
                                              Available BOM items: {bomItems?.items?.length || 0} | Total BOMs: {projectBOMs?.boms?.length || 0}
                                            </p>
                                          </div>
                                        )}
                                      </div>

                                    {/* Vendor Responses for this Part */}
                                    <div className="pt-2 border-t">
                                      <p className="text-sm font-medium mb-2">Vendor Responses</p>
                                      {trackingRecord.vendors?.filter(v => v.responded).length > 0 ? (
                                        <div className="space-y-1">
                                          {trackingRecord.vendors.filter(v => v.responded).map(vendor => (
                                            <div key={vendor.id} className="flex items-center justify-between text-xs p-2 bg-success/10 rounded">
                                              <span>{vendor.name}</span>
                                              <span className="font-medium">
                                                {vendor.quoteAmount ? 
                                                  new Intl.NumberFormat('en-IN', { 
                                                    style: 'currency', 
                                                    currency: 'INR',
                                                    maximumFractionDigits: 0 
                                                  }).format(vendor.quoteAmount) 
                                                  : 'Quote received'
                                                }
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">No responses yet</p>
                                      )}
                                    </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Vendor Communication Status */}
                          <div className="pt-3 border-t">
                            <div className="flex items-center justify-between mb-2">
                              <h5 className="text-sm font-medium">Supplier Email Status</h5>
                              <Button variant="outline" size="sm" onClick={() => setEmailView('history')}>
                                <Clock className="h-3 w-3 mr-1" />
                                View History
                              </Button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {trackingRecord?.vendors?.map(vendor => (
                                <div key={vendor.id} className="flex items-center justify-between p-2 border rounded text-sm">
                                  <span>{vendor.name}</span>
                                  <div className="flex items-center gap-2">
                                    <RfqStatusBadge tone={vendor.responded ? 'success' : 'warning'}>
                                      {vendor.responded ? 'Responded' : 'Pending'}
                                    </RfqStatusBadge>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                      <Mail className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">No RFQs Available</p>
                      <p className="text-sm">Create an RFQ to manage supplier communications</p>
                    </div>
                  )}
                </div>
              )}

              {/* Compose Email */}
              {emailView === 'compose' && (
                <div className="space-y-4">
                  <div className="rounded-md border p-4">
                    <h4 className="mb-4 font-medium">Compose Email to Suppliers</h4>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Select RFQ</Label>
                        <select className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option>Select an RFQ...</option>
                          {rfqs?.map(rfq => (
                            <option key={rfq.id} value={rfq.id}>
                              {rfq.rfqName} (#{rfq.rfqNumber})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Recipients</Label>
                        <div className="mt-2 space-y-2">
                          {trackingRecords?.[0]?.vendors?.map(vendor => (
                            <label key={vendor.id} className="flex items-center gap-2">
                              <Checkbox defaultChecked />
                              <span className="text-sm">{vendor.name}</span>
                              {vendor.email && (
                                <span className="text-xs text-muted-foreground">({vendor.email})</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Email Template</Label>
                        <select className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <option>RFQ Invitation</option>
                          <option>Follow-up Reminder</option>
                          <option>Deadline Extension</option>
                          <option>Clarification Request</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Subject</Label>
                        <Input
                          type="text"
                          className="mt-1"
                          placeholder="RFQ Request - [RFQ Number]"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Message</Label>
                        <Textarea
                          className="mt-1 h-32"
                          placeholder="Enter your message here..."
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <Button className="flex-1">
                          <Send className="h-4 w-4 mr-2" />
                          Send Email
                        </Button>
                        <Button variant="outline">Save Draft</Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Email History */}
              {emailView === 'history' && (
                <div className="space-y-4">
                  <div className="rounded-md border p-4">
                    <h4 className="mb-4 font-medium">Email Communication History</h4>
                    {/* Sent RFQs from /rfq/tracking — the only record of RFQ emails the backend keeps. */}
                    <div className="space-y-3">
                      {trackingLoading ? (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                      ) : trackingRecords && trackingRecords.length > 0 ? (
                        trackingRecords.map(record => (
                          <div key={record.id} className="flex items-start gap-3 p-3 border rounded">
                            <Mail className="h-4 w-4 mt-1 text-primary" />
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">RFQ sent: {record.rfqName} ({record.rfqNumber})</p>
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(record.sentAt), { addSuffix: true })}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                To: {record.vendors.length ? record.vendors.map(v => v.name || 'Unknown vendor').join(', ') : '—'}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-4 text-muted-foreground">
                          <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No communications recorded yet</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* RFQ TEMPLATES & MANAGEMENT */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-5 w-5" />
              RFQ Templates & Management
            </CardTitle>
            <CardDescription>
              Standard templates and RFQ process management tools
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Standard Templates</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Pre-configured RFQ templates for different part categories
                </p>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/projects/${projectId}/rfq/templates`}>
                    Browse Templates
                  </Link>
                </Button>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-2">Supplier Communication</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Automated emails and follow-up reminders
                </p>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/projects/${projectId}/rfq/communications`}>
                    Manage Communications
                  </Link>
                </Button>
              </div>
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