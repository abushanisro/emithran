'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { ProjectNav } from '@/components/features/projects/ProjectNav';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, Clock, CheckCircle, AlertCircle } from '@/components/ui/icons';
import { PageSkeleton } from '@/components/ui/loading-skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';
import { useVendors } from '@/lib/api/hooks/useVendors';

export default function QuoteComparisonPage() {
  const params = useParams();
  const projectId = params.id as string;
  
  // Fetch real data
  const { data: trackingRecords, isLoading: trackingLoading } = useRfqTrackingRecords(projectId);
  const { isLoading: vendorsLoading } = useVendors();

  // Process quotes data
  const quotesData = trackingRecords?.flatMap(record => 
    record.vendors?.filter(vendor => vendor.responded && vendor.quoteAmount).map(vendor => ({
      rfqId: record.id,
      rfqName: record.rfqName,
      rfqNumber: record.rfqNumber,
      vendorId: vendor.id,
      vendorName: vendor.name,
      quoteAmount: vendor.quoteAmount!,
      leadTimeDays: vendor.leadTimeDays,
      responseDate: vendor.responseReceivedAt,
      partCount: record.partCount,
      sentDate: record.sentAt
    })) || []
  ) || [];

  // Group quotes by RFQ
  const quotesByRfq = quotesData.reduce((acc, quote) => {
    if (!acc[quote.rfqId]) {
      acc[quote.rfqId] = {
        rfqName: quote.rfqName,
        rfqNumber: quote.rfqNumber,
        partCount: quote.partCount,
        sentDate: quote.sentDate,
        quotes: []
      };
    }
    acc[quote.rfqId].quotes.push(quote);
    return acc;
  }, {} as Record<string, any>);

  // Calculate statistics
  const totalQuotes = quotesData.length;
  const averageQuote = quotesData.length > 0 
    ? quotesData.reduce((sum, q) => sum + q.quoteAmount, 0) / quotesData.length 
    : 0;
  const lowestQuote = quotesData.length > 0 
    ? Math.min(...quotesData.map(q => q.quoteAmount)) 
    : 0;
  const highestQuote = quotesData.length > 0 
    ? Math.max(...quotesData.map(q => q.quoteAmount)) 
    : 0;

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR', 
      maximumFractionDigits: 0 
    }).format(amount);

  const getResponseTime = (sentDate: Date, responseDate: Date) => {
    const diffTime = new Date(responseDate).getTime() - new Date(sentDate).getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getBestQuoteIndex = (quotes: any[]) => {
    return quotes.findIndex(q => q.quoteAmount === Math.min(...quotes.map(quote => quote.quoteAmount)));
  };

  if (trackingLoading || vendorsLoading) {
    return (
      <PageSkeleton label="Loading quotes…" />
    );
  }

  const stats = [
    { label: 'Total Quotes', icon: DollarSign, value: String(totalQuotes), tone: '' },
    { label: 'Average Quote', icon: TrendingUp, value: formatCurrency(averageQuote), tone: '' },
    { label: 'Lowest Quote', icon: TrendingDown, value: formatCurrency(lowestQuote), tone: 'text-success' },
    { label: 'Highest Quote', icon: TrendingUp, value: formatCurrency(highestQuote), tone: 'text-destructive' },
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
              title="Quote Comparison"
              description="Compare supplier quotations and analyze pricing across all RFQs"
            />
          </div>
        </div>

        {/* Project sections: shared tab bar, RFQ is the active tab */}
        <ProjectNav projectId={projectId} />

        {/* Overview statistics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ label, icon: Icon, value, tone }) => (
            <Card key={label}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className={`mt-1 truncate text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</p>
                </div>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* QUOTES BY RFQ */}
        <div className="space-y-6">
          {Object.entries(quotesByRfq).map(([rfqId, rfqData]: [string, any]) => {
            const bestQuoteIndex = getBestQuoteIndex(rfqData.quotes);
            
            return (
              <Card key={rfqId} className="overflow-hidden">
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-3 text-base">
                        {rfqData.rfqName}
                        <Badge variant="outline">{rfqData.rfqNumber}</Badge>
                      </CardTitle>
                      <CardDescription>
                        {rfqData.partCount} parts • {rfqData.quotes.length} quotes received
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Sent</p>
                      <p className="text-sm font-medium">
                        {new Date(rfqData.sentDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-0">
                  {/* Quote comparison table */}
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-6">Supplier</TableHead>
                        <TableHead className="text-right">Quoted Amount</TableHead>
                        <TableHead className="text-right">Lead Time</TableHead>
                        <TableHead className="text-right">Response Time</TableHead>
                        <TableHead>Response Date</TableHead>
                        <TableHead className="pr-6 text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rfqData.quotes.map((quote: any, index: number) => {
                        const isBest = index === bestQuoteIndex;
                        const responseTime = getResponseTime(rfqData.sentDate, quote.responseDate);

                        return (
                          <TableRow
                            key={quote.vendorId}
                            className={isBest ? 'bg-success/5 hover:bg-success/10' : ''}
                          >
                            <TableCell className="pl-6">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{quote.vendorName}</span>
                                {isBest && (
                                  <Badge className="gap-1 border-success/30 bg-success/10 text-success hover:bg-success/10">
                                    <CheckCircle className="h-3 w-3" />
                                    Best Price
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className={`text-right font-semibold tabular-nums ${isBest ? 'text-success' : ''}`}>
                              {formatCurrency(quote.quoteAmount)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {quote.leadTimeDays ? `${String(quote.leadTimeDays)} days` : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                {responseTime} days
                              </span>
                            </TableCell>
                            <TableCell>{new Date(quote.responseDate).toLocaleDateString()}</TableCell>
                            <TableCell className="pr-6 text-right">
                              <Button size="sm" variant={isBest ? 'default' : 'outline'}>
                                View Details
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Price analysis */}
                  <div className="border-t bg-muted/30 p-6">
                    <h5 className="mb-3 text-sm font-semibold">Price Analysis</h5>
                    <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">Price Range</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">
                          {formatCurrency(Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)))} - {formatCurrency(Math.max(...rfqData.quotes.map((q: any) => q.quoteAmount)))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Average Quote</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">
                          {formatCurrency(rfqData.quotes.reduce((sum: number, q: any) => sum + q.quoteAmount, 0) / rfqData.quotes.length)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Savings Potential</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-success">
                          {formatCurrency(Math.max(...rfqData.quotes.map((q: any) => q.quoteAmount)) - Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Cost per Part</dt>
                        <dd className="mt-0.5 font-medium tabular-nums">
                          {formatCurrency(Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)) / rfqData.partCount)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Empty state */}
        {quotesData.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState
                icon={AlertCircle}
                title="No Quotes Available"
                description="No supplier quotes found for this project. Send RFQs to suppliers to see price comparisons."
              >
                <Button asChild>
                  <Link href={`/projects/${projectId}/supplier-evaluation`}>
                    Create New RFQ
                  </Link>
                </Button>
              </EmptyState>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
