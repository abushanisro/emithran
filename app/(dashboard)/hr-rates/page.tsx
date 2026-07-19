'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Plus,
  Search,
  FileDown,
  FileText,
  Edit,
  Trash2,
  Calculator,
  Upload,
  Loader2,
  Eraser,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useMHRRecords,
  useMHRCurrencies,
  useCreateMHR,
  useDeleteMHR,
  useDeleteAllMHR,
  useImportMHRFromExcel,
} from '@/lib/api/hooks';
import { MHRFormDialog } from '@/components/features/mhr/MHRFormDialog';
import { formatCurrency } from '@/lib/utils';
import { exportMHRToPDF } from '@/lib/utils/exportMHRToPDF';

// All 9 locations in the master Excel file — hardcoded so filters always show them
const MASTER_LOCATIONS = ['China', 'E. Europe', 'France', 'Germany', 'India', 'Mexico', 'Other', 'USA', 'W. Europe'] as const;

// fxRate = local units per 1 USD
function getLocationCurrency(location: string): { symbol: string; code: string; fxRate: number } {
  const l = (location || '').toLowerCase();
  if (l.includes('india'))                                    return { symbol: '$',   code: 'INR', fxRate: 84.5  };
  if (l.includes('china'))                                    return { symbol: '¥',   code: 'CNY', fxRate: 7.25  };
  if (l.includes('mexico'))                                   return { symbol: 'MX$', code: 'MXN', fxRate: 17.5  };
  if (l.includes('germany') || l.includes('france') ||
      l.includes('europe'))                                   return { symbol: '€',   code: 'EUR', fxRate: 0.92  };
  if (l.includes('uk') || l.includes('britain'))             return { symbol: '£',   code: 'GBP', fxRate: 0.79  };
  if (l.includes('japan'))                                    return { symbol: '¥',   code: 'JPY', fxRate: 149.0 };
  return { symbol: '$', code: 'USD', fxRate: 1.0 };
}

// Always derive from location so "Local" means location currency, not stored currency
function mhrCurrencyOf(record: { location: string }) {
  return getLocationCurrency(record.location);
}

export default function HRRatesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ─── MHR state ────────────────────────────────────────────────────────────
  const [mhrSearch, setMhrSearch] = useState('');
  const [mhrLocation, setMhrLocation] = useState('');
  const [mhrCurrency, setMhrCurrency] = useState('');
  const [isMhrFormOpen, setIsMhrFormOpen] = useState(false);
  const [editingMhrId, setEditingMhrId] = useState<string | null>(null);

  // When a location filter is active load up to 1000 records (max ~864/location in master file).
  // With no filter keep limit at 50 to keep the initial load fast.
  const mhrActiveFilter = !!(mhrLocation || mhrCurrency || mhrSearch);
  const { data: mhrData, isLoading: isMhrLoading } = useMHRRecords({
    search: mhrSearch,
    ...(mhrLocation ? { location: mhrLocation } : {}),
    ...(mhrCurrency ? { currency: mhrCurrency } : {}),
    limit: mhrActiveFilter ? 1000 : 50,
  });
  const { data: mhrCurrencies = [] } = useMHRCurrencies();
  const deleteMhrMutation = useDeleteMHR();
  const deleteAllMhrMutation = useDeleteAllMHR();
  const importMhrMutation = useImportMHRFromExcel();
  const createMhrMutation = useCreateMHR();

  const [mhrViewMode, setMhrViewMode] = useState<'table' | 'calculator'>('table');
  const [isSimpleMhrOpen, setIsSimpleMhrOpen] = useState(false);
  const [simpleMhrForm, setSimpleMhrForm] = useState({
    location: '', processGroup: '', machineClass: '', machineName: '',
    directOverheadRate: '', indirectOverheadRate: '', usdLhrTotal: '',
  });

  const handleMhrCreate = () => { setEditingMhrId(null); setIsMhrFormOpen(true); };
  const handleMhrEdit = (id: string) => { setEditingMhrId(id); setIsMhrFormOpen(true); };
  const handleMhrDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this MHR record?')) {
      await deleteMhrMutation.mutateAsync(id);
    }
  };

  const handleSimpleMhrSubmit = async () => {
    const direct = parseFloat(simpleMhrForm.directOverheadRate);
    const indirect = parseFloat(simpleMhrForm.indirectOverheadRate);
    if (!simpleMhrForm.location) { toast.error('Location is required'); return; }
    if (!simpleMhrForm.machineName) { toast.error('Machine Name is required'); return; }
    if (isNaN(direct) || direct < 0) { toast.error('Direct Overhead Rate must be a valid number'); return; }
    if (isNaN(indirect) || indirect < 0) { toast.error('Indirect Overhead Rate must be a valid number'); return; }
    const total = parseFloat((direct + indirect).toFixed(4));
    const skill = simpleMhrForm.usdLhrTotal ? parseFloat(simpleMhrForm.usdLhrTotal) : undefined;
    await createMhrMutation.mutateAsync({
      isManualEntry: true,
      location: simpleMhrForm.location,
      machineName: simpleMhrForm.machineName,
      commodityCode: simpleMhrForm.processGroup || 'General',
      directOverheadRate: direct,
      indirectOverheadRate: indirect,
      manualMHRValue: total,
      ...(simpleMhrForm.processGroup ? { processGroup: simpleMhrForm.processGroup } : {}),
      ...(simpleMhrForm.machineClass ? { machineClass: simpleMhrForm.machineClass } : {}),
      ...(skill != null ? { usdLhrTotal: skill } : {}),
      // Required defaults (not used for manual entry calculation)
      shiftsPerDay: 3, hoursPerShift: 8, workingDaysPerYear: 260,
      plannedMaintenanceHoursPerYear: 0, capacityUtilizationRate: 95,
      landedMachineCost: 1, accessoriesCostPercentage: 6, installationCostPercentage: 20,
      paybackPeriodYears: 10, interestRatePercentage: 8, insuranceRatePercentage: 1,
      machineFootprintSqm: 0, rentPerSqmPerMonth: 0, maintenanceCostPercentage: 6,
      powerKwhPerHour: 0, electricityCostPerKwh: 0, adminOverheadPercentage: 0, profitMarginPercentage: 0,
    });
    setIsSimpleMhrOpen(false);
    setSimpleMhrForm({ location: '', processGroup: '', machineClass: '', machineName: '', directOverheadRate: '', indirectOverheadRate: '', usdLhrTotal: '' });
  };

  const handleMhrExportCsv = () => {
    if (!mhrData?.records?.length) return;
    const headers = ['Machine Name', 'Process Group', 'Machine Class', 'Wage Grade', 'Location', 'Currency', 'Manufacturer', 'Automation Level', 'MHR Local/hr', 'LHR Local/hr', 'LHR USD/hr', 'Annual Cost', 'Created At'];
    const rows = mhrData.records.map(r => {
      const { symbol, code, fxRate } = mhrCurrencyOf(r);
      const usdMhr = r.mhrUsdPerHour ?? r.manualMHRValue ?? r.calculations.totalMachineHourRate;
      const localMhr = usdMhr * fxRate;
      const usdLhr = r.usdLhrTotal;
      const localLhr = usdLhr != null ? usdLhr * fxRate : null;
      const effHrs = r.calculations.effectiveHoursPerYear > 0
        ? r.calculations.effectiveHoursPerYear
        : r.workingDaysPerYear * r.shiftsPerDay * r.hoursPerShift * (r.capacityUtilizationRate / 100);
      const annualUsd = r.calculations.totalAnnualCost > 0 ? r.calculations.totalAnnualCost : usdMhr * effHrs;
      return [
        r.machineName, r.processGroup || r.commodityCode || '-', r.machineClass || '-',
        r.wageGrade || '-', r.location, `${symbol} ${code}`, r.manufacturer || '-', r.automationLevel || '-',
        `${symbol}${localMhr.toFixed(fxRate > 1 ? 0 : 2)}`,
        localLhr != null ? `${symbol}${localLhr.toFixed(fxRate > 1 ? 0 : 2)}` : '-',
        usdLhr != null ? `$${usdLhr.toFixed(2)}` : '-',
        annualUsd ? `${symbol}${Math.round(annualUsd * fxRate).toLocaleString()}` : '-',
        new Date(r.createdAt).toLocaleDateString(),
      ];
    });
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `mhr-database-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleMhrExportPdf = () => {
    if (!mhrData?.records?.length) return;
    exportMHRToPDF({ records: mhrData.records, companyName: 'Your Company Name', companyAddress: 'Your Company Address' });
  };

  // ─── Excel import (MHR only) ──────────────────────────────────────────────
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsImporting(true);
    try {
      await importMhrMutation.mutateAsync(file);
    } finally {
      setIsImporting(false);
    }
  };

  // ─── Template download ────────────────────────────────────────────────────
  const downloadMhrTemplate = () => {
    const headers = [
      'Machine Name', 'Location', 'Process Group', 'Process Category',
      'Machine Class', 'Automation Level', 'Wage Grade', 'Operators',
      'Manufacturer', 'Manufacturer Country', 'Machine Price USD',
      'Shifts Per Day', 'Hours Per Shift', 'Working Days Per Year',
      'Capacity Utilization (%)', 'Landed Machine Cost (INR)',
      'Accessories Cost (%)', 'Installation Cost (%)', 'Payback Period Yrs',
      'Interest Rate (%)', 'Insurance Rate (%)', 'Machine Footprint SQM',
      'Rent SQM Month (INR)', 'Maintenance Cost (%)', 'Power KWH Per Hour',
      'Electricity Cost KWH (INR)', 'Admin Overhead (%)', 'Profit Margin (%)',
      'MHR Hour', 'LHR HR India', 'Labor Rate USD HR',
      'LHR Base USD HR', 'LHR Burden 38 USD HR', 'LHR Total USD HR',
      'Setup Time HR', 'Machine Description', 'Commodity Code',
      'Max Capacity', 'Tolerance MM', 'Surface Finish RA UM',
      'Material Compatibility', 'Typical Applications', 'Process Notes',
    ];
    const sample = [
      'CNC Lathe 200', 'Pune', 'Machining', 'Turning', 'Standard', 'Semi', 'W5',
      1, 'Jyoti CNC', 'India', 450000,
      2, 8, 281,
      85, 2500000,
      5, 3, 5,
      12, 1, 12,
      3000, 5, 3.5,
      8.5, 10, 15,
      1850, 120, 8.5,
      8.5, '', 17,
      0.5, 'Two-axis CNC lathe', 'CNC-TURN',
      'Ø300mm × 800mm', '±0.02', '1.6',
      'Steel,Aluminium', 'Shafts,Flanges', '',
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'MHR');
    XLSX.writeFile(wb, 'MHR_Import_Template.xlsx');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 animate-fade-in min-h-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => router.push('/')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>
            </svg>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">HR Rates</h1>
            <p className="text-sm text-muted-foreground">Machine Hour Rate &amp; Labour Rate database</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isImporting}>
            {isImporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {isImporting ? 'Importing...' : 'Import Excel'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={handleExcelImport}
        />
      </div>

      {/* MHR content */}
      <div className="space-y-4 mt-4">
        {/* Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by machine name..." value={mhrSearch} onChange={e => setMhrSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={mhrLocation || 'all'} onValueChange={v => setMhrLocation(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {MASTER_LOCATIONS.map(loc => (
                <SelectItem key={loc} value={loc}>{loc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {mhrCurrencies.length > 0 && (
            <Select value={mhrCurrency || 'all'} onValueChange={v => setMhrCurrency(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 w-[120px] text-xs">
                <SelectValue placeholder="All Currencies" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Currencies</SelectItem>
                {mhrCurrencies.map(cur => (
                  <SelectItem key={cur} value={cur}>{cur}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <Button variant={mhrViewMode === 'table' ? 'secondary' : 'ghost'} size="sm" className="rounded-none h-9 text-xs px-3 border-0" onClick={() => setMhrViewMode('table')}>Rate Table</Button>
            <Button variant={mhrViewMode === 'calculator' ? 'secondary' : 'ghost'} size="sm" className="rounded-none h-9 text-xs px-3 border-0 border-l border-border" onClick={() => setMhrViewMode('calculator')}>Calculator</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadMhrTemplate}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />Template
            </Button>
            <Button size="sm" variant="outline" onClick={handleMhrExportCsv} disabled={!mhrData?.records?.length}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleMhrExportPdf} disabled={!mhrData?.records?.length}>
              <FileText className="h-3.5 w-3.5 mr-1.5" />PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={!mhrData?.records?.length || deleteAllMhrMutation.isPending}
              onClick={() => {
                if (confirm(`Delete all ${mhrData?.total ?? 0} MHR records? This cannot be undone.`)) {
                  deleteAllMhrMutation.mutate();
                }
              }}
            >
              <Eraser className="h-3.5 w-3.5 mr-1.5" />Clear All
            </Button>
            <Button size="sm" onClick={mhrViewMode === 'table' ? () => setIsSimpleMhrOpen(true) : handleMhrCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add MHR
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        {mhrData && mhrData.records.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <Card className="p-3 min-w-[90px]">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold">{mhrData.total}</p>
            </Card>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isMhrLoading ? (
              <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : mhrData?.records && mhrData.records.length > 0 ? (
              mhrViewMode === 'table' ? (
                /* ─ Rate Table mode (simplified Combined format view) ─ */
                <Table wrapperClassName="overflow-x-auto max-h-[calc(100vh-400px)]" className="w-max min-w-full text-xs">
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow className="bg-card hover:bg-card border-b-2">
                      <TableHead className="h-9 px-2 text-xs w-[36px] text-center">#</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[80px]">Location</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[110px]">Process Group</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[130px]">Process Sequence</TableHead>
                      <TableHead className="h-9 px-2 text-xs sticky left-0 bg-card z-20 w-[140px] border-r border-border">Machine Name</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[88px] text-blue-600">Direct OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[92px] text-indigo-600">Indirect OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[86px] text-primary font-semibold">Total OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[100px] text-green-600">Skill Rate ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs sticky right-0 bg-card z-20 w-[72px] border-l border-border text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mhrData.records.map((record, idx) => {
                      const totalOh = record.mhrUsdPerHour ?? (record.manualMHRValue ?? record.calculations.totalMachineHourRate);
                      return (
                        <TableRow key={record.id} className="hover:bg-muted/50">
                          <TableCell className="py-1.5 px-2 text-center text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="py-1.5 px-2">{record.location}</TableCell>
                          <TableCell className="py-1.5 px-2">{record.processGroup || record.commodityCode || '-'}</TableCell>
                          <TableCell className="py-1.5 px-2">{record.machineClass || '-'}</TableCell>
                          <TableCell className="py-1 px-1.5 font-medium sticky left-0 bg-card z-10 border-r border-border">{record.machineName}</TableCell>
                          <TableCell className="py-1.5 px-2 text-right text-blue-600">{record.directOverheadRate != null ? `$${record.directOverheadRate.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="py-1.5 px-2 text-right text-indigo-600">{record.indirectOverheadRate != null ? `$${record.indirectOverheadRate.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="py-1.5 px-2 text-right font-semibold text-primary">{totalOh != null ? `$${totalOh.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="py-1.5 px-2 text-right text-green-600">{record.usdLhrTotal != null ? `$${record.usdLhrTotal.toFixed(2)}` : '-'}</TableCell>
                          <TableCell className="py-1.5 px-2 sticky right-0 bg-card z-10 border-l border-border">
                            <div className="flex justify-center gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMhrEdit(record.id)}><Edit className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMhrDelete(record.id)} disabled={deleteMhrMutation.isPending}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                /* ─ Calculator mode (full detail) ─ */
                <Table wrapperClassName="overflow-x-auto max-h-[calc(100vh-400px)]" className="w-max min-w-full text-xs">
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow className="bg-card hover:bg-card border-b-2">
                      <TableHead className="h-9 px-2 text-xs sticky left-0 bg-card z-20 w-[130px] border-r border-border">Machine Name</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[72px]">Location</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[110px]">Process Group</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[100px]">Machine Class</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[90px]">Automation</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[70px]">Wage Grade</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-center w-[48px]">Ops</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[72px]">Mfr Cntry</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-center w-[46px]">Shfts</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-center w-[48px]">Hrs/Sh</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-center w-[52px]">Dys/Yr</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[80px]">Px (USD)</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[64px]">Currency</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[90px] text-primary font-semibold">MHR Local</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[68px] text-blue-600">MHR USD</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[90px] text-green-600">LHR Local</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[76px] text-green-700">LHR USD</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[112px]">Annual</TableHead>
                      <TableHead className="h-9 px-2 text-xs sticky right-0 bg-card z-20 w-[82px] border-l border-border text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mhrData.records.map(record => (
                      <TableRow key={record.id} className="hover:bg-muted/50">
                        <TableCell className="py-1 px-1.5 font-medium sticky left-0 bg-card z-10 border-r border-border">{record.machineName}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.location}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.processGroup || record.commodityCode || '-'}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.machineClass || '-'}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.automationLevel || '-'}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.wageGrade || '-'}</TableCell>
                        <TableCell className="py-1.5 px-2 text-center">{record.operators ?? '-'}</TableCell>
                        <TableCell className="py-1.5 px-2">{record.manufacturerCountry || '-'}</TableCell>
                        <TableCell className="py-1.5 px-2 text-center">{record.shiftsPerDay}</TableCell>
                        <TableCell className="py-1.5 px-2 text-center">{record.hoursPerShift}</TableCell>
                        <TableCell className="py-1.5 px-2 text-center">{record.workingDaysPerYear}</TableCell>
                        <TableCell className="py-1.5 px-2 text-right">{record.machinePriceUsd ? `$${record.machinePriceUsd.toLocaleString()}` : '-'}</TableCell>
                        <TableCell className="py-1.5 px-2 text-xs">
                          {(() => { const c = mhrCurrencyOf(record); return `${c.symbol} ${c.code}`; })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-right font-semibold text-primary">
                          {(() => {
                            const { symbol, fxRate } = mhrCurrencyOf(record);
                            const usdVal = record.mhrUsdPerHour ?? record.manualMHRValue ?? record.calculations.totalMachineHourRate;
                            const localVal = usdVal * fxRate;
                            const decimals = fxRate > 1 ? 0 : 2;
                            return `${symbol}${localVal.toLocaleString(undefined, { maximumFractionDigits: decimals })}`;
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-right text-blue-600">
                          {(() => {
                            const usd = record.mhrUsdPerHour ?? record.manualMHRValue ?? record.calculations.totalMachineHourRate;
                            return usd ? `$${usd.toFixed(2)}` : '-';
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-right text-green-600">
                          {(() => {
                            const { symbol, fxRate } = mhrCurrencyOf(record);
                            const usdLhr = record.usdLhrTotal;
                            if (usdLhr == null) return '-';
                            const localVal = usdLhr * fxRate;
                            const decimals = fxRate > 1 ? 0 : 2;
                            return `${symbol}${localVal.toLocaleString(undefined, { maximumFractionDigits: decimals })}`;
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-right text-green-700">
                          {record.usdLhrTotal != null ? `$${record.usdLhrTotal.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 text-right">
                          {(() => {
                            const { symbol, fxRate } = mhrCurrencyOf(record);
                            const effHrs = record.calculations.effectiveHoursPerYear > 0
                              ? record.calculations.effectiveHoursPerYear
                              : record.workingDaysPerYear * record.shiftsPerDay * record.hoursPerShift * (record.capacityUtilizationRate / 100);
                            const usdVal = record.mhrUsdPerHour ?? record.manualMHRValue ?? record.calculations.totalMachineHourRate;
                            const annualUsd = record.calculations.totalAnnualCost > 0
                              ? record.calculations.totalAnnualCost
                              : usdVal * effHrs;
                            if (!annualUsd) return '-';
                            const localAnnual = annualUsd * fxRate;
                            return `${symbol}${Math.round(localAnnual).toLocaleString()}`;
                          })()}
                        </TableCell>
                        <TableCell className="py-1.5 px-2 sticky right-0 bg-card z-10 border-l border-border">
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.push(`/mhr-database/${record.id}`)}><Calculator className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMhrEdit(record.id)}><Edit className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMhrDelete(record.id)} disabled={deleteMhrMutation.isPending}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Calculator className="h-10 w-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-semibold mb-1">No MHR Records</h3>
                <p className="text-xs text-muted-foreground mb-3">Get started by creating your first machine hour rate</p>
                <Button size="sm" onClick={mhrViewMode === 'table' ? () => setIsSimpleMhrOpen(true) : handleMhrCreate}><Plus className="h-3.5 w-3.5 mr-1.5" />Add MHR Record</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Simple MHR Dialog — Rate Table mode */}
        <Dialog open={isSimpleMhrOpen} onOpenChange={setIsSimpleMhrOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add Rate Table Entry</DialogTitle>
              <DialogDescription>Enter overhead rates in $/hr (Combined format)</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Location *</Label>
                  <Select value={simpleMhrForm.location || 'none'} onValueChange={v => setSimpleMhrForm(p => ({ ...p, location: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select location" /></SelectTrigger>
                    <SelectContent>
                      {MASTER_LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Process Group</Label>
                  <Input className="h-9 text-xs" placeholder="e.g. Machining" value={simpleMhrForm.processGroup} onChange={e => setSimpleMhrForm(p => ({ ...p, processGroup: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Process Sequence</Label>
                <Input className="h-9 text-xs" placeholder="e.g. Milling_Center 3axis" value={simpleMhrForm.machineClass} onChange={e => setSimpleMhrForm(p => ({ ...p, machineClass: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Machine Name *</Label>
                <Input className="h-9 text-xs" placeholder="e.g. VMC 3 Axis" value={simpleMhrForm.machineName} onChange={e => setSimpleMhrForm(p => ({ ...p, machineName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-blue-600">Direct OH Rate ($/hr) *</Label>
                  <Input className="h-9 text-xs" type="number" step="0.01" placeholder="0.00" value={simpleMhrForm.directOverheadRate} onChange={e => setSimpleMhrForm(p => ({ ...p, directOverheadRate: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-indigo-600">Indirect OH Rate ($/hr) *</Label>
                  <Input className="h-9 text-xs" type="number" step="0.01" placeholder="0.00" value={simpleMhrForm.indirectOverheadRate} onChange={e => setSimpleMhrForm(p => ({ ...p, indirectOverheadRate: e.target.value }))} />
                </div>
              </div>
              {simpleMhrForm.directOverheadRate && simpleMhrForm.indirectOverheadRate && (
                <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-md">
                  <span className="text-xs text-muted-foreground">Total OH Rate</span>
                  <span className="text-sm font-bold text-primary">
                    ${(parseFloat(simpleMhrForm.directOverheadRate || '0') + parseFloat(simpleMhrForm.indirectOverheadRate || '0')).toFixed(2)}/hr
                  </span>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-green-600">Skill Based Labor Rate ($/hr)</Label>
                <Input className="h-9 text-xs" type="number" step="0.01" placeholder="Optional" value={simpleMhrForm.usdLhrTotal} onChange={e => setSimpleMhrForm(p => ({ ...p, usdLhrTotal: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSimpleMhrOpen(false)}>Cancel</Button>
              <Button onClick={handleSimpleMhrSubmit} disabled={createMhrMutation.isPending}>{createMhrMutation.isPending ? 'Saving...' : 'Save'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <MHRFormDialog open={isMhrFormOpen} onOpenChange={setIsMhrFormOpen} editingId={editingMhrId} />
      </div>
    </div>
  );
}
