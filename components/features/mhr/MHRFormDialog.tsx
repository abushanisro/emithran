'use client';

import { useEffect, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCreateMHR, useUpdateMHR, useMHRRecord, useMHRReferenceDetail, useMHRCategories, useMHRLocations, useMHRManufacturerCountries } from '@/lib/api/hooks';
import { useProcessHierarchy } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { toast } from 'sonner';
import { mhrFormSchema, type MHRFormData } from '@/lib/validations/mhrValidation';
import { getCurrencyForLocation as getCurrencyInfo } from '@/lib/utils/currency-locale';
import { useFxRate } from '@/lib/api/hooks/useFx';
import { groupMachineLibraryDetail } from '@/lib/utils/machineLibraryDetail';
import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

// Sheet-metal shop-floor labor grading (migration 577's own doc comment has
// the full research/rationale) — a closed 3-tier classification, not a
// DB-sourced list of arbitrary free-text values like the comboboxes below.
const WAGE_GRADE_OPTIONS = ['Skilled', 'Semi-Skilled', 'Unskilled'] as const;

// USD/USA is this app's default currency, not INR/India — see migration
// 436_default_currency_usd_not_inr.sql's own doc comment for the full trace
// of why INR ever became the fallback in this codebase. Only `location` gets
// a real starting value here — every cost/rate/operational number starts
// genuinely blank (not a plausible-looking fabricated figure) so Zod's
// required-field validation forces the user to enter this machine's own
// real numbers before the form can be submitted, never a guess that happens
// to satisfy the schema.
const getDefaultValues = (): Partial<MHRFormData> => ({
  location: 'USA',
  commodityCode: '',
  machineName: '',
  machineDescription: '',
  manufacturer: '',
  model: '',
  specification: '',
  cuttableMaterials: '',
});

// ── Generic combobox: real API-sourced presets + free-form typing ──────────
function ComboboxWithPresets({
  value, onChange, presets, placeholder, typePlaceholder, heading,
}: {
  value: string; onChange: (v: string) => void; presets: string[];
  placeholder: string; typePlaceholder: string; heading: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  useEffect(() => { setInputValue(value); }, [value]);
  const filtered = presets.filter(p => p.toLowerCase().includes(inputValue.toLowerCase()));
  const commit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed) { onChange(trimmed); }
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Start the search box empty on every open so the full preset list
        // shows immediately — pre-loading it with the current value (as
        // inputValue's own sync effect does) filtered the list down to
        // near-nothing for any field that already had a value, hiding the
        // rest of the real options (e.g. Category showing only itself
        // instead of all real categories on file).
        if (o) setInputValue('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal h-10 px-3 text-sm">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={typePlaceholder} value={inputValue}
            onValueChange={v => { setInputValue(v); onChange(v); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(inputValue); } }} />
          <CommandList
            // The Dialog this combobox lives in scroll-locks the page (via
            // react-remove-scroll) while open, and that lock only recognizes
            // elements inside the Dialog's own DOM subtree as scrollable —
            // this list is portalled to document.body by Popover, outside
            // that subtree, so the lock swallows the wheel event before the
            // browser's native scroll ever runs, and the list looks stuck.
            // Scrolling it manually here bypasses that native scroll path
            // entirely.
            onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}
          >
            {filtered.length === 0 && inputValue.trim() ? (
              <CommandEmpty>
                <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-accent" onClick={() => commit(inputValue)}>
                  Use &ldquo;<strong>{inputValue.trim()}</strong>&rdquo;
                </button>
              </CommandEmpty>
            ) : null}
            {filtered.length > 0 && (
              <CommandGroup heading={heading}>
                {filtered.map(p => (
                  <CommandItem key={p} value={p} onSelect={() => { setInputValue(p); commit(p); }}>
                    <Check className={cn('mr-2 h-4 w-4', value === p ? 'opacity-100' : 'opacity-0')} />
                    {p}
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
  const { data: referenceDetail } = useMHRReferenceDetail(editingId);
  const createMutation = useCreateMHR();
  const updateMutation = useUpdateMHR();

  // Real distinct values from mhr_records itself — never a hardcoded list.
  // The real process taxonomy (process_calculator_mappings, the same data
  // the Process page itself shows) — not mhr_records.process_group, which
  // only ever holds "Sheet Metal" and, after migration 578 made every
  // machine_library row global (user_id NULL), returns nothing at all for
  // getDistinctProcessGroups' per-user query.
  const { data: processHierarchy } = useProcessHierarchy();
  const knownProcessGroups = processHierarchy?.processGroups ?? [];
  const { data: knownLocations = [] } = useMHRLocations();
  const { data: knownManufacturerCountries = [] } = useMHRManufacturerCountries();

  const [selectedGroup, setSelectedGroup] = useState('');
  const [manualMHRValue, setManualMHRValue] = useState(0);
  // Scoped to the selected Process — without this, Category listed every
  // domain's categories regardless of Process (281 of ~294 rows are Sheet
  // Metal, drowning out e.g. Machining's few).
  const { data: knownCategories = [] } = useMHRCategories(selectedGroup || undefined);

  const {
    register, handleSubmit, reset, setValue, control, watch,
    formState: { errors, isSubmitting },
  } = useForm<MHRFormData>({
    resolver: zodResolver(mhrFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onBlur',
  });

  const handleGroupChange = (group: string) => {
    setSelectedGroup(group);
    setValue('commodityCode', group);
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
        // Show the real, human category ("3 Roll Bender") derived the same
        // way the Rate Table does, not the raw internal machine_class slug
        // ("roll_forming") — that slug is a cost-engine classification code,
        // not a display name. onSubmit below detects an untouched value and
        // writes the original canonical machineClass back unchanged so this
        // never corrupts machine selection.
        machineClass: (() => { const c = mhrCategoryOf(existingRecord); return c === '-' ? '' : c; })(),
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
      });
      // Prefill with the calculated machine-economics MHR when there is one
      // (only safe to use directly when the record's own currency is USD —
      // calculatedMhrUsdHr is always USD, and converting it to a non-USD
      // location's local currency here would need a live FX rate this effect
      // doesn't have; those records keep the previous fallback chain
      // unconverted rather than risk a silently wrong number). Saving without
      // touching this field adopts the calculated value as the new
      // manual_mhr_value — the value real quote costing reads.
      const isUsd = (existingRecord.currency ?? 'USD') === 'USD';
      const fallbackMhr = Number(
        existingRecord.calculations?.totalMachineHourRate
        || existingRecord.manualMHRValue
        || (existingRecord as any).manual_mhr_value
        || 0
      );
      const prefillMhr = (isUsd && existingRecord.calculatedMhrUsdHr != null)
        ? existingRecord.calculatedMhrUsdHr
        : fallbackMhr;
      setManualMHRValue(prefillMhr);
      // Use processGroup first (set by Combined-format import); fall back to commodityCode
      setSelectedGroup(existingRecord.processGroup || existingRecord.commodityCode || '');
    } else {
      reset(getDefaultValues());
      setManualMHRValue(0);
      setSelectedGroup('');
    }
  }, [existingRecord, reset]);

  // ── Watched values for live USD hints ─────────────────────────────────────
  const locationWatched      = watch('location');
  const manualMHRWatched     = manualMHRValue || 0;
  const directOhWatched      = watch('directOverheadRate');
  const indirectOhWatched    = watch('indirectOverheadRate');

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
      if (!selectedGroup) { toast.error('Please select a process'); return; }
      // The Category field displays the derived human category (e.g. "3 Roll
      // Bender"), never the raw canonical machineClass slug (e.g.
      // "roll_forming") — see the reset() effect above. If the user left it
      // showing that same derived value, write the real original slug back
      // unchanged instead of overwriting a cost-engine classification code
      // with a display string; an explicit edit is still respected as-is.
      if (existingRecord && data.machineClass === mhrCategoryOf(existingRecord)) {
        data.machineClass = existingRecord.machineClass || '';
      }
      if (manualMHRValue <= 0) { toast.error('Please enter a valid Machine Hour Rate greater than 0'); return; }
      // Machine cost is always entered directly now (the capex/utilization
      // calculator this used to derive totalMachineHourRate from — shifts,
      // landed cost, financing %s, rent, power — was removed); the fixed
      // values below are inert placeholders createManualEntryCalculation
      // ignores once isManualEntry is true (see mhr.service.ts).
      const submitData: any = {
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
        // Capability — the same real fields machine-selection/selector.ts
        // reads for ranking, independent of how the machine rate is entered.
        maxXMm: data.maxXMm, maxYMm: data.maxYMm, maxZMm: data.maxZMm,
        maxDiameterMm: data.maxDiameterMm, maxLengthMm: data.maxLengthMm,
        maxTonnage: data.maxTonnage, maxThicknessMm: data.maxThicknessMm,
        maxWorkpieceWeightKg: data.maxWorkpieceWeightKg, powerKw: data.powerKw,
        maxThicknessMsMm: data.maxThicknessMsMm, maxThicknessSsMm: data.maxThicknessSsMm,
        maxThicknessAlMm: data.maxThicknessAlMm, maxThicknessCuMm: data.maxThicknessCuMm,
      };
      // cuttableMaterials is a form-only representation (comma text) of the
      // API's string[] shape — convert once here for both the manual and
      // calculated submitData paths.
      submitData.cuttableMaterials = data.cuttableMaterials
        ? data.cuttableMaterials.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      // processGroup: a real dedicated column (mhr_records.process_group),
      // tracked as component state (selectedGroup), not a registered
      // react-hook-form field — `data` never carries it.
      submitData.processGroup = selectedGroup;
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: submitData });
      } else {
        await createMutation.mutateAsync(submitData);
      }
      onOpenChange(false);
      reset(getDefaultValues()); setManualMHRValue(0);
    } catch {
      if (!createMutation.error && !updateMutation.error) {
        toast.error(editingId ? 'Failed to update MHR record.' : 'Failed to create MHR record.', { duration: 6000 });
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false); reset(getDefaultValues()); setManualMHRValue(0);
    setSelectedGroup('');
  };

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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
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
                      <ComboboxWithPresets
                        value={field.value || ''} onChange={field.onChange}
                        presets={knownLocations} placeholder="Select or type location…"
                        typePlaceholder="Select or type (e.g. India - Pune)…" heading="Locations on file"
                      />
                    )}
                  />
                  {currCode !== 'USD' && (
                    <p className="text-xs text-muted-foreground">
                      Currency: <strong>{currSym} {currCode}</strong> · 1 USD = {fxRate} {currCode}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Process *</Label>
                  <ComboboxWithPresets
                    value={selectedGroup} onChange={handleGroupChange}
                    presets={knownProcessGroups} placeholder="Select or type process…"
                    typePlaceholder="Select or type (e.g. Sheet Metal)…" heading="Processes on file"
                  />
                  {!selectedGroup && <span className="text-xs text-destructive">Required</span>}
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Controller name="machineClass" control={control} render={({ field }) => (
                    <ComboboxWithPresets
                      value={field.value || ''} onChange={field.onChange}
                      presets={knownCategories} placeholder="Select or type category…"
                      typePlaceholder="Select or type (e.g. Fiber Laser Cutting Machine)…" heading="Categories on file"
                    />
                  )} />
                </div>
                <div className="space-y-2">
                  <Label>Wage Grade</Label>
                  <Controller name="wageGrade" control={control} render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select wage grade…" />
                      </SelectTrigger>
                      <SelectContent>
                        {WAGE_GRADE_OPTIONS.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )} />
                  <p className="text-xs text-muted-foreground">Reference only — real quote costing doesn't use this as a labor-rate lookup key yet.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operators">Operators</Label>
                  <Input id="operators" type="number" step="1" min="0" {...register('operators', { valueAsNumber: true })} placeholder="e.g., 1" />
                  <p className="text-xs text-muted-foreground">Used directly in real quote costing — this machine's operations use this operator count for setup and cycle labor, instead of a generic default. Leave blank to fall back to that default.</p>
                </div>
                <div className="space-y-2">
                  <Label>Manufacturer Country</Label>
                  <Controller name="manufacturerCountry" control={control} render={({ field }) => (
                    <ComboboxWithPresets
                      value={field.value || ''} onChange={field.onChange}
                      presets={knownManufacturerCountries} placeholder="Select or type country…"
                      typePlaceholder="Select or type (e.g. Japan, Germany)…" heading="Countries on file"
                    />
                  )} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="machinePriceUsd">Machine Price (USD)</Label>
                  <Input id="machinePriceUsd" type="number" step="0.01" min="0"
                    {...register('machinePriceUsd', { valueAsNumber: true })} placeholder="e.g., 50000" />
                  <p className="text-xs text-muted-foreground">Always in USD — used for cost benchmarking</p>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="machineDescription">Machine Description</Label>
                  <Input id="machineDescription" {...register('machineDescription')} placeholder="Brief description" />
                </div>

                <div className="col-span-2 border-t pt-4 space-y-2">
                  <Label className="text-sm font-medium">Overhead Rates (USD)</Label>
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
                  <div className="flex items-center justify-between rounded-md bg-muted/40 border px-3 py-2">
                    <span className="text-xs font-medium">Total Overhead Rate ($/hr)</span>
                    <span className="text-sm font-semibold text-primary">
                      {directOhWatched != null || indirectOhWatched != null
                        ? `$${((directOhWatched || 0) + (indirectOhWatched || 0)).toFixed(2)}`
                        : '-'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Calculated automatically — Direct OH + Indirect OH, not entered separately.</p>
                </div>

                <div className="col-span-2 border-t pt-4 space-y-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="manualMHR" className="text-sm font-medium">
                        Machine Hour Rate — MHR ({currSym}/hr) *
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
                        />
                      </div>
                      {fxRate !== 1 && manualMHRWatched > 0 && (
                        <span className="text-sm text-muted-foreground">
                          ≈ ${(manualMHRWatched / fxRate).toFixed(2)} USD/hr
                        </span>
                      )}
                      {existingRecord?.calculatedMhrUsdHr != null && (
                        <p className="text-[11px] text-muted-foreground">Prefilled from machine economics (${existingRecord.calculatedMhrUsdHr.toFixed(2)}/hr calculated) — edit and save to override.</p>
                      )}
                      <p className="text-xs text-muted-foreground">This machine's real $/hr — entered directly rather than derived from a capex/utilization calculator. This is what real quote costing uses.</p>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="usdLhrTotal">Labor Rate — LHR ($/hr)</Label>
                      <Input id="usdLhrTotal" type="number" step="0.01" min="0"
                        {...register('usdLhrTotal', { valueAsNumber: true })}
                        placeholder="e.g., 36.30" />
                      <EconomicsSourceNote source={existingRecord?.laborRateSource} benchmarkValue={existingRecord?.benchmarkLaborRateUsdHr} />
                      <p className="text-[11px] text-muted-foreground">Used directly in real quote costing for this machine's own operations — takes precedence over the location + process group benchmark rate when set. Leave blank to fall back to that benchmark instead.</p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Capability: real machine_library.json data for this exact
                 machine, read-only (migration 324/339's editable capability
                 number fields were removed — this lookup is now the sole
                 content of this tab). ── */}
            <TabsContent value="capability" className="space-y-4 mt-4">
              {/* ── Machine & Process Lookup — real machine_library.json data for
                   this exact machine, read-only. Replaces hand-typed JSON with
                   the sourced values, grouped by what part of the machine/
                   process each field describes. ── */}
              <div className="space-y-3 border-t pt-4">
                <div>
                  <Label>Machine &amp; Process Lookup</Label>
                  <p className="text-xs text-muted-foreground">
                    Real machine_library.json data for this machine, grouped by process — read-only.
                    {referenceDetail?.sourceKey && (
                      <span> Source: <span className="font-mono">{referenceDetail.sourceKey}</span></span>
                    )}
                  </p>
                </div>
                {!editingId ? (
                  <p className="text-xs text-muted-foreground">Save the machine first — this lookup matches against the saved record.</p>
                ) : !referenceDetail?.found ? (
                  <p className="text-xs text-muted-foreground">No machine_library reference match found for this machine yet.</p>
                ) : (
                  groupMachineLibraryDetail(referenceDetail.raw, {
                    maxXMm: existingRecord?.maxXMm, maxYMm: existingRecord?.maxYMm, maxZMm: existingRecord?.maxZMm,
                    maxDiameterMm: existingRecord?.maxDiameterMm, maxLengthMm: existingRecord?.maxLengthMm,
                    maxTonnage: existingRecord?.maxTonnage, maxThicknessMm: existingRecord?.maxThicknessMm,
                    maxWorkpieceWeightKg: existingRecord?.maxWorkpieceWeightKg, powerKw: existingRecord?.powerKw,
                    maxThicknessMsMm: existingRecord?.maxThicknessMsMm, maxThicknessSsMm: existingRecord?.maxThicknessSsMm,
                    maxThicknessAlMm: existingRecord?.maxThicknessAlMm, maxThicknessCuMm: existingRecord?.maxThicknessCuMm,
                  }).map((group) => (
                    <div key={group.title} className="space-y-1">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{group.title}</div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {group.entries.map((entry) => (
                            <div key={entry.key} className="flex justify-between gap-2 border-b border-dashed border-muted-foreground/20 py-0.5">
                              <dt className="text-muted-foreground truncate" title={entry.key}>{entry.label}</dt>
                              <dd className="font-mono text-right">{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  ))
                )}
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
