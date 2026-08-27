'use client';

import { useState, useRef, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { addAoaSheet, createWorkbook, downloadWorkbook } from '@/lib/utils/excel-browser';
import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  useMHRRecords,
  useMHRCurrencies,
  useMHRLocations,
  useDeleteMHR,
  useDeleteAllMHR,
  useImportMHRFromExcel,
} from '@/lib/api/hooks';
import { useFxRatesForCurrencies } from '@/lib/api/hooks/useFx';
import { getCurrencyForLocation } from '@/lib/utils/currency-locale';
import { MHRFormDialog } from '@/components/features/mhr/MHRFormDialog';
import { exportMHRToPDF } from '@/lib/utils/exportMHRToPDF';

// Symbol/currency-code lookup is the shared, non-hardcoded one (also used by
// MHRFormDialog/mhr-database) — never a local fuzzy-match duplicate. The FX
// RATE itself is never hardcoded here either: it comes from the live
// ECB/Frankfurter reference rate (useFxRatesForCurrencies), passed in by the
// caller — see fxRates in HRRatesPage. `?? 1` is only the safe "still
// loading" render state (same convention MHRFormDialog's own useFxRate call
// already uses), not a fabricated rate.
function mhrCurrencyOf(record: { location: string }, fxRates: Record<string, number | undefined>) {
  const { currency, symbol } = getCurrencyForLocation(record.location);
  const fxRate = currency === 'USD' ? 1 : (fxRates[currency] ?? 1);
  return { symbol, code: currency, fxRate };
}

// Real machine_library category (e.g. "Fiber Laser Cutting Machine"),

// `mhrUsdPerHour` is the only field mhr.service.ts guarantees is USD (it's
// computed explicitly from the local rate + live FX at save time).
// `manualMHRValue`/`calculations.totalMachineHourRate` are fundamentally
// LOCAL-currency fields (see CreateMHRDto's own "(INR)"-labeled field docs)
// — treating them as USD is exactly the bug found in migration 365's
// cnc_lathe_live/cnc_mill_turn seed rows (real local rates, e.g. India's
// ₹5500/hr or UK's £105.40/hr, both shown with a hardcoded "$" prefix).
// Never blend the two: an unconverted local figure with no confirmed USD
// value returns usd: null rather than guessing.
function mhrTotalRate(
  record: {
    mhrUsdPerHour?: number;
    manualMHRValue?: number;
    calculations: { totalMachineHourRate: number };
    location: string;
  },
  fxRates: Record<string, number | undefined>,
): { usd: number | null; local: number | null; symbol: string; code: string; fxRate: number } {
  const { symbol, code, fxRate } = mhrCurrencyOf(record, fxRates);
  if (record.mhrUsdPerHour != null) {
    return { usd: record.mhrUsdPerHour, local: record.mhrUsdPerHour * fxRate, symbol, code, fxRate };
  }
  const localFallback = record.manualMHRValue ?? record.calculations.totalMachineHourRate;
  if (localFallback) {
    return { usd: code === 'USD' ? localFallback : null, local: localFallback, symbol, code, fxRate };
  }
  return { usd: null, local: null, symbol, code, fxRate };
}

// Raw display for the Tier 1 machine_library.json economics/lifecycle
// columns (migration 573) — these are heterogeneous units (mm, kW, yr,
// %, bare fractions) with no single shared conversion, so unlike the
// $/hr columns above this never prefixes a currency symbol or rescales
// the value; it only formats the number the column already carries.
function fmtNum(v?: number | null): string {
  if (v === null || v === undefined) return '-';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export default function HRRatesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ─── MHR state ────────────────────────────────────────────────────────────
  const [mhrSearch, setMhrSearch] = useState('');
  const [mhrLocation, setMhrLocation] = useState('');
  const [mhrCurrency, setMhrCurrency] = useState('');
  // Defaults to Sheet Metal — this repo's current domain focus (see
  // CLAUDE.md: Machining/Injection Molding haven't started as domains yet).
  // The real CNC Machining/Injection Molding/Turning/Inspection rows stay in
  // the DB (the live cost engine reads them) but don't clutter this page's
  // default view — "All Process Groups" still reaches them on request.
  const [mhrProcessGroupFilter, setMhrProcessGroupFilter] = useState('Sheet Metal');
  const [isMhrFormOpen, setIsMhrFormOpen] = useState(false);
  const [editingMhrId, setEditingMhrId] = useState<string | null>(null);

  // Load every record in one page — the table itself scrolls, so there's no
  // pagination UI to advance a "page 2" and no limit should hide rows.
  // Process Group is deliberately NOT sent to the server: the backend's
  // filter does an exact `process_group = ...` match, but most pre-existing
  // rows (everything imported before this session) never had process_group
  // set at all — only commodity_code. The table's own display already
  // falls back to commodityCode (see effectiveProcessGroupOf below); a
  // server-side exact-match filter that doesn't know about that fallback
  // silently dropped ~95% of real Sheet Metal rows. Filtering client-side
  // with the identical fallback keeps the filter and the display honest
  // about what "Sheet Metal" actually means for this data.
  const { data: mhrData, isLoading: isMhrLoading } = useMHRRecords({
    search: mhrSearch,
    ...(mhrLocation ? { location: mhrLocation } : {}),
    ...(mhrCurrency ? { currency: mhrCurrency } : {}),
    limit: 10000,
  });
  const { data: mhrCurrencies = [] } = useMHRCurrencies();
  const { data: mhrLocations = [] } = useMHRLocations();

  const effectiveProcessGroupOf = (r: { processGroup?: string; commodityCode: string }) =>
    r.processGroup || r.commodityCode || '-';

  const filteredMhrRecords = useMemo(() => {
    const records = mhrData?.records ?? [];
    if (!mhrProcessGroupFilter) return records;
    return records.filter(r => effectiveProcessGroupOf(r) === mhrProcessGroupFilter);
  }, [mhrData?.records, mhrProcessGroupFilter]);

  // Real distinct process groups AS ACTUALLY DISPLAYED (processGroup ??
  // commodityCode) — not useMHRProcessGroups(), which only queries the real
  // process_group column and would miss every commodityCode-only group.
  const mhrProcessGroupOptions = useMemo(() => {
    const groups = (mhrData?.records ?? []).map(effectiveProcessGroupOf).filter(g => g !== '-');
    return [...new Set(groups)].sort();
  }, [mhrData?.records]);

  // Live ECB/Frankfurter reference rates for every distinct currency the
  // currently-loaded rows actually need — never a hardcoded rate table.
  const fxRates = useFxRatesForCurrencies(
    filteredMhrRecords.map(r => getCurrencyForLocation(r.location).currency),
  );
  const deleteMhrMutation = useDeleteMHR();
  const deleteAllMhrMutation = useDeleteAllMHR();
  const importMhrMutation = useImportMHRFromExcel();

  // Rate Table groups by real machine category (mirrors machine_library.json's
  // own categories -> machines structure) instead of one flat list — a
  // category not in this set renders expanded (the default).
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  };
  const groupedMhrRecords = useMemo(() => {
    const byCategory = new Map<string, typeof filteredMhrRecords>();
    for (const r of filteredMhrRecords) {
      const cat = mhrCategoryOf(r);
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(r);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredMhrRecords]);
  const allCategoriesCollapsed = groupedMhrRecords.length > 0 && groupedMhrRecords.every(([category]) => collapsedCategories.has(category));
  const expandAllCategories = () => setCollapsedCategories(new Set());
  const collapseAllCategories = () => setCollapsedCategories(new Set(groupedMhrRecords.map(([category]) => category)));

  const handleMhrCreate = () => { setEditingMhrId(null); setIsMhrFormOpen(true); };
  const handleMhrEdit = (id: string) => { setEditingMhrId(id); setIsMhrFormOpen(true); };
  const handleMhrDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this MHR record?')) {
      await deleteMhrMutation.mutateAsync(id);
    }
  };

  const handleMhrExportCsv = () => {
    if (!filteredMhrRecords.length) return;
    const headers = [
      'Machine Name', 'Process Group', 'Machine Class', 'Wage Grade', 'Location', 'Currency', 'Manufacturer', 'Manufacturer Country', 'Machine Price (USD)', 'Automation Level', 'MHR Local/hr', 'LHR Local/hr', 'LHR USD/hr', 'Annual Cost', 'Created At',
      'Labor Time Standard', 'Avg Utilization', 'Good Part Yield', 'Machine Length (mm)', 'Machine Width (mm)', 'Machine Life (yr)', 'Machine Power (kW)', 'Machine Uptime (%)', 'Annual Maintenance (%)', 'Footprint Allowance Factor', 'Installation (%)',
    ];
    const rows = filteredMhrRecords.map(r => {
      const { symbol, code, fxRate, local: localMhr, usd: usdMhr } = mhrTotalRate(r, fxRates);
      const usdLhr = r.usdLhrTotal;
      const localLhr = usdLhr != null ? usdLhr * fxRate : null;
      const effHrs = r.calculations.effectiveHoursPerYear > 0
        ? r.calculations.effectiveHoursPerYear
        : r.workingDaysPerYear * r.shiftsPerDay * r.hoursPerShift * (r.capacityUtilizationRate / 100);
      // Annual cost needs a confirmed USD rate — a row with only a local
      // fallback (usdMhr === null) reports '-' rather than guessing.
      const annualLocal = usdMhr != null
        ? (r.calculations.totalAnnualCost > 0 ? r.calculations.totalAnnualCost * fxRate : usdMhr * effHrs * fxRate)
        : null;
      return [
        r.machineName, r.processGroup || r.commodityCode || '-', mhrCategoryOf(r),
        r.wageGrade || '-', r.location, `${symbol} ${code}`, r.manufacturer || '-',
        r.manufacturerCountry || '-', r.machinePriceUsd != null ? `$${r.machinePriceUsd.toLocaleString()}` : '-',
        r.automationLevel || '-',
        localMhr != null ? `${symbol}${localMhr.toFixed(fxRate > 1 ? 0 : 2)}` : '-',
        localLhr != null ? `${symbol}${localLhr.toFixed(fxRate > 1 ? 0 : 2)}` : '-',
        usdLhr != null ? `$${usdLhr.toFixed(2)}` : '-',
        annualLocal != null ? `${symbol}${Math.round(annualLocal).toLocaleString()}` : '-',
        new Date(r.createdAt).toLocaleDateString(),
        fmtNum(r.laborTimeStandard), fmtNum(r.avgUtilization), fmtNum(r.goodPartYield),
        fmtNum(r.machineLengthMm), fmtNum(r.machineWidthMm), fmtNum(r.machineLifeYr),
        fmtNum(r.machinePowerKw), fmtNum(r.machineUptimePct), fmtNum(r.annualMaintenanceFactorPct),
        fmtNum(r.footprintAllowanceFactor), fmtNum(r.installationFactorPct),
      ];
    });
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `mhr-database-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const handleMhrExportPdf = () => {
    if (!filteredMhrRecords.length) return;
    exportMHRToPDF({ records: filteredMhrRecords, companyName: 'Your Company Name', companyAddress: 'Your Company Address' });
  };

  const handleMhrDownloadJson = () => {
    if (!filteredMhrRecords.length) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      totalRecords: filteredMhrRecords.length,
      exportedCount: filteredMhrRecords.length,
      records: filteredMhrRecords,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr-rates-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
  const downloadMhrTemplate = async () => {
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
    const wb = createWorkbook();
    addAoaSheet(wb, 'MHR', [headers, sample], headers.map(() => 22));
    await downloadWorkbook(wb, 'MHR_Import_Template.xlsx');
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
            {isImporting ? 'Importing...' : 'Import Excel/CSV'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
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
          <Select value={mhrProcessGroupFilter || 'all'} onValueChange={v => setMhrProcessGroupFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="All Process Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Process Groups</SelectItem>
              {mhrProcessGroupOptions.map(pg => (
                <SelectItem key={pg} value={pg}>{pg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={mhrLocation || 'all'} onValueChange={v => setMhrLocation(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="All Locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {mhrLocations.map(loc => (
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
          {groupedMhrRecords.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={allCategoriesCollapsed ? expandAllCategories : collapseAllCategories}
            >
              {allCategoriesCollapsed ? (
                <><ChevronDown className="h-3.5 w-3.5 mr-1.5" />Expand All</>
              ) : (
                <><ChevronRight className="h-3.5 w-3.5 mr-1.5" />Collapse All</>
              )}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { void downloadMhrTemplate(); }}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />Template
            </Button>
            <Button size="sm" variant="outline" onClick={handleMhrExportCsv} disabled={!filteredMhrRecords.length}>
              <FileDown className="h-3.5 w-3.5 mr-1.5" />CSV
            </Button>
            <Button size="sm" variant="outline" onClick={handleMhrExportPdf} disabled={!filteredMhrRecords.length}>
              <FileText className="h-3.5 w-3.5 mr-1.5" />PDF
            </Button>
            <Button size="sm" variant="outline" onClick={handleMhrDownloadJson} disabled={!filteredMhrRecords.length} title="Download all HR rate records as JSON">
              <FileDown className="h-3.5 w-3.5 mr-1.5" />JSON
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
            <Button size="sm" onClick={handleMhrCreate}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Add MHR
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        {filteredMhrRecords.length > 0 && (
          <div className="flex flex-wrap gap-3">
            <Card className="p-3 min-w-[90px]">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-2xl font-bold">{filteredMhrRecords.length}</p>
            </Card>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isMhrLoading ? (
              <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
            ) : filteredMhrRecords.length > 0 ? (
              /* ─ Rate Table (simplified Combined format view) ─ */
              (
                <Table wrapperClassName="overflow-x-auto max-h-[calc(100vh-400px)]" className="w-max min-w-full text-xs">
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow className="bg-card hover:bg-card border-b-2">
                      <TableHead className="h-9 px-2 text-xs w-[36px] text-center">#</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[80px]">Location</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[110px]">Process Group</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[150px]">Category</TableHead>
                      <TableHead className="h-9 px-2 text-xs sticky left-0 bg-card z-20 w-[160px] border-r border-border">Machine Name</TableHead>
                      <TableHead className="h-9 px-2 text-xs w-[100px]">Wage Grade</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[88px] text-blue-600">Direct OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[92px] text-indigo-600">Indirect OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[86px] text-primary font-semibold">Total OH ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[90px] text-purple-600">MHR ($/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[100px] text-green-600">LHR (USD/hr)</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[100px]">Machine Price ($)</TableHead>
                      <TableHead className="h-9 px-2 text-xs sticky right-0 bg-card z-20 w-[72px] border-l border-border text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedMhrRecords.map(([category, records]) => {
                      const isCollapsed = collapsedCategories.has(category);
                      return (
                        <Fragment key={category}>
                          <TableRow className="bg-muted/60 hover:bg-muted/70 cursor-pointer border-b" onClick={() => toggleCategory(category)}>
                            <TableCell colSpan={13} className="py-1.5 px-2">
                              <div className="flex items-center gap-1.5 text-xs font-semibold">
                                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                {category}
                                <span className="text-muted-foreground font-normal">({records.length})</span>
                              </div>
                            </TableCell>
                          </TableRow>
                          {!isCollapsed && records.map((record, idx) => {
                            const mhrRate = mhrTotalRate(record, fxRates);
                            return (
                              <TableRow key={record.id} className="hover:bg-muted/50">
                                <TableCell className="py-1.5 px-2 text-center text-muted-foreground">{idx + 1}</TableCell>
                                <TableCell className="py-1.5 px-2">{record.location}</TableCell>
                                <TableCell className="py-1.5 px-2">{record.processGroup || record.commodityCode || '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 truncate" title={mhrCategoryOf(record)}>{mhrCategoryOf(record)}</TableCell>
                                <TableCell className="py-1 px-1.5 font-medium sticky left-0 bg-card z-10 border-r border-border">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate">{record.machineName}</span>
                                    {!record.userId && (
                                      <span
                                        className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-[9px] font-medium px-1.5 py-0.5"
                                        title="Global benchmark reference data (machine_library) — not owned by any shop/organization"
                                      >
                                        Global
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="py-1.5 px-2">{record.wageGrade || '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 text-right text-blue-600">{record.directOverheadRate != null ? `$${record.directOverheadRate.toFixed(2)}` : '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 text-right text-indigo-600">{record.indirectOverheadRate != null ? `$${record.indirectOverheadRate.toFixed(2)}` : '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 text-right font-semibold text-primary">
                                  {record.directOverheadRate != null || record.indirectOverheadRate != null
                                    ? `$${((record.directOverheadRate || 0) + (record.indirectOverheadRate || 0)).toFixed(2)}`
                                    : '-'}
                                </TableCell>
                                <TableCell className="py-1.5 px-2 text-right text-purple-600">
                                  {record.calculatedMhrUsdHr != null ? (
                                    <span title="Calculated from real machine economics (price, life, salvage, maintenance, installation, supplies, uptime, utilization) — independent of overhead and labor.">
                                      ${record.calculatedMhrUsdHr.toFixed(2)}
                                      <span className="ml-1 text-[9px] font-medium text-muted-foreground align-middle">calc</span>
                                    </span>
                                  ) : mhrRate.usd != null
                                    ? <span title="Legacy value — no machine economics on file to calculate a real MHR yet">${mhrRate.usd.toFixed(2)}</span>
                                    : mhrRate.local != null
                                      ? <span title={`No confirmed USD conversion on file — showing local currency (${mhrRate.code})`}>{mhrRate.symbol}{mhrRate.local.toFixed(2)}</span>
                                      : '-'}
                                </TableCell>
                                <TableCell className="py-1.5 px-2 text-right text-green-600">{record.usdLhrTotal != null ? `$${record.usdLhrTotal.toFixed(2)}` : '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 text-right">{record.machinePriceUsd != null ? `$${record.machinePriceUsd.toLocaleString()}` : '-'}</TableCell>
                                <TableCell className="py-1.5 px-2 sticky right-0 bg-card z-10 border-l border-border">
                                  <div className="flex justify-center gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleMhrEdit(record.id)}><Edit className="h-3.5 w-3.5" /></Button>
                                    <Button
                                      variant="ghost" size="icon" className="h-7 w-7"
                                      onClick={() => handleMhrDelete(record.id)}
                                      disabled={deleteMhrMutation.isPending || !record.userId}
                                      title={!record.userId ? 'Global reference machines can’t be deleted here' : undefined}
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Calculator className="h-10 w-10 text-muted-foreground mb-3" />
                <h3 className="text-base font-semibold mb-1">No MHR Records</h3>
                <p className="text-xs text-muted-foreground mb-3">Get started by creating your first machine hour rate</p>
                <Button size="sm" onClick={handleMhrCreate}><Plus className="h-3.5 w-3.5 mr-1.5" />Add MHR Record</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <MHRFormDialog open={isMhrFormOpen} onOpenChange={setIsMhrFormOpen} editingId={editingMhrId} />
      </div>
    </div>
  );
}
