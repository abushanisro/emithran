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
import { useCreateMHR, useUpdateMHR, useMHRRecord } from '@/lib/api/hooks';
import { toast } from 'sonner';
import { useProcessHierarchy, useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { mhrFormSchema, type MHRFormData } from '@/lib/validations/mhrValidation';

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

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
  landedMachineCost: 100000,
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
      t &&
      t.length > 0 &&
      t.length <= 100 &&
      isNaN(Number(t)) &&
      !t.includes('|') &&
      !t.includes('USD→INR') &&
      !t.includes('USD->INR') &&
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
    register, handleSubmit, reset, setValue, control,
    formState: { errors, isSubmitting },
  } = useForm<MHRFormData>({
    resolver: zodResolver(mhrFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onBlur',
  });

  const handleGroupChange = (group: string) => {
    setSelectedGroup(group);
    setSelectedRoute('');
    setSelectedOperation('');
    setValue('commodityCode', group);
    setValue('specification', '');
  };
  const handleRouteChange = (route: string) => {
    setSelectedRoute(route);
    setSelectedOperation('');
    setValue('specification', '');
  };
  const handleOperationChange = (op: string) => {
    setSelectedOperation(op);
    setValue('specification', op);
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
        // India 2026 fields
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

      if (allMappings?.mappings) {
        const match = allMappings.mappings.find(m => m.operation === existingRecord.specification);
        if (match) {
          setSelectedGroup(match.processGroup);
          setSelectedRoute(match.processRoute);
          setSelectedOperation(match.operation);
        } else {
          setSelectedGroup(existingRecord.commodityCode);
          setSelectedRoute('');
          setSelectedOperation('');
        }
      }
    } else {
      reset(getDefaultValues());
      setIsManualMode(false);
      setManualMHRValue(0);
      setSelectedGroup('');
      setSelectedRoute('');
      setSelectedOperation('');
    }
  }, [existingRecord, reset, allMappings]);

  const onSubmit = async (data: MHRFormData) => {
    try {
      if (!selectedGroup) { toast.error('Please select a process group'); return; }

      let submitData: any = { ...data };

      if (isManualMode) {
        if (manualMHRValue <= 0) { toast.error('Please enter a valid MHR value greater than 0'); return; }
        submitData = {
          machineName: data.machineName,
          location: data.location,
          commodityCode: data.commodityCode,
          machineDescription: data.machineDescription || '',
          manufacturer: data.manufacturer || '',
          model: data.model || '',
          specification: data.specification || '',
          manufacturerCountry: data.manufacturerCountry || '',
          machineClass: data.machineClass || '',
          automationLevel: data.automationLevel || '',
          wageGrade: data.wageGrade || '',
          operators: data.operators,
          machinePriceUsd: data.machinePriceUsd,
          lhrInrPerHr: data.lhrInrPerHr,
          usdLaborRatePerHr: data.usdLaborRatePerHr,
          usdLhrBase: data.usdLhrBase,
          usdLhrBurden: data.usdLhrBurden,
          usdLhrTotal: data.usdLhrTotal,
          shiftsPerDay: 1, hoursPerShift: 8, workingDaysPerYear: 250,
          plannedMaintenanceHoursPerYear: 0, capacityUtilizationRate: 85,
          landedMachineCost: manualMHRValue,
          accessoriesCostPercentage: 0, installationCostPercentage: 10,
          paybackPeriodYears: 10, interestRatePercentage: 0,
          insuranceRatePercentage: 0, maintenanceCostPercentage: 0,
          machineFootprintSqm: 0, rentPerSqmPerMonth: 0,
          powerKwhPerHour: 0, electricityCostPerKwh: 0,
          adminOverheadPercentage: 0, profitMarginPercentage: 0,
          isManualEntry: true, manualMHRValue,
        };
      }

      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data: submitData });
      } else {
        await createMutation.mutateAsync(submitData);
      }
      onOpenChange(false);
      reset(getDefaultValues());
      setIsManualMode(false);
      setManualMHRValue(0);
    } catch (error: any) {
      if (!createMutation.error && !updateMutation.error) {
        toast.error(editingId ? 'Failed to update MHR record.' : 'Failed to create MHR record.', { duration: 6000 });
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    reset(getDefaultValues());
    setIsManualMode(false);
    setManualMHRValue(0);
    setSelectedGroup('');
    setSelectedRoute('');
    setSelectedOperation('');
  };

  const numField = (id: keyof MHRFormData, label: string, opts?: { step?: string; min?: string; max?: string; required?: boolean }) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}{opts?.required !== false ? '' : ''}</Label>
      <Input
        id={id}
        type="number"
        step={opts?.step ?? '0.01'}
        min={opts?.min ?? '0'}
        max={opts?.max}
        {...register(id as any, { valueAsNumber: true })}
      />
      {errors[id] && <span className="text-xs text-destructive">{(errors[id] as any)?.message}</span>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit MHR Record' : 'Create MHR Record'}</DialogTitle>
          <DialogDescription>Enter machine details and cost parameters for hour rate calculation</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="operation" disabled={isManualMode}>Operation</TabsTrigger>
              <TabsTrigger value="costs" disabled={isManualMode}>Costs</TabsTrigger>
              <TabsTrigger value="utilities" disabled={isManualMode}>Utilities</TabsTrigger>
              <TabsTrigger value="margins" disabled={isManualMode}>Margins</TabsTrigger>
            </TabsList>

            {/* ── Basic Info ── */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {/* Machine Name */}
                <div className="space-y-2">
                  <Label htmlFor="machineName">Machine Name *</Label>
                  <Input id="machineName" {...register('machineName')} placeholder="e.g., Injection Molding Machine" />
                  {errors.machineName && <span className="text-xs text-destructive">Required</span>}
                </div>
                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="location">Location *</Label>
                  <Input id="location" {...register('location')} placeholder="e.g., India" />
                </div>
                {/* Process Group */}
                <div className="space-y-2">
                  <Label>Process Group *</Label>
                  <Select onValueChange={handleGroupChange} value={selectedGroup}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select process group" />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {selectedGroup && !processGroups.find(g => g.value === selectedGroup) && (
                        <SelectItem value={selectedGroup}>
                          <span className="block truncate">{selectedGroup}</span>
                        </SelectItem>
                      )}
                      {processGroups.map((g, i) => (
                        <SelectItem key={`${g.value}-${i}`} value={g.value}>
                          <span className="block truncate">{g.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedGroup && <span className="text-xs text-destructive">Required</span>}
                </div>
                {/* Process Route */}
                <div className="space-y-2">
                  <Label>Process Route</Label>
                  <Select onValueChange={handleRouteChange} value={selectedRoute} disabled={!selectedGroup}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedGroup ? 'Select process route' : 'Select group first'} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {processRoutes.map((r, i) => (
                        <SelectItem key={`${r.value}-${i}`} value={r.value}>
                          <span className="block truncate">{r.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Operation */}
                <div className="space-y-2">
                  <Label>Operation</Label>
                  <Select onValueChange={handleOperationChange} value={selectedOperation} disabled={!selectedRoute}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={selectedRoute ? 'Select operation' : 'Select route first'} />
                    </SelectTrigger>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)] max-h-60">
                      {operations.map((o, i) => (
                        <SelectItem key={`${o.value}-${i}`} value={o.value}>
                          <span className="block truncate">{o.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Machine Class */}
                <div className="space-y-2">
                  <Label>Machine Class</Label>
                  <Controller
                    name="machineClass"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
                        <SelectContent>
                          {MACHINE_CLASS_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {/* Automation Level */}
                <div className="space-y-2">
                  <Label>Automation Level</Label>
                  <Controller
                    name="automationLevel"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                        <SelectContent>
                          {AUTOMATION_LEVEL_OPTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                {/* Wage Grade */}
                <div className="space-y-2">
                  <Label htmlFor="wageGrade">Wage Grade</Label>
                  <Input id="wageGrade" {...register('wageGrade')} placeholder="e.g., Grade 5, WG-7" />
                </div>
                {/* Operators */}
                <div className="space-y-2">
                  <Label htmlFor="operators">Operators</Label>
                  <Input id="operators" type="number" step="1" min="0" {...register('operators', { valueAsNumber: true })} placeholder="e.g., 1" />
                </div>
                {/* Manufacturer */}
                <div className="space-y-2">
                  <Label htmlFor="manufacturer">Manufacturer</Label>
                  <Input id="manufacturer" {...register('manufacturer')} placeholder="e.g., ABC Corp" />
                </div>
                {/* Manufacturer Country */}
                <div className="space-y-2">
                  <Label htmlFor="manufacturerCountry">Manufacturer Country</Label>
                  <Input id="manufacturerCountry" {...register('manufacturerCountry')} placeholder="e.g., Japan, Germany" />
                </div>
                {/* Model */}
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input id="model" {...register('model')} placeholder="e.g., XR-2025" />
                </div>
                {/* LHR Reference */}
                <div className="space-y-2">
                  <Label htmlFor="lhrInrPerHr">LHR Reference (₹/hr)</Label>
                  <Input id="lhrInrPerHr" type="number" step="0.01" min="0" {...register('lhrInrPerHr', { valueAsNumber: true })} placeholder="Labour hour rate" />
                </div>
                {/* USD LHR Rates */}
                <div className="col-span-2 border-t pt-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">USD LHR Rates (Optional)</p>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="usdLaborRatePerHr">Labor Rate ($/hr)</Label>
                      <Input id="usdLaborRatePerHr" type="number" step="0.01" min="0" {...register('usdLaborRatePerHr', { valueAsNumber: true })} placeholder="e.g., 3.50" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="usdLhrBase">LHR Base ($/hr)</Label>
                      <Input id="usdLhrBase" type="number" step="0.01" min="0" {...register('usdLhrBase', { valueAsNumber: true })} placeholder="e.g., 3.50" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="usdLhrBurden">LHR Burden ($/hr)</Label>
                      <Input id="usdLhrBurden" type="number" step="0.01" min="0" {...register('usdLhrBurden', { valueAsNumber: true })} placeholder="e.g., 1.33" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="usdLhrTotal">LHR Total ($/hr)</Label>
                      <Input id="usdLhrTotal" type="number" step="0.01" min="0" {...register('usdLhrTotal', { valueAsNumber: true })} placeholder="e.g., 4.83" />
                    </div>
                  </div>
                </div>
                {/* Machine Description */}
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="machineDescription">Machine Description</Label>
                  <Input id="machineDescription" {...register('machineDescription')} placeholder="Brief description" />
                </div>
                {/* Manual Entry */}
                <div className="col-span-2 border-t pt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <Switch id="manual-mode" checked={isManualMode} onCheckedChange={setIsManualMode} />
                    <Label htmlFor="manual-mode" className="text-sm font-medium">Manual MHR Entry (Skip automatic calculation)</Label>
                  </div>
                  {isManualMode && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
                      <p className="text-sm text-blue-700 dark:text-blue-300">Enter the MHR value directly. Cost calculation tabs will be disabled.</p>
                      <div className="space-y-2">
                        <Label htmlFor="manualMHR" className="text-sm font-semibold">Machine Hour Rate (MHR) — ₹/hour *</Label>
                        <Input
                          id="manualMHR"
                          type="number"
                          step="0.01"
                          min="0"
                          value={manualMHRValue === 0 ? '' : manualMHRValue}
                          onChange={e => setManualMHRValue(e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                          placeholder="e.g., 500.00"
                          className="max-w-md"
                        />
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
                  <Label htmlFor="capacityUtilizationRate">Capacity Utilization Rate (%) *</Label>
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="landedMachineCost">Landed Machine Cost (₹) *</Label>
                  <Input id="landedMachineCost" type="number" step="0.01" min="1" {...register('landedMachineCost', { valueAsNumber: true })} />
                  {errors.landedMachineCost && <span className="text-xs text-destructive">{errors.landedMachineCost.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="machinePriceUsd">Machine Price (USD)</Label>
                  <Input id="machinePriceUsd" type="number" step="0.01" min="0" {...register('machinePriceUsd', { valueAsNumber: true })} placeholder="e.g., 50000" />
                </div>
                {numField('accessoriesCostPercentage', 'Accessories Cost (%)')}
                <div className="space-y-2">
                  <Label htmlFor="installationCostPercentage">Installation Cost (%) *</Label>
                  <Input id="installationCostPercentage" type="number" step="0.01" min="10" max="40" {...register('installationCostPercentage', { valueAsNumber: true })} />
                  {errors.installationCostPercentage && <span className="text-xs text-destructive">{errors.installationCostPercentage.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paybackPeriodYears">Payback Period (Years) *</Label>
                  <Input id="paybackPeriodYears" type="number" step="0.01" min="1" max="30" {...register('paybackPeriodYears', { valueAsNumber: true })} />
                  {errors.paybackPeriodYears && <span className="text-xs text-destructive">{errors.paybackPeriodYears.message}</span>}
                </div>
                {numField('interestRatePercentage', 'Interest Rate (%)')}
                {numField('insuranceRatePercentage', 'Insurance Rate (%)')}
                {numField('maintenanceCostPercentage', 'Maintenance Cost (%)')}
              </div>
            </TabsContent>

            {/* ── Utilities ── */}
            <TabsContent value="utilities" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {numField('machineFootprintSqm', 'Machine Footprint (m²)')}
                {numField('rentPerSqmPerMonth', 'Rent per m² per Month (₹)')}
                {numField('powerKwhPerHour', 'Power (KWH per Hour)')}
                {numField('electricityCostPerKwh', 'Electricity Cost per KWH (₹)')}
              </div>
            </TabsContent>

            {/* ── Margins ── */}
            <TabsContent value="margins" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {numField('adminOverheadPercentage', 'Admin Overhead (%)')}
                {numField('profitMarginPercentage', 'Profit Margin (%)')}
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
