'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Search, FileDown, FileText, Edit, Trash2, Calculator } from 'lucide-react';
import { useMHRRecords, useDeleteMHR } from '@/lib/api/hooks';
import { MHRFormDialog } from '@/components/features/mhr/MHRFormDialog';
import { formatCurrency } from '@/lib/utils';
import { exportMHRToPDF } from '@/lib/utils/exportMHRToPDF';
import { getCommodityLabel } from '@/lib/constants/commodityPresets';

export default function MHRDatabasePage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useMHRRecords({ search, limit: 50 });
  const deleteMutation = useDeleteMHR();

  const handleCreate = () => {
    setEditingId(null);
    setIsFormOpen(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this MHR record?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleExport = () => {
    if (!data?.records || data.records.length === 0) {
      return;
    }

    // Create CSV content
    const headers = [
      'Machine Name',
      'Location',
      'Commodity Code',
      'Manufacturer',
      'Model',
      'Machine Hour Rate (₹)',
      'Fixed Cost/Hr (₹)',
      'Variable Cost/Hr (₹)',
      'Annual Cost (₹)',
      'Created At',
    ];

    const rows = data.records.map(record => [
      record.machineName,
      record.location,
      getCommodityLabel(record.commodityCode),
      record.manufacturer || '-',
      record.model || '-',
      record.calculations.totalMachineHourRate.toFixed(2),
      record.calculations.totalFixedCostPerHour.toFixed(2),
      record.calculations.totalVariableCostPerHour.toFixed(2),
      record.calculations.totalAnnualCost.toFixed(2),
      new Date(record.createdAt).toLocaleDateString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `mhr-database-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    if (!data?.records || data.records.length === 0) {
      return;
    }

    exportMHRToPDF({
      records: data.records,
      companyName: 'Your Company Name', // Can be customized
      companyAddress: 'Your Company Address', // Can be customized
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="m12 19-7-7 7-7"></path>
            <path d="M19 12H5"></path>
          </svg>
        </Button>
        <PageHeader
          title="MHR"
          description="Machine Hour Rate calculations and cost analysis"
        />
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by machine name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!data?.records?.length}>
            <FileDown className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" onClick={handleExportPDF} disabled={!data?.records?.length}>
            <FileText className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New MHR Record
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {data && data.records.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Avg. Machine Hour Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(
                  data.records.reduce((sum, r) => sum + r.calculations.totalMachineHourRate, 0) / data.records.length
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Annual Cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(
                  data.records.reduce((sum, r) => sum + r.calculations.totalAnnualCost, 0)
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Locations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Set(data.records.map(r => r.location)).size}
              </div>
            </CardContent>
          </Card>
        </div>
      )}


      {/* MHR Records Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : data?.records && data.records.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Machine Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Commodity Code</TableHead>
                    <TableHead className="text-right">MHR (₹/hr)</TableHead>
                    <TableHead className="text-right">Fixed Cost</TableHead>
                    <TableHead className="text-right">Variable Cost</TableHead>
                    <TableHead className="text-right">Annual Cost</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.records.map((record) => (
                    <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">{record.machineName}</TableCell>
                      <TableCell>{record.location}</TableCell>
                      <TableCell>{getCommodityLabel(record.commodityCode)}</TableCell>
                      <TableCell className="text-right font-semibold text-primary">
                        {formatCurrency(record.calculations.totalMachineHourRate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(record.calculations.totalFixedCostPerHour)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(record.calculations.totalVariableCostPerHour)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(record.calculations.totalAnnualCost)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push(`/mhr-database/${record.id}`)}
                          >
                            <Calculator className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(record.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(record.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Calculator className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No MHR Records</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Get started by creating your first machine hour rate calculation
              </p>
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Create MHR Record
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <MHRFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        editingId={editingId}
      />
    </div>
  );
}
