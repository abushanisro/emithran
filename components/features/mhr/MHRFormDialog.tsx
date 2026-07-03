'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
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

// ── Currency helpers (mirrors backend mhr-calculation.constants.ts) ──────────


function getCurrencyInfo(location: string): { currency: string; symbol: string; fxRate: number } {
  const loc = (location || '').toLowerCase();
  if (loc.includes('india')) return { currency: 'INR', symbol: '₹', fxRate: 84.5 };
  if (loc.includes('china')) return { currency: 'CNY', symbol: '¥', fxRate: 7.25 };
  if (loc.includes('usa') || loc.includes('united states') || loc.includes('america'))
    return { currency: 'USD', symbol: '$', fxRate: 1.0 };
  if (loc.includes('germany') || loc.includes('france') || loc.includes('europe')
    || loc.includes('w. europe') || loc.includes('e. europe'))
    return { currency: 'EUR', symbol: '€', fxRate: 0.92 };
  if (loc.includes('uk') || loc.includes('britain') || loc.includes('england'))
    return { currency: 'GBP', symbol: '£', fxRate: 0.79 };
  if (loc.includes('mexico')) return { currency: 'MXN', symbol: 'MX$', fxRate: 17.5 };
  if (loc.includes('japan')) return { currency: 'JPY', symbol: '¥', fxRate: 154.0 };
  if (loc.includes('korea')) return { currency: 'KRW', symbol: '₩', fxRate: 1380 };
  if (loc.includes('australia')) return { currency: 'AUD', symbol: 'A$', fxRate: 1.56 };
  if (loc.includes('canada')) return { currency: 'CAD', symbol: 'CA$', fxRate: 1.37 };
  return { currency: 'USD', symbol: '$', fxRate: 1.0 };
}

// ── Location-wise cost defaults (in local currency) ───────────────────────────
// Machine cost ≈ $50k USD equivalent; rent, electricity at local market rates
const LOCATION_COST_DEFAULTS: Record<string, {
  landedMachineCost: number; rentPerSqmPerMonth: number;
  electricityCostPerKwh: number; interestRatePercentage: number;
}> = {
  'India':     { landedMachineCost: 4225000, rentPerSqmPerMonth: 100,  electricityCostPerKwh: 8.0,   interestRatePercentage: 9.0  },
  'China':     { landedMachineCost: 362500,  rentPerSqmPerMonth: 80,   electricityCostPerKwh: 0.8,   interestRatePercentage: 4.5  },
  'USA':       { landedMachineCost: 50000,   rentPerSqmPerMonth: 15,   electricityCostPerKwh: 0.12,  interestRatePercentage: 5.5  },
  'Germany':   { landedMachineCost: 46000,   rentPerSqmPerMonth: 15,   electricityCostPerKwh: 0.35,  interestRatePercentage: 3.5  },
  'France':    { landedMachineCost: 46000,   rentPerSqmPerMonth: 12,   electricityCostPerKwh: 0.22,  interestRatePercentage: 3.5  },
  'W. Europe': { landedMachineCost: 46000,   rentPerSqmPerMonth: 14,   electricityCostPerKwh: 0.28,  interestRatePercentage: 3.5  },
  'E. Europe': { landedMachineCost: 41000,   rentPerSqmPerMonth: 8,    electricityCostPerKwh: 0.18,  interestRatePercentage: 5.0  },
  'Mexico':    { landedMachineCost: 875000,  rentPerSqmPerMonth: 200,  electricityCostPerKwh: 1.5,   interestRatePercentage: 11.0 },
  'Other':     { landedMachineCost: 50000,   rentPerSqmPerMonth: 15,   electricityCostPerKwh: 0.15,  interestRatePercentage: 6.0  },
};

// ── LHR defaults in USD (standard skill labour rates by location) ─────────────
const LOCATION_LHR_DEFAULTS: Record<string, {
  lhrInrPerHr: number; usdLaborRatePerHr: number;
  usdLhrBase: number; usdLhrBurden: number; usdLhrTotal: number;
}> = {
  'India':     { lhrInrPerHr: 180, usdLaborRatePerHr: 2.16, usdLhrBase: 1.50, usdLhrBurden: 0.66, usdLhrTotal: 2.16  },
  'China':     { lhrInrPerHr: 0,   usdLaborRatePerHr: 8.0,  usdLhrBase: 6.00, usdLhrBurden: 2.00, usdLhrTotal: 8.0   },
  'USA':       { lhrInrPerHr: 0,   usdLaborRatePerHr: 22.0, usdLhrBase: 16.0, usdLhrBurden: 6.00, usdLhrTotal: 22.0  },
  'Germany':   { lhrInrPerHr: 0,   usdLaborRatePerHr: 28.0, usdLhrBase: 20.0, usdLhrBurden: 8.00, usdLhrTotal: 28.0  },
  'France':    { lhrInrPerHr: 0,   usdLaborRatePerHr: 25.0, usdLhrBase: 18.0, usdLhrBurden: 7.00, usdLhrTotal: 25.0  },
  'W. Europe': { lhrInrPerHr: 0,   usdLaborRatePerHr: 26.0, usdLhrBase: 19.0, usdLhrBurden: 7.00, usdLhrTotal: 26.0  },
  'E. Europe': { lhrInrPerHr: 0,   usdLaborRatePerHr: 12.0, usdLhrBase: 9.00, usdLhrBurden: 3.00, usdLhrTotal: 12.0  },
  'Mexico':    { lhrInrPerHr: 0,   usdLaborRatePerHr: 5.0,  usdLhrBase: 3.50, usdLhrBurden: 1.50, usdLhrTotal: 5.0   },
  'Other':     { lhrInrPerHr: 0,   usdLaborRatePerHr: 10.0, usdLhrBase: 7.00, usdLhrBurden: 3.00, usdLhrTotal: 10.0  },
};

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

const MASTER_LOCATIONS = ['China', 'E. Europe', 'France', 'Germany', 'India', 'Mexico', 'Other', 'USA', 'W. Europe'] as const;
const MACHINE_CLASS_OPTIONS = ['Heavy', 'Medium', 'Light', 'Micro'];
const AUTOMATION_LEVEL_OPTIONS = ['Manual', 'Semi-Automatic', 'Automatic', 'CNC', 'Robotic', 'Fully Automated'];

const getDefaultValues = (): MHRFormData => ({
  location: 'India',
  commodityCode: '',
  machineName: '',
  machineDescription: '',
  manufacturer: '',
  model: '',
  specification: '',
  // India defaults; these get replaced by LOCATION_COST_DEFAULTS when location changes
  landedMachineCost: 4225000,
  machineFootprintSqm: 10.00,
  rentPerSqmPerMonth: 100.00,
  powerKwhPerHour: 10.00,
  electricityCostPerKwh: 8.00,
  shiftsPerDay: 3.00,
  hoursPerShift: 8.00,
  workingDaysPerYear: 260.00,
  plannedMaintenanceHoursPerYear: 0.00,
  capacityUtilizationRate: 85.00,
  accessoriesCostPercentage: 8.00,
  installationCostPercentage: 20.00,
  paybackPeriodYears: 10.00,
  interestRatePercentage: 9.00,
  insuranceRatePercentage: 1.50,
  maintenanceCostPercentage: 7.00,
  adminOverheadPercentage: 12.00,
  profitMarginPercentage: 15.00,
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

  // Prevent location-watch effect from overwriting values during form reset
  const isInitializingRef = useRef(false);

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
      isInitializingRef.current = true;
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
      });
      setIsManualMode(Boolean(existingRecord.isManualEntry || (existingRecord as any).is_manual_entry));
      setManualMHRValue(Number(existingRecord.manualMHRValue || (existingRecord as any).manual_mhr_value || 0));
      // Use processGroup first (set by Combined-format import); fall back to commodityCode
      const groupFromRecord = existingRecord.processGroup || existingRecord.commodityCode || '';
      if (allMappings?.mappings) {
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
      // Clear the init flag after one event-loop tick so the location watch doesn't fire
      setTimeout(() => { isInitializingRef.current = false; }, 50);
    } else {
      reset(getDefaultValues());
      setIsManualMode(false); setManualMHRValue(0);
      setSelectedGroup(''); setSelectedRoute(''); setSelectedOperation('');
    }
  }, [existingRecord, reset, allMappings]);

  // ── Watched values for live USD hints ─────────────────────────────────────
  const locationWatched      = watch('location');
  const currentLhrTotal      = watch('usdLhrTotal');
  const landedCostWatched    = watch('landedMachineCost') || 0;
  const rentWatched          = watch('rentPerSqmPerMonth') || 0;
  const electricityWatched   = watch('electricityCostPerKwh') || 0;
  const manualMHRWatched     = manualMHRValue || 0;

  // Derived currency info from selected location
  const { symbol: currSym, fxRate, currency: currCode } = useMemo(
    () => getCurrencyInfo(locationWatched || 'India'),
    [locationWatched],
  );

  // When location changes, apply location-specific defaults (skip during form init from existingRecord)
  useEffect(() => {
    if (!locationWatched || isInitializingRef.current) return;
    const costDefs = LOCATION_COST_DEFAULTS[locationWatched];
    if (costDefs) {
      setValue('landedMachineCost', costDefs.landedMachineCost);
      setValue('rentPerSqmPerMonth', costDefs.rentPerSqmPerMonth);
      setValue('electricityCostPerKwh', costDefs.electricityCostPerKwh);
      setValue('interestRatePercentage', costDefs.interestRatePercentage);
    }
    // Only auto-fill LHR when blank (don't overwrite user-entered values)
    if (!currentLhrTotal) {
      const lhrDefs = LOCATION_LHR_DEFAULTS[locationWatched];
      if (lhrDefs) {
        if (lhrDefs.lhrInrPerHr) setValue('lhrInrPerHr', lhrDefs.lhrInrPerHr);
        setValue('usdLaborRatePerHr', lhrDefs.usdLaborRatePerHr);
        setValue('usdLhrBase', lhrDefs.usdLhrBase);
        setValue('usdLhrBurden', lhrDefs.usdLhrBurden);
        setValue('usdLhrTotal', lhrDefs.usdLhrTotal);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationWatched]);

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
          shiftsPerDay: 1, hoursPerShift: 8, workingDaysPerYear: 250,
          plannedMaintenanceHoursPerYear: 0, capacityUtilizationRate: 85,
          landedMachineCost: manualMHRValue, accessoriesCostPercentage: 0,
          installationCostPercentage: 10, paybackPeriodYears: 10, interestRatePercentage: 0,
          insuranceRatePercentage: 0, maintenanceCostPercentage: 0, machineFootprintSqm: 0,
          rentPerSqmPerMonth: 0, powerKwhPerHour: 0, electricityCostPerKwh: 0,
          adminOverheadPercentage: 0, profitMarginPercentage: 0, isManualEntry: true, manualMHRValue,
        };
      }
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
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="operation" disabled={isManualMode}>Operation</TabsTrigger>
              <TabsTrigger value="costs" disabled={isManualMode}>Costs</TabsTrigger>
              <TabsTrigger value="utilities" disabled={isManualMode}>Utilities</TabsTrigger>
              <TabsTrigger value="margins" disabled={isManualMode}>Margins</TabsTrigger>
              <TabsTrigger value="labour" className="text-green-700 dark:text-green-400">Labour</TabsTrigger>
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
                  Labour rates auto-suggested from location defaults when blank. All LHR values are in <strong>USD</strong>.
                  <span className="font-semibold"> LHR Total ($/hr)</span> is the Skill-Based Labour Rate used in process costing.
                </p>
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
                </div>
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
