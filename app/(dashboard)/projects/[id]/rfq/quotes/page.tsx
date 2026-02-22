'use client';

import { useParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, Clock, CheckCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useRfqTrackingRecords } from '@/lib/api/hooks/useRfqTracking';
import { useVendors } from '@/lib/api/hooks/useVendors';

export default function QuoteComparisonPage() {
  const params = useParams();
  const projectId = params.id as string;
  
  // Fetch real data
  const { data: trackingRecords, isLoading: trackingLoading } = useRfqTrackingRecords(projectId);
  const { data: vendors, isLoading: vendorsLoading } = useVendors();

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
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-[1800px] mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-24 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              <span>Quote Comparison</span>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Quote Comparison
            </h1>
            <p className="text-sm text-muted-foreground">
              Compare supplier quotations and analyze pricing across all RFQs
            </p>
          </div>
        </div>

        {/* OVERVIEW STATISTICS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Quotes</p>
                  <p className="text-2xl font-bold">{totalQuotes}</p>
                </div>
                <DollarSign className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Average Quote</p>
                  <p className="text-2xl font-bold">{formatCurrency(averageQuote)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Lowest Quote</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(lowestQuote)}</p>
                </div>
                <TrendingDown className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Highest Quote</p>
                  <p className="text-2xl font-bold text-red-600">{formatCurrency(highestQuote)}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-red-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* QUOTES BY RFQ */}
        <div className="space-y-6">
          {Object.entries(quotesByRfq).map(([rfqId, rfqData]: [string, any]) => {
            const bestQuoteIndex = getBestQuoteIndex(rfqData.quotes);
            
            return (
              <Card key={rfqId}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-3">
                        {rfqData.rfqName}
                        <Badge variant="outline">{rfqData.rfqNumber}</Badge>
                      </CardTitle>
                      <CardDescription>
                        {rfqData.partCount} parts • {rfqData.quotes.length} quotes received
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Sent</p>
                      <p className="text-sm font-medium">
                        {new Date(rfqData.sentDate).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Quote Comparison Table */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {rfqData.quotes.map((quote: any, index: number) => {
                        const isBest = index === bestQuoteIndex;
                        const responseTime = getResponseTime(rfqData.sentDate, quote.responseDate);
                        
                        return (
                          <div 
                            key={quote.vendorId} 
                            className={`p-4 border rounded-lg ${isBest ? 'border-green-500 bg-green-50' : ''}`}
                          >
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium">{quote.vendorName}</h4>
                                {isBest && (
                                  <Badge className="bg-green-100 text-green-800">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Best Price
                                  </Badge>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div>
                                  <p className="text-sm text-muted-foreground">Quoted Amount</p>
                                  <p className={`text-xl font-bold ${isBest ? 'text-green-600' : ''}`}>
                                    {formatCurrency(quote.quoteAmount)}
                                  </p>
                                </div>

                                {quote.leadTimeDays && (
                                  <div>
                                    <p className="text-sm text-muted-foreground">Lead Time</p>
                                    <p className="text-sm font-medium">
                                      {quote.leadTimeDays} days
                                    </p>
                                  </div>
                                )}

                                <div>
                                  <p className="text-sm text-muted-foreground">Response Time</p>
                                  <p className="text-sm font-medium flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {responseTime} days
                                  </p>
                                </div>

                                <div>
                                  <p className="text-sm text-muted-foreground">Response Date</p>
                                  <p className="text-sm font-medium">
                                    {new Date(quote.responseDate).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>

                              <div className="pt-2 border-t">
                                <Button size="sm" className="w-full" variant={isBest ? "default" : "outline"}>
                                  View Details
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Price Analysis */}
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <h5 className="font-medium mb-2">Price Analysis</h5>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Price Range</p>
                          <p className="font-medium">
                            {formatCurrency(Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)))} - {formatCurrency(Math.max(...rfqData.quotes.map((q: any) => q.quoteAmount)))}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Average Quote</p>
                          <p className="font-medium">
                            {formatCurrency(rfqData.quotes.reduce((sum: number, q: any) => sum + q.quoteAmount, 0) / rfqData.quotes.length)}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Savings Potential</p>
                          <p className="font-medium text-green-600">
                            {formatCurrency(Math.max(...rfqData.quotes.map((q: any) => q.quoteAmount)) - Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)))}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Cost per Part</p>
                          <p className="font-medium">
                            {formatCurrency(Math.min(...rfqData.quotes.map((q: any) => q.quoteAmount)) / rfqData.partCount)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* EMPTY STATE */}
        {quotesData.length === 0 && (
          <Card className="text-center py-12">
            <CardContent>
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Quotes Available</h3>
              <p className="text-muted-foreground mb-4">
                No supplier quotes found for this project. Send RFQs to suppliers to see price comparisons.
              </p>
              <Button asChild>
                <Link href={`/projects/${projectId}/supplier-evaluation`}>
                  Create New RFQ
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}