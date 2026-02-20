'use client';

import { useEffect } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateMHR, useUpdateMHR, useMHRRecord } from '@/lib/api/hooks';
import type { CreateMHRData } from '@/lib/api/mhr';
import { toast } from 'sonner';
import { COMMODITY_PRESETS, getCommodityPreset, MANUFACTURING_PROCESSES } from '@/lib/constants/commodityPresets';
import { mhrFormSchema, type MHRFormData } from '@/lib/validations/mhrValidation';

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

const getDefaultValues = (): MHRFormData => {
  const defaultPreset = getCommodityPreset('plastic-rubber') || {
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
  };

  return {
    location: 'India',
    commodityCode: 'plastic-rubber',
    machineName: '',
    machineDescription: '',
    manufacturer: '',
    model: '',
    specification: '',
    landedMachineCost: 100000, // Set a default non-zero value
    machineFootprintSqm: 10.00,
    rentPerSqmPerMonth: 100.00,
    powerKwhPerHour: 10.00,
    electricityCostPerKwh: 8.00,
    ...defaultPreset,
  };
};

export function MHRFormDialog({ open, onOpenChange, editingId }: MHRFormDialogProps) {
  const { data: existingRecord } = useMHRRecord(editingId || '', { enabled: !!editingId });
  const createMutation = useCreateMHR();
  const updateMutation = useUpdateMHR();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<MHRFormData>({
    resolver: zodResolver(mhrFormSchema),
    defaultValues: getDefaultValues(),
    mode: 'onBlur', // Validate on blur for better UX
  });

  // Watch commodity code changes
  const commodityCode = watch('commodityCode');

  // Apply commodity preset when commodity code changes (only for new records)
  useEffect(() => {
    if (!editingId && commodityCode) {
      const preset = getCommodityPreset(commodityCode);
      if (preset) {
        // Only update preset fields, keep user-entered machine-specific fields
        Object.entries(preset).forEach(([key, value]) => {
          setValue(key as keyof CreateMHRData, value as any);
        });
      }
    }
  }, [commodityCode, editingId, setValue]);

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
      });
    } else {
      reset(getDefaultValues());
    }
  }, [existingRecord, reset]);

  const onSubmit = async (data: MHRFormData) => {
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, data });
      } else {
        await createMutation.mutateAsync(data);
      }
      onOpenChange(false);
      reset(getDefaultValues());
    } catch (error: any) {
      console.error('Failed to save MHR record:', error);
      // Enhanced error handling beyond what mutation hooks provide
      let errorMessage = editingId ? 'Failed to update MHR record.' : 'Failed to create MHR record.';
      if (error?.message) {
        if (error.message.includes('validation')) {
          errorMessage = 'Invalid data provided. Please check all numeric fields have valid values and required fields are filled.';
        } else if (error.message.includes('duplicate')) {
          errorMessage = 'A machine with this name already exists. Please use a different machine name.';
        } else if (error.message.includes('permission')) {
          errorMessage = 'You do not have permission to save MHR records. Please contact your administrator.';
        } else if (error.message.includes('network')) {
          errorMessage = 'Network error occurred. Please check your connection and try again.';
        }
      }
      // Only show toast if mutation hooks haven't already shown one
      if (!createMutation.error && !updateMutation.error) {
        toast.error(errorMessage, { duration: 6000 });
      }
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    reset(getDefaultValues());
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit MHR Record' : 'Create MHR Record'}</DialogTitle>
          <DialogDescription>
            Enter machine details and cost parameters for hour rate calculation
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="operation">Operation</TabsTrigger>
              <TabsTrigger value="costs">Costs</TabsTrigger>
              <TabsTrigger value="utilities">Utilities</TabsTrigger>
              <TabsTrigger value="margins">Margins</TabsTrigger>
            </TabsList>

            {/* Basic Information Tab */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="machineName">Machine Name *</Label>
                  <Input
                    id="machineName"
                    {...register('machineName', { required: true })}
                    placeholder="e.g., Injection Molding Machine"
                  />
                  {errors.machineName && (
                    <span className="text-sm text-destructive">Required</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location *</Label>
                  <Input
                    id="location"
                    {...register('location', { required: true })}
                    placeholder="e.g., India, Mumbai"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="commodityCode">Commodity Code *</Label>
                  <Controller
                    name="commodityCode"
                    control={control}
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select commodity type" />
                        </SelectTrigger>
                        <SelectContent>
                          {COMMODITY_PRESETS.map((commodity) => (
                            <SelectItem key={commodity.value} value={commodity.value}>
                              <div className="flex flex-col">
                                <span className="font-medium">{commodity.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {commodity.description}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.commodityCode && (
                    <span className="text-sm text-destructive">Required</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturingProcess">Manufacturing Process</Label>
                  <Controller
                    name="specification"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select manufacturing process" />
                        </SelectTrigger>
                        <SelectContent>
                          {MANUFACTURING_PROCESSES.map((process) => (
                            <SelectItem key={process.value} value={process.value}>
                              <div className="flex flex-col">
                                <span className="font-medium">{process.label}</span>
                                <span className="text-xs text-muted-foreground">
                                  {process.description}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manufacturer">Manufacturer</Label>
                  <Input
                    id="manufacturer"
                    {...register('manufacturer')}
                    placeholder="e.g., ABC Corp"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model">Model</Label>
                  <Input id="model" {...register('model')} placeholder="e.g., 2025" />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="machineDescription">Machine Description</Label>
                  <Input
                    id="machineDescription"
                    {...register('machineDescription')}
                    placeholder="Brief description"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Operation Tab */}
            <TabsContent value="operation" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="shiftsPerDay">Shifts per Day *</Label>
                  <Input
                    id="shiftsPerDay"
                    type="number"
                    step="0.01"
                    min="0.5"
                    max="4"
                    {...register('shiftsPerDay', { valueAsNumber: true })}
                  />
                  {errors.shiftsPerDay && (
                    <span className="text-sm text-destructive">{errors.shiftsPerDay.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hoursPerShift">Hours per Shift *</Label>
                  <Input
                    id="hoursPerShift"
                    type="number"
                    step="0.01"
                    min="1"
                    max="24"
                    {...register('hoursPerShift', { valueAsNumber: true })}
                  />
                  {errors.hoursPerShift && (
                    <span className="text-sm text-destructive">{errors.hoursPerShift.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workingDaysPerYear">Working Days per Year *</Label>
                  <Input
                    id="workingDaysPerYear"
                    type="number"
                    step="0.01"
                    min="200"
                    max="365"
                    {...register('workingDaysPerYear', { valueAsNumber: true })}
                  />
                  {errors.workingDaysPerYear && (
                    <span className="text-sm text-destructive">{errors.workingDaysPerYear.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="plannedMaintenanceHoursPerYear">
                    Maintenance Hours per Year
                  </Label>
                  <Input
                    id="plannedMaintenanceHoursPerYear"
                    type="number"
                    step="0.01"
                    min="0"
                    {...register('plannedMaintenanceHoursPerYear', { valueAsNumber: true })}
                  />
                  {errors.plannedMaintenanceHoursPerYear && (
                    <span className="text-sm text-destructive">{errors.plannedMaintenanceHoursPerYear.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="capacityUtilizationRate">
                    Capacity Utilization Rate (%) *
                  </Label>
                  <Input
                    id="capacityUtilizationRate"
                    type="number"
                    step="0.01"
                    min="50"
                    max="100"
                    {...register('capacityUtilizationRate', { valueAsNumber: true })}
                  />
                  {errors.capacityUtilizationRate && (
                    <span className="text-sm text-destructive">{errors.capacityUtilizationRate.message}</span>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Costs Tab */}
            <TabsContent value="costs" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="landedMachineCost">Landed Machine Cost (₹) *</Label>
                  <Input
                    id="landedMachineCost"
                    type="number"
                    step="0.01"
                    min="1"
                    {...register('landedMachineCost', { valueAsNumber: true })}
                  />
                  {errors.landedMachineCost && (
                    <span className="text-sm text-destructive">{errors.landedMachineCost.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accessoriesCostPercentage">
                    Accessories Cost (%)
                  </Label>
                  <Input
                    id="accessoriesCostPercentage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="50"
                    {...register('accessoriesCostPercentage', { valueAsNumber: true })}
                  />
                  {errors.accessoriesCostPercentage && (
                    <span className="text-sm text-destructive">{errors.accessoriesCostPercentage.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="installationCostPercentage">
                    Installation Cost (%) *
                  </Label>
                  <Input
                    id="installationCostPercentage"
                    type="number"
                    step="0.01"
                    min="10"
                    max="40"
                    {...register('installationCostPercentage', { valueAsNumber: true })}
                  />
                  {errors.installationCostPercentage && (
                    <span className="text-sm text-destructive">{errors.installationCostPercentage.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paybackPeriodYears">Payback Period (Years) *</Label>
                  <Input
                    id="paybackPeriodYears"
                    type="number"
                    step="0.01"
                    min="1"
                    max="30"
                    {...register('paybackPeriodYears', { valueAsNumber: true })}
                  />
                  {errors.paybackPeriodYears && (
                    <span className="text-sm text-destructive">{errors.paybackPeriodYears.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="interestRatePercentage">Interest Rate (%)</Label>
                  <Input
                    id="interestRatePercentage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="30"
                    {...register('interestRatePercentage', { valueAsNumber: true })}
                  />
                  {errors.interestRatePercentage && (
                    <span className="text-sm text-destructive">{errors.interestRatePercentage.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="insuranceRatePercentage">Insurance Rate (%)</Label>
                  <Input
                    id="insuranceRatePercentage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="10"
                    {...register('insuranceRatePercentage', { valueAsNumber: true })}
                  />
                  {errors.insuranceRatePercentage && (
                    <span className="text-sm text-destructive">{errors.insuranceRatePercentage.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maintenanceCostPercentage">Maintenance Cost (%)</Label>
                  <Input
                    id="maintenanceCostPercentage"
                    type="number"
                    step="0.01"
                    min="0"
                    max="20"
                    {...register('maintenanceCostPercentage', { valueAsNumber: true })}
                  />
                  {errors.maintenanceCostPercentage && (
                    <span className="text-sm text-destructive">{errors.maintenanceCostPercentage.message}</span>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Utilities Tab */}
            <TabsContent value="utilities" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="machineFootprintSqm">Machine Footprint (m²)</Label>
                  <Input
                    id="machineFootprintSqm"
                    type="number"
                    step="0.01"
                    {...register('machineFootprintSqm', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rentPerSqmPerMonth">Rent per m² per Month (₹)</Label>
                  <Input
                    id="rentPerSqmPerMonth"
                    type="number"
                    step="0.01"
                    {...register('rentPerSqmPerMonth', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="powerKwhPerHour">Power (KWH per Hour)</Label>
                  <Input
                    id="powerKwhPerHour"
                    type="number"
                    step="0.01"
                    {...register('powerKwhPerHour', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="electricityCostPerKwh">Electricity Cost per KWH (₹)</Label>
                  <Input
                    id="electricityCostPerKwh"
                    type="number"
                    step="0.01"
                    {...register('electricityCostPerKwh', { valueAsNumber: true })}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Margins Tab */}
            <TabsContent value="margins" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminOverheadPercentage">
                    Admin Overhead (%)
                  </Label>
                  <Input
                    id="adminOverheadPercentage"
                    type="number"
                    step="0.01"
                    {...register('adminOverheadPercentage', { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profitMarginPercentage">Profit Margin (%)</Label>
                  <Input
                    id="profitMarginPercentage"
                    type="number"
                    step="0.01"
                    {...register('profitMarginPercentage', { valueAsNumber: true })}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || createMutation.isPending || updateMutation.isPending}
            >
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
