'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateMHR, useUpdateMHR, useMHRRecord } from '@/lib/api/hooks';
import { toast } from 'sonner';
import { useProcessHierarchy, useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { mhrFormSchema, type MHRFormData } from '@/lib/validations/mhrValidation';
import { getCurrencyForLocation as getCurrencyInfo } from '@/lib/utils/currency-locale';
import { useFxRate } from '@/lib/api/hooks/useFx';

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

const MASTER_LOCATIONS = ['China', 'E. Europe', 'France', 'Germany', 'India', 'Mexico', 'Other', 'USA', 'W. Europe'] as const;
const MACHINE_CLASS_OPTIONS = ['Heavy', 'Medium', 'Light', 'Micro'];
const AUTOMATION_LEVEL_OPTIONS = ['Manual', 'Semi-Automatic', 'Automatic', 'CNC', 'Robotic', 'Fully Automated'];

// USD/USA is this app's default currency, not INR/India — see migration
// 436_default_currency_usd_not_inr.sql's own doc comment for the full trace
// of why INR ever became the fallback in this codebase. A user opening this
// dialog to add a brand-new machine, before touching the location field at
// all, should see USA/USD defaults; India is a real, correct choice like any
// other once EXPLICITLY selected, never the unselected starting state.
const getDefaultValues = (): MHRFormData => ({
  location: 'USA',
  commodityCode: '',
  machineName: '',
  machineDescription: '',
  manufacturer: '',
  model: '',
  specification: '',
  // USA defaults — starting point only; no per-location fabricated
  // substitute is applied when the location changes (removed, see the
  // "Machine Economics" initiative in CLAUDE.md). The user enters real
  // figures for whatever location they pick.
  landedMachineCost: 50000,
  machineFootprintSqm: 10.00,
  rentPerSqmPerMonth: 15.00,
  powerKwhPerHour: 10.00,
  electricityCostPerKwh: 0.12,
  shiftsPerDay: 3.00,
  hoursPerShift: 8.00,
  workingDaysPerYear: 260.00,
  plannedMaintenanceHoursPerYear: 0.00,
  capacityUtilizationRate: 85.00,
  accessoriesCostPercentage: 8.00,
  installationCostPercentage: 20.00,
  paybackPeriodYears: 10.00,
  interestRatePercentage: 5.50,
  insuranceRatePercentage: 1.50,
  maintenanceCostPercentage: 7.00,
  adminOverheadPercentage: 12.00,
  profitMarginPercentage: 15.00,
  cuttableMaterials: '',
  specsJson: '',
});

// ── Location combobox: preset options + free-form typing ─────────────────────
function LocationCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);

  // Keep local input in sync when form resets (e.g. loading existing record)
  useEffect(() => { setInputValue(value); }, [value]);

  const filtered = MASTER_LOCATIONS.filter(loc =>
    loc.toLowerCase().includes(inputValue.toLowerCase()),
  );

  const commit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed) { onChange(trimmed); }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-10 px-3 text-sm"
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || 'Select or type location…'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Select or type (e.g. India - Pune)…"
            value={inputValue}
            onValueChange={v => { setInputValue(v); onChange(v); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(inputValue); } }}
          />
          <CommandList>
            {filtered.length === 0 && inputValue.trim() ? (
              <CommandEmpty>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 text-sm hover:bg-accent"
                  onClick={() => commit(inputValue)}
                >
                  Use &ldquo;<strong>{inputValue.trim()}</strong>&rdquo;
                </button>
              </CommandEmpty>
            ) : null}
            {filtered.length > 0 && (
              <CommandGroup heading="Standard locations">
                {filtered.map(loc => (
                  <CommandItem
                    key={loc}
                    value={loc}
                    onSelect={() => { setInputValue(loc); commit(loc); }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', value === loc ? 'opacity-100' : 'opacity-0')} />
                    {loc}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Small USD hint displayed next to local-currency inputs
function UsdHint({ localVal, fxRate }: { localVal: number; fxRate: number }) {
  if (!localVal || fxRate === 1) return null;
  const usd = localVal / fxRate;
  return (
    <p className="text-xs text-muted-foreground">
      ≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: usd < 10 ? 3 : 0 })} USD
    </p>
  );
}

// Economics provenance caveat (Phase 1, "Machine Economics" initiative) —
// only surfaces a note for the two non-authoritative tiers, mirroring
// machine-selection/selector.ts's reasons() convention of staying silent for
// 'imported'/real data and only speaking up for a benchmark or fallback
// value, so the source is never mistaken for this shop's own confirmed rate.
function EconomicsSourceNote({ source, benchmarkValue }: { source?: string | undefined; benchmarkValue?: number | undefined }) {
  if (source === 'benchmark') {
    return (
      <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">
        Industry benchmark{benchmarkValue !== undefined && benchmarkValue !== null ? ` ($${benchmarkValue.toFixed(2)}/hr)` : ''} — verify against this shop&apos;s actual cost.
      </p>
    );
  }
  if (source === 'generic_fallback') {
    return <p className="text-[11px] text-muted-foreground leading-tight">No rate on file — generic fallback applied.</p>;
  }
  return null;
}

export function MHRFormDialog({ open, onOpenChange, editingId }: MHRFormDialogProps) {
  const { data: existingRecord } = useMHRRecord(editingId || '', { enabled: !!editingId });
  const createMutation = useCreateMHR();
  const updateMutation = useUpdateMHR();

  const { data: processHierarchy } = useProcessHierarchy();
  const { data: allMappings } = useProcessCalculatorMappings();

  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedOperation, setSelectedOperation] = useState('');
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualMHRValue, setManualMHRValue] = useState(0);

  const HEADER_SKIP = new Set(['s.no', 'sno', 's no', 'sl no', 'basic info', 'location',
    'process group', 'process route', 'operation', 'name', 'type', 'category', 'description']);
  const isValidName = (v: string) => {
    const t = v?.trim();
    return (
      t && t.length > 0 && t.length <= 100 && isNaN(Number(t)) &&
      !t.includes('|') && !t.includes('USD→INR') && !t.includes('USD->INR') &&
      !HEADER_SKIP.has(t.toLowerCase())
    );
  };

  const processGroups = useMemo(() => {
    if (!processHierarchy?.processGroups) return [];
    return [...new Set(processHierarchy.processGroups)].filter(isValidName).map(g => ({ value: g, label: g }));
  }, [processHierarchy?.processGroups]);

  const processRoutes = useMemo(() => {
    if (!allMappings?.mappings || !selectedGroup) return [];
    const routes = allMappings.mappings.filter(m => m.processGroup === selectedGroup).map(m => m.processRoute);
    return [...new Set(routes)].filter(isValidName).map(r => ({ value: r, label: r }));
  }, [allMappings?.mappings, selectedGroup]);

  const operations = useMemo(() => {
    if (!allMappings?.mappings || !selectedGroup || !selectedRoute) return [];
    const ops = allMappings.mappings
      .filter(m => m.processGroup === selectedGroup && m.processRoute === selectedRoute)
      .map(m => m.operation);
    return [...new Set(ops)].filter(isValidName).map(o => ({ value: o, label: o }));
  }, [allMappings?.mappings, selectedGroup, selectedRoute]);

  const {
    register, handleSubmit, reset, setValue, control, watch,
    formState: { errors, isSubmitting },
  } = useForm<MHRFormData>({
    resolver: zodResolver(mhrFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onBlur',
  });

  const handleGroupChange = (group: string) => {
    setSelectedGroup(group); setSelectedRoute(''); setSelectedOperation('');
    setValue('commodityCode', group); setValue('specification', '');
  };
  const handleRouteChange = (route: string) => {
    setSelectedRoute(route); setSelectedOperation(''); setValue('specification', '');
  };
  const handleOperationChange = (op: string) => {
    setSelectedOperation(op); setValue('specification', op);
  };

  useEffect(() => {
    if (existingRecord) {
      reset({
        location: existingRecord.location,
        commodityCode: existingRecord.commodityCode,
        machineName: existingRecord.machineName,
        machineDescription: existingRecord.machineDescription || '',
        manufacturer: existingRecord.manufacturer || '',
        model: existingRecord.model || '',
        specification: existingRecord.specification || '',
        shiftsPerDay: existingRecord.shiftsPerDay,
        hoursPerShift: existingRecord.hoursPerShift,
        workingDaysPerYear: existingRecord.workingDaysPerYear,
        plannedMaintenanceHoursPerYear: existingRecord.plannedMaintenanceHoursPerYear,
        capacityUtilizationRate: existingRecord.capacityUtilizationRate,
        landedMachineCost: existingRecord.landedMachineCost,
        accessoriesCostPercentage: existingRecord.accessoriesCostPercentage,
        installationCostPercentage: existingRecord.installationCostPercentage,
        paybackPeriodYears: existingRecord.paybackPeriodYears,
        interestRatePercentage: existingRecord.interestRatePercentage,
        insuranceRatePercentage: existingRecord.insuranceRatePercentage,
        machineFootprintSqm: existingRecord.machineFootprintSqm,
        rentPerSqmPerMonth: existingRecord.rentPerSqmPerMonth,
        maintenanceCostPercentage: existingRecord.maintenanceCostPercentage,
        powerKwhPerHour: existingRecord.powerKwhPerHour,
        electricityCostPerKwh: existingRecord.electricityCostPerKwh,
        adminOverheadPercentage: existingRecord.adminOverheadPercentage,
        profitMarginPercentage: existingRecord.profitMarginPercentage,
        machineClass: existingRecord.machineClass || '',
        automationLevel: existingRecord.automationLevel || '',
        wageGrade: existingRecord.wageGrade || '',
        operators: existingRecord.operators ?? undefined,
        machinePriceUsd: existingRecord.machinePriceUsd ?? undefined,
        manufacturerCountry: existingRecord.manufacturerCountry || '',
        setupTimeHr: existingRecord.setupTimeHr ?? undefined,
        lhrInrPerHr: existingRecord.lhrInrPerHr ?? undefined,
        usdLaborRatePerHr: existingRecord.usdLaborRatePerHr ?? undefined,
        usdLhrBase: existingRecord.usdLhrBase ?? undefined,
        usdLhrBurden: existingRecord.usdLhrBurden ?? undefined,
        usdLhrTotal: existingRecord.usdLhrTotal ?? undefined,
        directOverheadRate: existingRecord.directOverheadRate ?? undefined,
        indirectOverheadRate: existingRecord.indirectOverheadRate ?? undefined,
        maxXMm: existingRecord.maxXMm ?? undefined,
        maxYMm: existingRecord.maxYMm ?? undefined,
        maxZMm: existingRecord.maxZMm ?? undefined,
        maxDiameterMm: existingRecord.maxDiameterMm ?? undefined,
        maxLengthMm: existingRecord.maxLengthMm ?? undefined,
        maxTonnage: existingRecord.maxTonnage ?? undefined,
        maxThicknessMm: existingRecord.maxThicknessMm ?? undefined,
        maxWorkpieceWeightKg: existingRecord.maxWorkpieceWeightKg ?? undefined,
        powerKw: existingRecord.powerKw ?? undefined,
        maxThicknessMsMm: existingRecord.maxThicknessMsMm ?? undefined,
        maxThicknessSsMm: existingRecord.maxThicknessSsMm ?? undefined,
        maxThicknessAlMm: existingRecord.maxThicknessAlMm ?? undefined,
        maxThicknessCuMm: existingRecord.maxThicknessCuMm ?? undefined,
        cuttableMaterials: existingRecord.cuttableMaterials?.join(', ') ?? '',
        specsJson: existingRecord.specs && Object.keys(existingRecord.specs).length
          ? JSON.stringify(existingRecord.specs, null, 2) : '',
      });
      setIsManualMode(Boolean(existingRecord.isManualEntry || (existingRecord as any).is_manual_entry));
      setManualMHRValue(Number(existingRecord.manualMHRValue || (existingRecord as any).manual_mhr_value || 0));
      // Use processGroup first (set by Combined-format import); fall back to commodityCode
      const groupFromRecord = existingRecord.processGroup || existingRecord.commodityCode || '';
      if (existingRecord.processRoute && existingRecord.operation) {
        // Real, persisted selection (mhr_records.process_route/operation) —
        // use directly. Doesn't need allMappings to be loaded at all, so this
        // hydrates immediately instead of racing the mappings fetch, and
        // doesn't depend on `specification` (a free-text field, usually
        // unrelated to the operation name) matching anything.
        setSelectedGroup(groupFromRecord);
        setSelectedRoute(existingRecord.processRoute);
        setSelectedOperation(existingRecord.operation);
      } else if (allMappings?.mappings) {
        // Older record saved before processRoute/operation were persisted —
        // fall back to re-matching by name against the specification field.
        const match = allMappings.mappings.find(m => m.operation === existingRecord.specification);
        if (match) {
          setSelectedGroup(match.processGroup); setSelectedRoute(match.processRoute); setSelectedOperation(match.operation);
        } else {
          setSelectedGroup(groupFromRecord); setSelectedRoute(''); setSelectedOperation('');
        }
      } else {
        // allMappings still loading — set group immediately so the Select isn't blank
        setSelectedGroup(groupFromRecord);
      }
    } else {
      reset(getDefaultValues());
      setIsManualMode(false); setManualMHRValue(0);
      setSelectedGroup(''); setSelectedRoute(''); setSelectedOperation('');
    }
  }, [existingRecord, reset, allMappings]);

  // ── Watched values for live USD hints ─────────────────────────────────────
  const locationWatched      = watch('location');
  const landedCostWatched    = watch('landedMachineCost') || 0;
  const rentWatched          = watch('rentPerSqmPerMonth') || 0;
  const electricityWatched   = watch('electricityCostPerKwh') || 0;
  const manualMHRWatched     = manualMHRValue || 0;

  // Derived currency info from selected location. fxRate is a live
  // ECB/Frankfurter reference rate (useFxRate) — never a hardcoded number.
  // Falls back to 1 (same sentinel already used for USD itself) while the
  // real rate is loading, which just hides the conversion hint rather than
  // showing a wrong one; it flips to the true rate once it arrives.
  const { symbol: currSym, currency: currCode } = getCurrencyInfo(locationWatched || 'USA');
  const { data: liveFxForForm } = useFxRate({ base: 'USD', quote: currCode, rateType: 'reference', enabled: currCode !== 'USD' });
  const fxRate = currCode === 'USD' ? 1 : (liveFxForForm?.rate ?? 1);

  const onSubmit = async (data: MHRFormData) => {
    try {
      if (!selectedGroup) { toast.error('Please select a process group'); return; }
      let submitData: any = { ...data };
      if (isManualMode) {
        if (manualMHRValue <= 0) { toast.error('Please enter a valid MHR value greater than 0'); return; }
        submitData = {
          machineName: data.machineName, location: data.location, commodityCode: data.commodityCode,
          machineDescription: data.machineDescription || '', manufacturer: data.manufacturer || '',
          model: data.model || '', specification: data.specification || '',
          manufacturerCountry: data.manufacturerCountry || '', machineClass: data.machineClass || '',
          automationLevel: data.automationLevel || '', wageGrade: data.wageGrade || '',
          operators: data.operators, machinePriceUsd: data.machinePriceUsd,
          lhrInrPerHr: data.lhrInrPerHr, usdLaborRatePerHr: data.usdLaborRatePerHr,
          usdLhrBase: data.usdLhrBase, usdLhrBurden: data.usdLhrBurden, usdLhrTotal: data.usdLhrTotal,
          directOverheadRate: data.directOverheadRate, indirectOverheadRate: data.indirectOverheadRate,
          shiftsPerDay: 1, hoursPerShift: 8, workingDaysPerYear: 250,
          plannedMaintenanceHoursPerYear: 0, capacityUtilizationRate: 85,
          landedMachineCost: manualMHRValue, accessoriesCostPercentage: 0,
          installationCostPercentage: 10, paybackPeriodYears: 10, interestRatePercentage: 0,
          insuranceRatePercentage: 0, maintenanceCostPercentage: 0, machineFootprintSqm: 0,
          rentPerSqmPerMonth: 0, powerKwhPerHour: 0, electricityCostPerKwh: 0,
          adminOverheadPercentage: 0, profitMarginPercentage: 0, isManualEntry: true, manualMHRValue,
          // Capability is orthogonal to manual-vs-calculated MHR mode — a
          // manually-priced machine still has real physical limits worth
          // recording for machine selection.
          maxXMm: data.maxXMm, maxYMm: data.maxYMm, maxZMm: data.maxZMm,
          maxDiameterMm: data.maxDiameterMm, maxLengthMm: data.maxLengthMm,
          maxTonnage: data.maxTonnage, maxThicknessMm: data.maxThicknessMm,
          maxWorkpieceWeightKg: data.maxWorkpieceWeightKg, powerKw: data.powerKw,
          maxThicknessMsMm: data.maxThicknessMsMm, maxThicknessSsMm: data.maxThicknessSsMm,
          maxThicknessAlMm: data.maxThicknessAlMm, maxThicknessCuMm: data.maxThicknessCuMm,
        };
      }
      // cuttableMaterials/specsJson are form-only representations (comma text /
      // raw JSON text) of the API's string[]/object shapes — convert once here
      // for both the manual and calculated submitData paths.
      submitData.cuttableMaterials = data.cuttableMaterials
        ? data.cuttableMaterials.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      submitData.specs = data.specsJson && data.specsJson.trim() ? JSON.parse(data.specsJson) : undefined;
      delete submitData.specsJson;
      // processGroup/processRoute/operation: real dedicated columns
      // (mhr_records.process_group/process_route/operation), tracked as
      // component state (selectedGroup/selectedRoute/selectedOperation), not
      // registered react-hook-form fields — `data` never carries them. This
      // form previously only ever wrote commodityCode/specification (the
      // group/operation stand-ins used by the hierarchy pickers below), which
      // is exactly why re-opening a saved record for Edit couldn't reliably
      // re-select the route/operation: process_route was never persisted at
      // all, and matching specification back to an operation name is fragile.
      submitData.processGroup = selectedGroup;
      submitData.processRoute = selectedRoute;
      submitData.operation = selectedOperation;
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: submitData });
      } else {
        await createMutation.mutateAsync(submitData);
      }
      onOpenChange(false);
      reset(getDefaultValues()); setIsManualMode(false); setManualMHRValue(0);
    } catch {
      if (!createMutation.error && !updateMutation.error) {
        toast.error(editingId ? 'Failed to update MHR record.' : 'Failed to create MHR record.', { duration: 6000 });
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false); reset(getDefaultValues()); setIsManualMode(false); setManualMHRValue(0);
    setSelectedGroup(''); setSelectedRoute(''); setSelectedOperation('');
  };

  // Generic numeric field (for % fields that don't need currency)
  const numField = (id: keyof MHRFormData, label: string, opts?: { step?: string; min?: string; max?: string }) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step={opts?.step ?? '0.01'} min={opts?.min ?? '0'} max={opts?.max}
        {...register(id as any, { valueAsNumber: true })} />
      {errors[id] && <span className="text-xs text-destructive">{(errors[id] as any)?.message}</span>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit MHR Record' : 'Create MHR Record'}</DialogTitle>
          <DialogDescription>
            Enter machine details and cost parameters for hour rate calculation
            {currCode !== 'USD' && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {currSym} {currCode} · 1 USD = {fxRate.toLocaleString()} {currCode}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-7">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="operation" disabled={isManualMode}>Operation</TabsTrigger>
              <TabsTrigger value="costs" disabled={isManualMode}>Costs</TabsTrigger>
              <TabsTrigger value="utilities" disabled={isManualMode}>Utilities</TabsTrigger>
              <TabsTrigger value="margins" disabled={isManualMode}>Margins</TabsTrigger>
              <TabsTrigger value="labour" className="text-green-700 dark:text-green-400">Labour</TabsTrigger>
              <TabsTrigger value="capability" className="text-blue-700 dark:text-blue-400">Capability</TabsTrigger>
            </TabsList>

            {/* ── Basic Info ── */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="machineName">Machine Name *</Label>
                  <Input id="machineName" {...register('machineName')} placeholder="e.g., VMC 3 Axis" />
                  {errors.machineName && <span className="text-xs text-destructive">Required</span>}
                </div>
                <div className="space-y-2">
                  <Label>Location *</Label>
                  <Controller
                    name="location"
                    control={control}
                    render={({ field }) => (
                      <LocationCombobox value={field.value || ''} onChange={field.onChange} />
                    )}
                  />
                  {currCode !== 'USD' && (
                    <p className="text-xs text-muted-foreground">
                      Currency: <strong>{currSym} {currCode}</strong> · 1 USD = {fxRate} {currCode}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Process Group *</Label>
                  <Select onValueChange={handleGroupChange} value={selectedGroup}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select process group" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {selectedGroup && !processGroups.find(g => g.value === selectedGroup) && (
                        <SelectItem value={selectedGroup}><span className="block truncate">{selectedGroup}</span></SelectItem>
                      )}
                      {processGroups.map((g, i) => (
                        <SelectItem key={`${g.value}-${i}`} value={g.value}><span className="block truncate">{g.label}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedGroup && <span className="text-xs text-destructive">Required</span>}
                </div>
                <div className="space-y-2">
                  <Label>Process Route</Label>
                  <Select onValueChange={handleRouteChange} value={selectedRoute} disabled={!selectedGroup}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedGroup ? 'Select process route' : 'Select group first'} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {processRoutes.map((r, i) => (
                        <SelectItem key={`${r.value}-${i}`} value={r.value}><span className="block truncate">{r.label}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Operation</Label>
                  <Select onValueChange={handleOperationChange} value={selectedOperation} disabled={!selectedRoute}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedRoute ? 'Select operation' : 'Select route first'} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {operations.map((o, i) => (
                        <SelectItem key={`${o.value}-${i}`} value={o.value}><span className="block truncate">{o.label}</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Machine Class / Process Sequence</Label>
                  <Controller name="machineClass" control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                      <SelectContent>
                        {field.value && !MACHINE_CLASS_OPTIONS.includes(field.value) && (
                          <SelectItem value={field.value}>{field.value}</SelectItem>
                        )}
                        {MACHINE_CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )} />
                </div>
                <div className="space-y-2">
                  <Label>Automation Level</Label>
                  <Controller name="automationLevel" control={control} render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                      <SelectContent>{AUTOMATION_LEVEL_OPTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wageGrade">Wage Grade</Label>
                  <Input id="wageGrade" {...register('wageGrade')} placeholder="e.g., Grade 5, WG-7" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operators">Operators</Label>
                  <Input id="operators" type="number" step="1" min="0" {...register('operators', { valueAsNumber: true })} placeholder="e.g., 1" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturer">Manufacturer</Label>
                  <Input id="manufacturer" {...register('manufacturer')} placeholder="e.g., ABC Corp" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturerCountry">Manufacturer Country</Label>
                  <Input id="manufacturerCountry" {...register('manufacturerCountry')} placeholder="e.g., Japan, Germany" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input id="model" {...register('model')} placeholder="e.g., XR-2025" />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="machineDescription">Machine Description</Label>
                  <Input id="machineDescription" {...register('machineDescription')} placeholder="Brief description" />
                </div>

                {/* Manual Entry toggle */}
                <div className="col-span-2 border-t pt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch id="manual-mode" checked={isManualMode} onCheckedChange={setIsManualMode} />
                    <Label htmlFor="manual-mode" className="text-sm font-medium">Manual MHR Entry (Skip automatic calculation)</Label>
                  </div>
                  {isManualMode && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Enter the MHR value directly in local currency. Cost calculation tabs are disabled.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="manualMHR" className="text-sm font-semibold">
                          Machine Hour Rate (MHR) — {currSym}/hour *
                        </Label>
                        <div className="flex items-center gap-3">
                          <Input
                            id="manualMHR"
                            type="number"
                            step="0.01"
                            min="0"
                            value={manualMHRValue === 0 ? '' : manualMHRValue}
                            onChange={e => setManualMHRValue(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                            placeholder="e.g., 500.00"
                            className="max-w-xs"
                          />
                          {fxRate !== 1 && manualMHRWatched > 0 && (
                            <span className="text-sm text-muted-foreground">
                              ≈ ${(manualMHRWatched / fxRate).toFixed(2)} USD/hr
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">This will override all automatic calculations</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ── Operation ── */}
            <TabsContent value="operation" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="shiftsPerDay">Shifts per Day *</Label>
                  <Input id="shiftsPerDay" type="number" step="0.01" min="0.5" max="4" {...register('shiftsPerDay', { valueAsNumber: true })} />
                  {errors.shiftsPerDay && <span className="text-xs text-destructive">{errors.shiftsPerDay.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hoursPerShift">Hours per Shift *</Label>
                  <Input id="hoursPerShift" type="number" step="0.01" min="1" max="24" {...register('hoursPerShift', { valueAsNumber: true })} />
                  {errors.hoursPerShift && <span className="text-xs text-destructive">{errors.hoursPerShift.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workingDaysPerYear">Working Days per Year *</Label>
                  <Input id="workingDaysPerYear" type="number" step="0.01" min="200" max="365" {...register('workingDaysPerYear', { valueAsNumber: true })} />
                  {errors.workingDaysPerYear && <span className="text-xs text-destructive">{errors.workingDaysPerYear.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plannedMaintenanceHoursPerYear">Maintenance Hours per Year</Label>
                  <Input id="plannedMaintenanceHoursPerYear" type="number" step="0.01" min="0" {...register('plannedMaintenanceHoursPerYear', { valueAsNumber: true })} />
                  {errors.plannedMaintenanceHoursPerYear && <span className="text-xs text-destructive">{errors.plannedMaintenanceHoursPerYear.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacityUtilizationRate">Capacity Utilization (%)*</Label>
                  <Input id="capacityUtilizationRate" type="number" step="0.01" min="50" max="100" {...register('capacityUtilizationRate', { valueAsNumber: true })} />
                  {errors.capacityUtilizationRate && <span className="text-xs text-destructive">{errors.capacityUtilizationRate.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="setupTimeHr">Setup Time (hr)</Label>
                  <Input id="setupTimeHr" type="number" step="0.01" min="0" {...register('setupTimeHr', { valueAsNumber: true })} placeholder="e.g., 0.5" />
                </div>
              </div>
            </TabsContent>

            {/* ── Costs ── */}
            <TabsContent value="costs" className="space-y-4 mt-4">
              <div className="rounded-lg bg-muted/40 border px-4 py-2 text-xs text-muted-foreground mb-1">
                All monetary costs are in <strong>{currSym} {currCode}</strong>.
                {currCode !== 'USD' && <> USD equivalents shown below each field (1 USD = {fxRate} {currCode}).</>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Landed Machine Cost — local currency + USD hint */}
                <div className="space-y-1">
                  <Label htmlFor="landedMachineCost">Landed Machine Cost ({currSym}) *</Label>
                  <Input id="landedMachineCost" type="number" step="0.01" min="1"
                    {...register('landedMachineCost', { valueAsNumber: true })} />
                  <UsdHint localVal={landedCostWatched} fxRate={fxRate} />
                  {errors.landedMachineCost && <span className="text-xs text-destructive">{errors.landedMachineCost.message}</span>}
                </div>

                {/* Machine Price — always USD */}
                <div className="space-y-1">
                  <Label htmlFor="machinePriceUsd">Machine Price (USD)</Label>
                  <Input id="machinePriceUsd" type="number" step="0.01" min="0"
                    {...register('machinePriceUsd', { valueAsNumber: true })} placeholder="e.g., 50000" />
                  <p className="text-xs text-muted-foreground">Always in USD — used for cost benchmarking</p>
                </div>

                {numField('accessoriesCostPercentage', 'Accessories Cost (%)')}

                <div className="space-y-2">
                  <Label htmlFor="installationCostPercentage">Installation Cost (%) *</Label>
                  <Input id="installationCostPercentage" type="number" step="0.01" min="10" max="40"
                    {...register('installationCostPercentage', { valueAsNumber: true })} />
                  {errors.installationCostPercentage && <span className="text-xs text-destructive">{errors.installationCostPercentage.message}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="paybackPeriodYears">Payback Period (Years) *</Label>
                  <Input id="paybackPeriodYears" type="number" step="0.01" min="1" max="30"
                    {...register('paybackPeriodYears', { valueAsNumber: true })} />
                  {errors.paybackPeriodYears && <span className="text-xs text-destructive">{errors.paybackPeriodYears.message}</span>}
                </div>

                {numField('interestRatePercentage', 'Interest Rate (%)')}
                {numField('insuranceRatePercentage', 'Insurance Rate (%)')}
                {numField('maintenanceCostPercentage', 'Maintenance Cost (%)')}
              </div>
            </TabsContent>

            {/* ── Utilities ── */}
            <TabsContent value="utilities" className="space-y-4 mt-4">
              <div className="rounded-lg bg-muted/40 border px-4 py-2 text-xs text-muted-foreground mb-1">
                Monetary utilities in <strong>{currSym} {currCode}</strong>.
                {currCode !== 'USD' && <> USD shown below each field.</>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {numField('machineFootprintSqm', 'Machine Footprint (m²)')}

                <div className="space-y-1">
                  <Label htmlFor="rentPerSqmPerMonth">Rent per m²/month ({currSym})</Label>
                  <Input id="rentPerSqmPerMonth" type="number" step="0.01" min="0"
                    {...register('rentPerSqmPerMonth', { valueAsNumber: true })} />
                  <UsdHint localVal={rentWatched} fxRate={fxRate} />
                </div>

                {numField('powerKwhPerHour', 'Power (kWh per Hour)')}

                <div className="space-y-1">
                  <Label htmlFor="electricityCostPerKwh">Electricity Cost ({currSym}/kWh)</Label>
                  <Input id="electricityCostPerKwh" type="number" step="0.001" min="0"
                    {...register('electricityCostPerKwh', { valueAsNumber: true })} />
                  <UsdHint localVal={electricityWatched} fxRate={fxRate} />
                </div>
              </div>
            </TabsContent>

            {/* ── Margins ── */}
            <TabsContent value="margins" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {numField('adminOverheadPercentage', 'Admin Overhead (%)')}
                {numField('profitMarginPercentage', 'Profit Margin (%)')}
              </div>
            </TabsContent>

            {/* ── Labour (LHR) — available in both calculator and manual mode ── */}
            <TabsContent value="labour" className="space-y-4 mt-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 px-4 py-2.5 mb-1">
                <p className="text-xs text-green-800 dark:text-green-300">
                  All LHR values are in <strong>USD</strong>.
                  <span className="font-semibold"> LHR Total ($/hr)</span> is the Skill-Based Labour Rate shown in the Rate Table.
                  Leave a rate blank to have it resolved from an industry benchmark (if this machine name matches one) on save.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Overhead Rates</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="directOverheadRate">Direct Overhead Rate ($/hr)</Label>
                    <Input id="directOverheadRate" type="number" step="0.01" min="0"
                      {...register('directOverheadRate', { valueAsNumber: true })}
                      placeholder="e.g., 19.60" />
                    <EconomicsSourceNote source={existingRecord?.directOverheadSource} benchmarkValue={existingRecord?.benchmarkDirectOverheadRateUsdHr} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="indirectOverheadRate">Indirect Overhead Rate ($/hr)</Label>
                    <Input id="indirectOverheadRate" type="number" step="0.01" min="0"
                      {...register('indirectOverheadRate', { valueAsNumber: true })}
                      placeholder="e.g., 8.40" />
                    <EconomicsSourceNote source={existingRecord?.indirectOverheadSource} benchmarkValue={existingRecord?.benchmarkIndirectOverheadRateUsdHr} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lhrInrPerHr">LHR Local Rate ({currSym}/hr)</Label>
                  <Input id="lhrInrPerHr" type="number" step="0.01" min="0"
                    {...register('lhrInrPerHr', { valueAsNumber: true })}
                    placeholder={currCode === 'INR' ? 'e.g., 180' : 'Local currency rate'} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="usdLaborRatePerHr">USD Labor Rate ($/hr)</Label>
                  <Input id="usdLaborRatePerHr" type="number" step="0.01" min="0"
                    {...register('usdLaborRatePerHr', { valueAsNumber: true })}
                    placeholder="e.g., 2.16" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="usdLhrBase">LHR Base ($/hr)</Label>
                  <Input id="usdLhrBase" type="number" step="0.01" min="0"
                    {...register('usdLhrBase', { valueAsNumber: true })}
                    placeholder="e.g., 1.50" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="usdLhrBurden">LHR Burden ($/hr)</Label>
                  <Input id="usdLhrBurden" type="number" step="0.01" min="0"
                    {...register('usdLhrBurden', { valueAsNumber: true })}
                    placeholder="e.g., 0.66" />
                </div>
                <div className="col-span-2 space-y-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-3">
                  <Label htmlFor="usdLhrTotal" className="text-green-800 dark:text-green-300 font-semibold text-sm">
                    Skill-Based Labor Rate — LHR Total ($/hr) ★
                  </Label>
                  <Input id="usdLhrTotal" type="number" step="0.01" min="0"
                    {...register('usdLhrTotal', { valueAsNumber: true })}
                    placeholder="e.g., 2.16"
                    className="border-green-300 focus:border-green-500" />
                  <p className="text-xs text-muted-foreground">Key LHR value shown in Rate Table and used in process cost calculations</p>
                  <EconomicsSourceNote source={existingRecord?.laborRateSource} benchmarkValue={existingRecord?.benchmarkLaborRateUsdHr} />
                  <p className="text-[11px] text-muted-foreground/70 leading-tight">
                    Note: this value drives the Rate Table display and exports only — real quote costing resolves labour rate independently from the LHR database by location + process group.
                  </p>
                </div>
              </div>
            </TabsContent>

            {/* ── Capability (machine-selection/selector.ts's real capability
                 columns, migration 324/339) — previously settable only via
                 Excel import or a raw SQL migration; a shop can now confirm a
                 specific machine's real physical limits directly here. ── */}
            <TabsContent value="capability" className="space-y-4 mt-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-4 py-2.5 mb-1">
                <p className="text-xs text-blue-800 dark:text-blue-300">
                  These are the real physical limits machine selection uses to decide which jobs this machine can run.
                  Leave blank if unknown — an unset limit is never treated as a gate.
                  {existingRecord?.capabilitySource && (
                    <span className="block mt-1 text-[11px] opacity-80">
                      Current source: <strong>{existingRecord.capabilitySource}</strong>
                      {existingRecord.capabilitySource === 'seed' && ' — a model-typical estimate, not this unit’s own verified spec.'}
                    </span>
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {numField('maxTonnage', 'Max Tonnage (t)')}
                {numField('powerKw', 'Power (kW)')}
                {numField('maxXMm', 'Bed/Envelope X (mm)')}
                {numField('maxYMm', 'Bed/Envelope Y (mm)')}
                {numField('maxZMm', 'Envelope Z (mm)')}
                {numField('maxDiameterMm', 'Max Diameter (mm, turning)')}
                {numField('maxLengthMm', 'Max Length (mm, bending/turning)')}
                {numField('maxWorkpieceWeightKg', 'Max Workpiece Weight (kg)')}
                {numField('maxThicknessMm', 'Max Thickness — generic (mm)')}
                {numField('maxThicknessMsMm', 'Max Thickness — Mild Steel (mm)')}
                {numField('maxThicknessSsMm', 'Max Thickness — Stainless (mm)')}
                {numField('maxThicknessAlMm', 'Max Thickness — Aluminum (mm)')}
                {numField('maxThicknessCuMm', 'Max Thickness — Copper (mm)')}
              </div>

              <div className="space-y-2">
                <Label htmlFor="cuttableMaterials">Cuttable Materials (comma-separated)</Label>
                <Input id="cuttableMaterials" {...register('cuttableMaterials')} placeholder="e.g., SS304, AL6061, CRCA" />
              </div>

              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="specsJson">Additional Specifications (JSON)</Label>
                <p className="text-xs text-muted-foreground">
                  Category-specific fields with no dedicated input yet — press force, roll diameter, RPM, etc.
                  Stored as-is, not read by any live calculation today.
                </p>
                <textarea
                  id="specsJson"
                  {...register('specsJson')}
                  rows={5}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  placeholder={'{\n  "press_force_kn": 300,\n  "bed_length_mm": 3050\n}'}
                />
                {errors.specsJson && <span className="text-xs text-destructive">{errors.specsJson.message}</span>}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}>
              {isSubmitting || createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : editingId ? 'Update MHR Record' : 'Create MHR Record'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
