'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  FileDown,
  FileText,
  Edit,
  Trash2,
  Calculator,
  Pencil,
  TrendingUp,
  Users,
  Upload,
  Loader2,
  Eraser,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useMHRRecords,
  useDeleteMHR,
  useDeleteAllMHR,
  useImportMHRFromExcel,
} from '@/lib/api/hooks';
import { useLSR, useCreateLSR, useUpdateLSR, useDeleteLSR, useLSRStatistics, useImportLSRFromExcel } from '@/lib/api/hooks';
import { useImportProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { MHRFormDialog } from '@/components/features/mhr/MHRFormDialog';
import { formatCurrency } from '@/lib/utils';
import { exportMHRToPDF } from '@/lib/utils/exportMHRToPDF';
import { CreateLSRDto, LSREntry } from '@/lib/api/lsr';

export default function HRRatesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // ─── MHR state ────────────────────────────────────────────────────────────
  const [mhrSearch, setMhrSearch] = useState('');
  const [isMhrFormOpen, setIsMhrFormOpen] = useState(false);
  const [editingMhrId, setEditingMhrId] = useState<string | null>(null);

  const { data: mhrData, isLoading: isMhrLoading } = useMHRRecords({ search: mhrSearch, limit: 50 });
  const deleteMhrMutation = useDeleteMHR();
  const deleteAllMhrMutation = useDeleteAllMHR();
  const importMhrMutation = useImportMHRFromExcel();


  const handleMhrCreate = () => { setEditingMhrId(null); setIsMhrFormOpen(true); };
  const handleMhrEdit = (id: string) => { setEditingMhrId(id); setIsMhrFormOpen(true); };
  const handleMhrDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this MHR record?')) {
      await deleteMhrMutation.mutateAsync(id);
    }
  };

  const handleMhrExportCsv = () => {
    if (!mhrData?.records?.length) return;
    const headers = ['Machine Name', 'Process Group', 'Machine Class', 'Wage Grade', 'Location', 'Manufacturer', 'Automation Level', 'MHR (₹/hr)', 'LHR (₹/hr)', 'USD LHR Total', 'Annual Cost (₹)', 'Created At'];
    const rows = mhrData.records.map(r => [
      r.machineName, r.processGroup || r.commodityCode || '-', r.machineClass || '-',
      r.wageGrade || '-', r.location, r.manufacturer || '-', r.automationLevel || '-',
      r.calculations.totalMachineHourRate.toFixed(2), r.lhrInrPerHr?.toFixed(2) || '-',
      r.usdLhrTotal ? `$${r.usdLhrTotal.toFixed(2)}` : '-',
      r.calculations.totalAnnualCost.toFixed(2), new Date(r.createdAt).toLocaleDateString(),
    ]);
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

  // ─── LHR state ────────────────────────────────────────────────────────────
  const [lhrSearch, setLhrSearch] = useState('');
  const [isCreateLhrOpen, setIsCreateLhrOpen] = useState(false);
  const [isEditLhrOpen, setIsEditLhrOpen] = useState(false);
  const [deleteLhrId, setDeleteLhrId] = useState<number | string | null>(null);
  const [editingLhrEntry, setEditingLhrEntry] = useState<LSREntry | null>(null);
  const [workingConfig, setWorkingConfig] = useState({ workingDaysPerYear: 0, shiftsPerDay: 0, hoursPerShift: 0 });
  const workingHoursPerYear = React.useMemo(
    () => workingConfig.workingDaysPerYear * workingConfig.shiftsPerDay * workingConfig.hoursPerShift,
    [workingConfig.workingDaysPerYear, workingConfig.shiftsPerDay, workingConfig.hoursPerShift]
  );

  const { data: lsrEntries = [], isLoading: isLhrLoading, error: lsrError } = useLSR(lhrSearch);
  const { data: lhrStatistics, error: statsError } = useLSRStatistics();
  const createLhrMutation = useCreateLSR();
  const updateLhrMutation = useUpdateLSR();
  const deleteLhrMutation = useDeleteLSR();
  const importLsrMutation = useImportLSRFromExcel();
  const importProcessesMutation = useImportProcessCalculatorMappings();

  const loadDraft = () => {
    if (typeof window === 'undefined') return null;
    try { const d = localStorage.getItem('lsr-form-draft'); return d ? JSON.parse(d) : null; } catch { return null; }
  };

  type LSRFormData = Omit<CreateLSRDto, 'minimumWagePerDay' | 'minimumWagePerMonth' | 'dearnessAllowance' | 'perksPercentage' | 'lhr' | 'usdLaborRatePerHr' | 'usdLhrBase' | 'usdLhrBurden' | 'usdLhrTotal'> & {
    minimumWagePerDay: number | '';
    minimumWagePerMonth: number | '';
    dearnessAllowance: number | '';
    perksPercentage: number | '';
    lhr: number | '';
    usdLaborRatePerHr?: number | '';
    usdLhrBase?: number | '';
    usdLhrBurden?: number | '';
    usdLhrTotal?: number | '';
  };

  const emptyLhrForm: LSRFormData = { labourCode: '', labourType: '', description: '', minimumWagePerDay: '', minimumWagePerMonth: '', dearnessAllowance: '', perksPercentage: '', lhr: '', location: '', machineDescription: '' };
  const [lhrFormData, setLhrFormData] = useState<LSRFormData>(() => loadDraft() || emptyLhrForm);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('lsr-form-draft', JSON.stringify(lhrFormData));
  }, [lhrFormData]);

  const handleLhrInput = (field: keyof LSRFormData, value: string | number) => setLhrFormData(prev => ({ ...prev, [field]: value }));

  const handleLabourTypeChange = (labourType: string) => {
    setLhrFormData(prev => {
      const isAuto = !prev.labourCode || ['UN-L-','SS-L-','SK-L-','HS-L-','SV-L-','MG-L-'].some(p => (prev.labourCode as string).startsWith(p));
      if (!isAuto) return { ...prev, labourType };
      const prefix = labourType === 'Unskilled' ? 'UN-L-' : labourType === 'Semi-Skilled' ? 'SS-L-' : labourType === 'Skilled' ? 'SK-L-' : labourType === 'Highly Skilled' ? 'HS-L-' : labourType === 'Supervisor' ? 'SV-L-' : labourType === 'Manager' ? 'MG-L-' : 'LB-L-';
      const next = lsrEntries.filter(e => e.labourCode.startsWith(prefix)).length + 1;
      const monthlyWage = labourType === 'Unskilled' ? 12000 : labourType === 'Semi-Skilled' ? 18000 : labourType === 'Skilled' ? 25000 : labourType === 'Highly Skilled' ? 35000 : labourType === 'Supervisor' ? 45000 : labourType === 'Manager' ? 60000 : 15000;
      return { ...prev, labourType, labourCode: `${prefix}${next}`, minimumWagePerMonth: prev.minimumWagePerMonth === '' || prev.minimumWagePerMonth === 0 ? monthlyWage : prev.minimumWagePerMonth, minimumWagePerDay: prev.minimumWagePerDay === '' || prev.minimumWagePerDay === 0 ? parseFloat((monthlyWage / 30).toFixed(2)) : prev.minimumWagePerDay, dearnessAllowance: prev.dearnessAllowance === '' || prev.dearnessAllowance === 0 ? Math.round(monthlyWage * 0.05) : prev.dearnessAllowance, perksPercentage: prev.perksPercentage === '' || prev.perksPercentage === 0 ? 30 : prev.perksPercentage };
    });
  };

  const handleLhrNum = (field: keyof LSRFormData, val: string) => {
    if (val === '') { setLhrFormData(prev => ({ ...prev, [field]: '' })); return; }
    const n = parseFloat(val);
    setLhrFormData(prev => ({ ...prev, [field]: isNaN(n) ? '' : n }));
  };

  const daysPerMonth = 30;
  const handleDayWage = (val: string) => {
    if (val === '') { setLhrFormData(prev => ({ ...prev, minimumWagePerDay: 0, minimumWagePerMonth: 0 })); return; }
    const d = parseFloat(val);
    if (!isNaN(d)) setLhrFormData(prev => ({ ...prev, minimumWagePerDay: d, minimumWagePerMonth: parseFloat((d * daysPerMonth).toFixed(2)) }));
  };
  const handleMonthWage = (val: string) => {
    if (val === '') { setLhrFormData(prev => ({ ...prev, minimumWagePerMonth: '', minimumWagePerDay: '' })); return; }
    const m = parseFloat(val);
    if (!isNaN(m)) setLhrFormData(prev => ({ ...prev, minimumWagePerMonth: m, minimumWagePerDay: parseFloat((m / daysPerMonth).toFixed(2)) }));
  };

  const calculatedLHR = useMemo(() => {
    const m = typeof lhrFormData.minimumWagePerMonth === 'number' ? lhrFormData.minimumWagePerMonth : 0;
    const da = typeof lhrFormData.dearnessAllowance === 'number' ? lhrFormData.dearnessAllowance : 0;
    const p = typeof lhrFormData.perksPercentage === 'number' ? lhrFormData.perksPercentage : 0;
    if (workingHoursPerYear === 0 || (m === 0 && da === 0)) return 0;
    return parseFloat(((m + da) * (1 + p / 100) * 12 / workingHoursPerYear).toFixed(2));
  }, [lhrFormData.minimumWagePerMonth, lhrFormData.dearnessAllowance, lhrFormData.perksPercentage, workingHoursPerYear]);

  useEffect(() => { setLhrFormData(prev => prev.lhr !== calculatedLHR ? { ...prev, lhr: calculatedLHR } : prev); }, [calculatedLHR]);

  const resetLhrForm = () => {
    setLhrFormData(emptyLhrForm);
    if (typeof window !== 'undefined') localStorage.removeItem('lsr-form-draft');
  };

  const toLhrSubmit = () => {
    const base: any = {
      ...lhrFormData,
      labourCode: (lhrFormData.labourCode as string).trim(),
      minimumWagePerDay: typeof lhrFormData.minimumWagePerDay === 'number' ? lhrFormData.minimumWagePerDay : 0,
      minimumWagePerMonth: typeof lhrFormData.minimumWagePerMonth === 'number' ? lhrFormData.minimumWagePerMonth : 0,
      dearnessAllowance: typeof lhrFormData.dearnessAllowance === 'number' ? lhrFormData.dearnessAllowance : 0,
      perksPercentage: typeof lhrFormData.perksPercentage === 'number' ? lhrFormData.perksPercentage : 0,
      lhr: typeof lhrFormData.lhr === 'number' ? lhrFormData.lhr : 0,
    };
    if (typeof lhrFormData.usdLaborRatePerHr === 'number') base.usdLaborRatePerHr = lhrFormData.usdLaborRatePerHr;
    if (typeof lhrFormData.usdLhrBase === 'number') base.usdLhrBase = lhrFormData.usdLhrBase;
    if (typeof lhrFormData.usdLhrBurden === 'number') base.usdLhrBurden = lhrFormData.usdLhrBurden;
    if (typeof lhrFormData.usdLhrTotal === 'number') base.usdLhrTotal = lhrFormData.usdLhrTotal;
    return base;
  };

  const handleLhrCreate = async () => {
    const code = (lhrFormData.labourCode as string).trim();
    if (lsrEntries.find(e => e.labourCode.toLowerCase() === code.toLowerCase())) { toast.error(`Labour code "${code}" already exists`); return; }
    const missing = [!code && 'Labour Code', !lhrFormData.labourType && 'Labour Type'].filter(Boolean);
    if (missing.length) { toast.error('Please fill in all required fields', { description: `Missing: ${missing.join(', ')}` }); return; }
    if (workingHoursPerYear === 0) { toast.error('Please configure working hours first'); return; }
    await createLhrMutation.mutateAsync(toLhrSubmit() as CreateLSRDto);
    setIsCreateLhrOpen(false);
    resetLhrForm();
  };

  const handleLhrEdit = (entry: LSREntry) => {
    setEditingLhrEntry(entry);
    setLhrFormData({
      labourCode: entry.labourCode, labourType: entry.labourType, description: entry.description,
      minimumWagePerDay: entry.minimumWagePerDay, minimumWagePerMonth: entry.minimumWagePerMonth,
      dearnessAllowance: entry.dearnessAllowance, perksPercentage: entry.perksPercentage,
      lhr: entry.lhr, location: entry.location,
      processGroup: entry.processGroup, machineName: entry.machineName,
      machineDescription: entry.machineDescription,
      wageGrade: entry.wageGrade, operators: entry.operators,
      manufacturerCountry: entry.manufacturerCountry, manufacturer: entry.manufacturer,
      ...(entry.usdLaborRatePerHr !== undefined && { usdLaborRatePerHr: entry.usdLaborRatePerHr }),
      ...(entry.usdLhrBase !== undefined && { usdLhrBase: entry.usdLhrBase }),
      ...(entry.usdLhrBurden !== undefined && { usdLhrBurden: entry.usdLhrBurden }),
      ...(entry.usdLhrTotal !== undefined && { usdLhrTotal: entry.usdLhrTotal }),
    } as LSRFormData);
    setWorkingConfig({
      workingDaysPerYear: entry.workingDaysPerYear ?? 260,
      shiftsPerDay: entry.shiftsPerDay ?? 2,
      hoursPerShift: entry.hoursPerShift ?? 8,
    });
    setIsEditLhrOpen(true);
  };

  const handleLhrUpdate = async () => {
    if (!editingLhrEntry) return;
    const code = (lhrFormData.labourCode as string).trim();
    if (lsrEntries.find(e => e.id !== editingLhrEntry.id && e.labourCode.toLowerCase() === code.toLowerCase())) { toast.error(`Labour code "${code}" already exists`); return; }
    const missing = [!code && 'Labour Code', !lhrFormData.labourType && 'Labour Type'].filter(Boolean);
    if (missing.length) { toast.error('Please fill in all required fields', { description: `Missing: ${missing.join(', ')}` }); return; }
    if (workingHoursPerYear === 0) { toast.error('Please configure working hours first'); return; }
    await updateLhrMutation.mutateAsync({ id: editingLhrEntry.id, data: toLhrSubmit() });
    setIsEditLhrOpen(false);
    setEditingLhrEntry(null);
    setWorkingConfig({ workingDaysPerYear: 0, shiftsPerDay: 0, hoursPerShift: 0 });
    resetLhrForm();
  };

  const handleLhrDelete = async () => {
    if (deleteLhrId) { await deleteLhrMutation.mutateAsync(deleteLhrId); setDeleteLhrId(null); }
  };

  const hasLhrError = lsrError || statsError;
  const lhrErrorMsg = (lsrError as any)?.message || (statsError as any)?.message || '';
  const isTableMissing = lhrErrorMsg.includes('lsr_records') || lhrErrorMsg.includes('table');

  // ─── Shared Excel import ──────────────────────────────────────────────────
  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsImporting(true);
    try {
      await Promise.allSettled([
        importMhrMutation.mutateAsync(file),
        importLsrMutation.mutateAsync(file),
        importProcessesMutation.mutateAsync({ file, replaceExisting: false }),
      ]);
    } finally {
      setIsImporting(false);
    }
  };

  // ─── LHR form body (reused for create and edit dialogs) ───────────────────
  const renderLhrFormBody = () => (
    <div className="grid gap-4 py-4">
      <Card className={workingHoursPerYear === 0 ? 'border-orange-500/50' : 'border-green-500/50'}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            Working Hours Configuration
            {workingHoursPerYear === 0
              ? <span className="text-xs font-normal text-orange-600 bg-orange-50 px-2 py-1 rounded">Required — Enter values first</span>
              : <span className="text-xs font-normal text-green-600 bg-green-50 px-2 py-1 rounded">✓ Configured</span>}
          </CardTitle>
          <CardDescription className="text-xs">Example: 281 days × 2 shifts × 9 hrs = 5,058 hrs/year</CardDescription>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-4 gap-3">
            {[
              { id: 'days', label: 'Days/Year', ph: '281', field: 'workingDaysPerYear' as const, max: 365, parse: parseInt },
              { id: 'shifts', label: 'Shifts/Day', ph: '2', field: 'shiftsPerDay' as const, max: 3, parse: parseInt },
              { id: 'hours', label: 'Hours/Shift', ph: '9', field: 'hoursPerShift' as const, max: 24, parse: parseFloat },
            ].map(cfg => (
              <div key={cfg.id} className="space-y-1.5">
                <Label htmlFor={cfg.id} className="text-xs">{cfg.label} *</Label>
                <Input id={cfg.id} type="number" min="1" max={cfg.max} step={cfg.field === 'hoursPerShift' ? '0.5' : '1'} placeholder={cfg.ph}
                  value={workingConfig[cfg.field] || ''}
                  onChange={e => setWorkingConfig(prev => ({ ...prev, [cfg.field]: cfg.parse(e.target.value) || 0 }))}
                  className="text-base font-semibold h-9" />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-xs">Total Hrs/Year</Label>
              <div className={`text-base font-bold h-9 flex items-center justify-center rounded-md ${workingHoursPerYear > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-muted text-muted-foreground border'}`}>
                {workingHoursPerYear > 0 ? workingHoursPerYear.toLocaleString() : '---'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Labour Type* (Select first)</Label>
          <Select value={lhrFormData.labourType} onValueChange={handleLabourTypeChange}>
            <SelectTrigger><SelectValue placeholder="Select labour type..." /></SelectTrigger>
            <SelectContent>
              {['Unskilled','Semi-Skilled','Skilled','Highly Skilled','Supervisor','Manager'].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Labour Code* <span className="text-xs text-muted-foreground font-normal">(Auto-generated)</span></Label>
          <Input value={lhrFormData.labourCode} onChange={e => handleLhrInput('labourCode', e.target.value)} placeholder="Select labour type first..." className={lhrFormData.labourCode ? 'font-mono font-semibold' : ''} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description (optional)</Label>
        <Textarea value={lhrFormData.description} onChange={e => handleLhrInput('description', e.target.value)} placeholder="Job responsibilities and tasks..." rows={3} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Min Wage (₹/Day)* <span className="text-xs text-muted-foreground font-normal">(Auto-syncs)</span></Label>
          <Input type="number" value={lhrFormData.minimumWagePerDay} onChange={e => handleDayWage(e.target.value)} placeholder="e.g., 400" />
        </div>
        <div className="space-y-2">
          <Label>Min Wage (₹/Month)* <span className="text-xs text-muted-foreground font-normal">(Auto-syncs)</span></Label>
          <Input type="number" value={lhrFormData.minimumWagePerMonth} onChange={e => handleMonthWage(e.target.value)} placeholder="e.g., 12000" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>D.A (₹/Month)*</Label>
          <Input type="number" value={lhrFormData.dearnessAllowance} onChange={e => handleLhrNum('dearnessAllowance', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Perks (%)*</Label>
          <Input type="number" value={lhrFormData.perksPercentage} onChange={e => handleLhrNum('perksPercentage', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>LHR (₹/Hour)* <span className="text-xs text-muted-foreground font-normal">(Auto-calculated)</span></Label>
          <Input type="number" value={lhrFormData.lhr || 0} disabled className="bg-muted/50 font-semibold text-primary" />
          {workingHoursPerYear === 0
            ? <p className="text-xs text-orange-600">Configure working hours first to calculate LHR</p>
            : calculatedLHR > 0
              ? <p className="text-xs text-muted-foreground">= (Base+DA) × (1+Perks%) × 12 / {workingHoursPerYear.toLocaleString()} hrs</p>
              : <p className="text-xs text-muted-foreground">Enter wage data to calculate</p>}
        </div>
        <div className="space-y-2">
          <Label>Location</Label>
          <Input value={lhrFormData.location} onChange={e => handleLhrInput('location', e.target.value)} placeholder="e.g., India - Bangalore" />
        </div>
      </div>

      {/* Extended Details */}
      <div className="border-t pt-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extended Details (Optional)</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Process Group</Label>
            <Input value={lhrFormData.processGroup || ''} onChange={e => handleLhrInput('processGroup', e.target.value)} placeholder="e.g., Machining" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Machine Name</Label>
            <Input value={lhrFormData.machineName || ''} onChange={e => handleLhrInput('machineName', e.target.value)} placeholder="e.g., CNC Lathe" />
          </div>
          <div className="col-span-2 space-y-2">
            <Label className="text-sm">Machine Description</Label>
            <Input value={lhrFormData.machineDescription || ''} onChange={e => handleLhrInput('machineDescription', e.target.value)} placeholder="e.g., 3-axis CNC machining center" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Wage Grade</Label>
            <Input value={lhrFormData.wageGrade || ''} onChange={e => handleLhrInput('wageGrade', e.target.value)} placeholder="e.g., Grade 5, WG-7" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Operators</Label>
            <Input type="number" min="1" step="1" value={lhrFormData.operators ?? ''} onChange={e => { const v = parseInt(e.target.value); setLhrFormData(prev => ({ ...prev, operators: isNaN(v) || v <= 0 ? undefined : v } as LSRFormData)); }} placeholder="e.g., 1" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Manufacturer</Label>
            <Input value={lhrFormData.manufacturer || ''} onChange={e => handleLhrInput('manufacturer', e.target.value)} placeholder="e.g., ABC Corp" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Manufacturer Country</Label>
            <Input value={lhrFormData.manufacturerCountry || ''} onChange={e => handleLhrInput('manufacturerCountry', e.target.value)} placeholder="e.g., Japan" />
          </div>
        </div>
      </div>

      {/* USD LHR Rates */}
      <div className="border-t pt-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">USD LHR Rates (Optional)</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm">Labor Rate ($/hr/person)</Label>
            <Input type="number" step="0.01" min="0" value={lhrFormData.usdLaborRatePerHr ?? ''} onChange={e => handleLhrNum('usdLaborRatePerHr', e.target.value)} placeholder="e.g., 3.50" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">LHR Base ($/hr)</Label>
            <Input type="number" step="0.01" min="0" value={lhrFormData.usdLhrBase ?? ''} onChange={e => handleLhrNum('usdLhrBase', e.target.value)} placeholder="e.g., 3.50" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">LHR Burden ($/hr)</Label>
            <Input type="number" step="0.01" min="0" value={lhrFormData.usdLhrBurden ?? ''} onChange={e => handleLhrNum('usdLhrBurden', e.target.value)} placeholder="e.g., 1.33" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">LHR Total ($/hr)</Label>
            <Input type="number" step="0.01" min="0" value={lhrFormData.usdLhrTotal ?? ''} onChange={e => handleLhrNum('usdLhrTotal', e.target.value)} placeholder="e.g., 4.83" />
          </div>
        </div>
      </div>
    </div>
  );

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
            <p className="text-sm text-muted-foreground">Machine Hour Rate and Labour Hour Rate databases</p>
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

      {/* Tabs */}
      <Tabs defaultValue="mhr">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="mhr" className="gap-1.5 text-xs sm:text-sm">
            Machine Hour Rate
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">{mhrData?.total ?? 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="lhr" className="gap-1.5 text-xs sm:text-sm">
            Labour Hour Rate
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">{lsrEntries.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── MHR Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="mhr" className="space-y-4 mt-4">
          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by machine name..." value={mhrSearch} onChange={e => setMhrSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="flex flex-wrap gap-2">
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
              <Button size="sm" onClick={handleMhrCreate}>
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
              <Card className="p-3 min-w-[140px] border-primary/20 bg-primary/5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Avg MHR</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(mhrData.records.reduce((s, r) => s + r.calculations.totalMachineHourRate, 0) / mhrData.records.length)}</p>
              </Card>
              <Card className="p-3 min-w-[150px]">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Annual Cost</p>
                <p className="text-lg font-bold">{formatCurrency(mhrData.records.reduce((s, r) => s + r.calculations.totalAnnualCost, 0))}</p>
              </Card>
              <Card className="p-3 min-w-[90px]">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Locations</p>
                <p className="text-2xl font-bold">{new Set(mhrData.records.map(r => r.location)).size}</p>
              </Card>
            </div>
          )}

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {isMhrLoading ? (
                <div className="flex items-center justify-center h-48"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
              ) : mhrData?.records && mhrData.records.length > 0 ? (
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
                      <TableHead className="h-9 px-2 text-xs text-right w-[76px] text-primary font-semibold">MHR ₹/hr</TableHead>
                      <TableHead className="h-9 px-2 text-xs text-right w-[84px]">Annual ₹</TableHead>
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
                        <TableCell className="py-1.5 px-2 text-right font-semibold text-primary">{formatCurrency(record.calculations.totalMachineHourRate)}</TableCell>
                        <TableCell className="py-1.5 px-2 text-right">{formatCurrency(record.calculations.totalAnnualCost)}</TableCell>
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
        </TabsContent>

        {/* ── LHR Tab ─────────────────────────────────────────────────────── */}
        <TabsContent value="lhr" className="space-y-4 mt-4">
          {/* DB error */}
          {hasLhrError && isTableMissing && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Database Setup Required</CardTitle>
                <CardDescription>Run migration: <code className="bg-muted px-1 rounded">backend/src/database/migrations/002c_fix_lsr_table.sql</code></CardDescription>
              </CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{lhrErrorMsg}</p></CardContent>
            </Card>
          )}

          {/* Stats strip */}
          {lhrStatistics && (
            <div className="flex flex-wrap gap-3">
              <Card className="p-3 min-w-[90px]">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="text-2xl font-bold">{lhrStatistics.total}</p>
              </Card>
              <Card className="p-3 min-w-[140px] border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
                <p className="text-[11px] text-blue-600 uppercase tracking-wide">Avg LHR</p>
                <p className="text-lg font-bold text-blue-700">₹{lhrStatistics.averageLHR.toFixed(2)}</p>
                <p className="text-[11px] text-blue-500">per hour</p>
              </Card>
              <Card className="p-3 min-w-[100px]">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Skill Types</p>
                <p className="text-2xl font-bold">{Object.keys(lhrStatistics.byType).length}</p>
              </Card>
            </div>
          )}

          {/* Action bar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by code, type, or description..." value={lhrSearch} onChange={e => setLhrSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setIsCreateLhrOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />Add Labour Entry
              </Button>
            </div>
          </div>

          {/* Create Dialog */}
          <Dialog open={isCreateLhrOpen} onOpenChange={setIsCreateLhrOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add New Labour Entry</DialogTitle>
                <DialogDescription>Create a new labour entry with skill rate information</DialogDescription>
              </DialogHeader>
              {renderLhrFormBody()}
              <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
                <Button type="button" variant="ghost" onClick={resetLhrForm} className="sm:mr-auto">Clear Form</Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsCreateLhrOpen(false)}>Cancel</Button>
                  <Button onClick={handleLhrCreate} disabled={createLhrMutation.isPending}>{createLhrMutation.isPending ? 'Creating...' : 'Create'}</Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <Table wrapperClassName="overflow-x-auto max-h-[calc(100vh-400px)]" className="w-max min-w-full text-xs">
                <TableHeader className="sticky top-0 z-20 bg-card">
                  <TableRow className="bg-card hover:bg-card border-b-2">
                    <TableHead className="h-9 px-1.5 text-xs sticky left-0 bg-card z-20 w-[110px] border-r border-border">Machine/Code</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs w-[86px]">Proc Group</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs w-[58px]">Wg Grd</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs w-[74px]">Type</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs w-[80px]">Mfr</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs w-[60px]">Country</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-center w-[36px]">Ops</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-center w-[38px]">Sh</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-center w-[42px]">H/Sh</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-center w-[42px]">D/Yr</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-center w-[46px]">THrs</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[56px]">₹/Day</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[60px]">₹/Mo</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[46px]">DA</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[42px]">Prks</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[58px] text-primary font-semibold">LHR ₹</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[52px] text-slate-500">$USD</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[54px] text-slate-500">$Base</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[54px] text-slate-500">$Brdn</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs text-right w-[56px] text-blue-600">$LHR</TableHead>
                    <TableHead className="h-9 px-1.5 text-xs sticky right-0 bg-card z-20 w-[56px] border-l border-border text-center">Act</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLhrLoading ? (
                    <TableRow><TableCell colSpan={21} className="text-center py-8 text-muted-foreground text-xs">Loading...</TableCell></TableRow>
                  ) : lsrEntries.length === 0 ? (
                    <TableRow><TableCell colSpan={21} className="text-center py-8 text-muted-foreground text-xs">No labour entries found. Click "Add Labour Entry" to get started.</TableCell></TableRow>
                  ) : lsrEntries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="py-1 px-1.5 font-medium sticky left-0 bg-card z-10 border-r border-border">{entry.machineName || entry.labourCode}</TableCell>
                      <TableCell className="py-1 px-1.5">{entry.processGroup || '-'}</TableCell>
                      <TableCell className="py-1 px-1.5">{entry.wageGrade || '-'}</TableCell>
                      <TableCell className="py-1 px-1.5">{entry.labourType}</TableCell>
                      <TableCell className="py-1 px-1.5">{entry.manufacturer || '-'}</TableCell>
                      <TableCell className="py-1 px-1.5">{entry.manufacturerCountry || '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-center">{entry.operators ?? '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-center">{entry.shiftsPerDay ?? '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-center">{entry.hoursPerShift ?? '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-center">{entry.workingDaysPerYear ?? '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-center">{entry.totalHrsPerYear ? entry.totalHrsPerYear.toLocaleString() : '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right">{entry.minimumWagePerDay.toFixed(2)}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right">{entry.minimumWagePerMonth.toFixed(0)}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right">{entry.dearnessAllowance.toFixed(0)}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right">{entry.perksPercentage}%</TableCell>
                      <TableCell className="py-1 px-1.5 text-right font-semibold text-primary">{entry.lhr.toFixed(2)}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right text-slate-500">{entry.usdLaborRatePerHr ? `$${entry.usdLaborRatePerHr.toFixed(2)}` : '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right text-slate-500">{entry.usdLhrBase ? `$${entry.usdLhrBase.toFixed(2)}` : '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right text-slate-500">{entry.usdLhrBurden ? `$${entry.usdLhrBurden.toFixed(2)}` : '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 text-right font-semibold text-blue-600">{entry.usdLhrTotal ? `$${entry.usdLhrTotal.toFixed(2)}` : '-'}</TableCell>
                      <TableCell className="py-1 px-1.5 sticky right-0 bg-card z-10 border-l border-border">
                        <div className="flex justify-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleLhrEdit(entry)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDeleteLhrId(entry.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Edit Dialog */}
          <Dialog open={isEditLhrOpen} onOpenChange={setIsEditLhrOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Labour Entry</DialogTitle>
                <DialogDescription>Update labour entry information</DialogDescription>
              </DialogHeader>
              {renderLhrFormBody()}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsEditLhrOpen(false); setEditingLhrEntry(null); setWorkingConfig({ workingDaysPerYear: 0, shiftsPerDay: 0, hoursPerShift: 0 }); }}>Cancel</Button>
                <Button onClick={handleLhrUpdate} disabled={updateLhrMutation.isPending}>{updateLhrMutation.isPending ? 'Updating...' : 'Update'}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete dialog */}
          <AlertDialog open={deleteLhrId !== null} onOpenChange={() => setDeleteLhrId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete the labour entry.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleLhrDelete} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
