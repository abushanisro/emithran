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
import type { CreateMHRData } from '@/lib/api/mhr';
import { toast } from 'sonner';
import { useProcessHierarchy, useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { mhrFormSchema, type MHRFormData } from '@/lib/validations/mhrValidation';

interface MHRFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId?: string | null;
}

const getDefaultValues = (): MHRFormData => {
  // Default preset values without any hardcoded commodity selection
  const defaultPreset = {
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
    commodityCode: '', // No default commodity code - user must select
    machineName: '',
    machineDescription: '',
    manufacturer: '',
    model: '',
    specification: '', // No default specification - user must select
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
  
  // Get dynamic process hierarchy from API
  const { data: processHierarchy } = useProcessHierarchy();
  const { data: allMappings } = useProcessCalculatorMappings();
  
  // Hierarchical selection state
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedOperation, setSelectedOperation] = useState<string>('');
  
  // Transform API data for hierarchical dropdowns
  const processGroups = useMemo(() => {
    if (!processHierarchy?.processGroups) return [];
    
    const uniqueGroups = [...new Set(processHierarchy.processGroups)];
    return uniqueGroups.map((group) => ({
      value: group,
      label: group,
      description: `${group} manufacturing processes`
    }));
  }, [processHierarchy?.processGroups]);
  
  // Process routes filtered by selected group
  const processRoutes = useMemo(() => {
    if (!allMappings?.mappings || !selectedGroup) return [];
    
    const routesForGroup = allMappings.mappings
      .filter(mapping => mapping.processGroup === selectedGroup)
      .map(mapping => mapping.processRoute);
    
    const uniqueRoutes = [...new Set(routesForGroup)];
    return uniqueRoutes.map((route) => ({
      value: route,
      label: route,
      description: `${route} process route`
    }));
  }, [allMappings?.mappings, selectedGroup]);
  
  // Operations filtered by selected group and route
  const operations = useMemo(() => {
    if (!allMappings?.mappings || !selectedGroup || !selectedRoute) return [];
    
    const operationsForRoute = allMappings.mappings
      .filter(mapping => 
        mapping.processGroup === selectedGroup && 
        mapping.processRoute === selectedRoute
      )
      .map(mapping => mapping.operation);
    
    const uniqueOperations = [...new Set(operationsForRoute)];
    return uniqueOperations.map((operation) => ({
      value: operation,
      label: operation,
      description: `${operation} operation`
    }));
  }, [allMappings?.mappings, selectedGroup, selectedRoute]);
  
  // Manual edit mode state
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualMHRValue, setManualMHRValue] = useState<number>(0);

  // Handlers for hierarchical selection
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

  const handleOperationChange = (operation: string) => {
    setSelectedOperation(operation);
    setValue('specification', operation);
  };

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

  // No commodity preset logic - all values are manually entered

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
      
      // Load manual entry settings - check both camelCase and snake_case variants
      const isManual = Boolean(
        existingRecord.isManualEntry || 
        (existingRecord as any).is_manual_entry
      );
      
      const manualValue = Number(
        existingRecord.manualMHRValue || 
        (existingRecord as any).manual_mhr_value || 
        0
      );
      
      
      setIsManualMode(isManual);
      setManualMHRValue(manualValue);
      
      // Set hierarchical selection state from existing record
      if (existingRecord.commodityCode && allMappings?.mappings) {
        // Find the mapping that matches the existing record's specification
        const matchingMapping = allMappings.mappings.find(mapping => 
          mapping.operation === existingRecord.specification
        );
        
        if (matchingMapping) {
          setSelectedGroup(matchingMapping.processGroup);
          setSelectedRoute(matchingMapping.processRoute);
          setSelectedOperation(matchingMapping.operation);
        } else {
          // If no mapping found, try to set group from commodityCode
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
      // Validate hierarchical selection
      if (!selectedGroup) {
        toast.error('Please select a process group');
        return;
      }
      
      let submitData = data;
      
      // If manual mode is enabled, create simplified data with manual MHR value
      if (isManualMode) {
        if (manualMHRValue <= 0) {
          toast.error('Please enter a valid MHR value greater than 0');
          return;
        }
        
        // Create minimal data structure for manual mode
        submitData = {
          // Required basic fields
          machineName: data.machineName,
          location: data.location,
          commodityCode: data.commodityCode,
          machineDescription: data.machineDescription || '',
          manufacturer: data.manufacturer || '',
          model: data.model || '',
          specification: data.specification || '',
          
          // Set minimal defaults for required fields (won't be used for calculations)
          shiftsPerDay: 1,
          hoursPerShift: 8,
          workingDaysPerYear: 250,
          plannedMaintenanceHoursPerYear: 0,
          capacityUtilizationRate: 85,
          landedMachineCost: manualMHRValue, // Store manual value as landed cost for reference
          accessoriesCostPercentage: 0,
          installationCostPercentage: 10,
          paybackPeriodYears: 10,
          interestRatePercentage: 0,
          insuranceRatePercentage: 0,
          maintenanceCostPercentage: 0,
          machineFootprintSqm: 0,
          rentPerSqmPerMonth: 0,
          powerKwhPerHour: 0,
          electricityCostPerKwh: 0,
          adminOverheadPercentage: 0,
          profitMarginPercentage: 0,
          
          // Add manual flag and value for backend processing
          isManualEntry: true,
          manualMHRValue: manualMHRValue,
        } as any;
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
    setIsManualMode(false);
    setManualMHRValue(0);
    // Reset hierarchical selection state
    setSelectedGroup('');
    setSelectedRoute('');
    setSelectedOperation('');
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
              <TabsTrigger value="operation" disabled={isManualMode}>Operation</TabsTrigger>
              <TabsTrigger value="costs" disabled={isManualMode}>Costs</TabsTrigger>
              <TabsTrigger value="utilities" disabled={isManualMode}>Utilities</TabsTrigger>
              <TabsTrigger value="margins" disabled={isManualMode}>Margins</TabsTrigger>
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
                  <Label htmlFor="processGroup">Process Group *</Label>
                  <Select onValueChange={handleGroupChange} value={selectedGroup}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select process group" />
                    </SelectTrigger>
                    <SelectContent>
                      {processGroups.map((group, index) => (
                        <SelectItem key={`${group.value}-${index}`} value={group.value}>
                          <div className="flex flex-col">
                            <span className="font-medium">{group.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {group.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedGroup && (
                    <span className="text-sm text-destructive">Required</span>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="processRoute">Process Route</Label>
                  <Select 
                    onValueChange={handleRouteChange} 
                    value={selectedRoute}
                    disabled={!selectedGroup}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={selectedGroup ? "Select process route" : "Select group first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {processRoutes.map((route, index) => (
                        <SelectItem key={`${route.value}-${index}`} value={route.value}>
                          <div className="flex flex-col">
                            <span className="font-medium">{route.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {route.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="operation">Operation</Label>
                  <Select 
                    onValueChange={handleOperationChange} 
                    value={selectedOperation}
                    disabled={!selectedRoute}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={selectedRoute ? "Select operation" : "Select route first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {operations.map((operation, index) => (
                        <SelectItem key={`${operation.value}-${index}`} value={operation.value}>
                          <div className="flex flex-col">
                            <span className="font-medium">{operation.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {operation.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                
                {/* Manual MHR Edit Option */}
                <div className="col-span-2 space-y-4 border-t pt-4 mt-4">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="manual-mode"
                      checked={isManualMode}
                      onCheckedChange={setIsManualMode}
                    />
                    <Label htmlFor="manual-mode" className="text-sm font-medium">
                      Manual MHR Entry (Skip automatic calculation)
                    </Label>
                  </div>
                  
                  {isManualMode && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                            Manual Entry Mode
                          </span>
                        </div>
                        <p className="text-sm text-blue-700 dark:text-blue-300">
                          Enter the MHR value directly. The cost calculation tabs will be disabled.
                        </p>
                        <div className="space-y-2">
                          <Label htmlFor="manualMHR" className="text-sm font-semibold">
                            Machine Hour Rate (MHR) - ₹/hour *
                          </Label>
                          <Input
                            id="manualMHR"
                            type="number"
                            step="0.01"
                            min="0"
                            value={manualMHRValue === 0 ? '' : manualMHRValue}
                            onChange={(e) => {
                              const val = e.target.value;
                              setManualMHRValue(val === '' ? 0 : parseFloat(val) || 0);
                            }}
                            placeholder="Enter MHR value directly (e.g., 500.00)"
                            className="max-w-md"
                          />
                          <p className="text-xs text-muted-foreground">
                            This will override all automatic calculations
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
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
