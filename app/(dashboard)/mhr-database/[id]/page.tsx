'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileDown, FileText, Printer, Edit2, Save, X } from 'lucide-react';
import { useMHRRecord, useUpdateMHR } from '@/lib/api/hooks';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { exportSingleMHRToPDF } from '@/lib/utils/exportMHRToPDF';
import { MHRFormDialog } from '@/components/features/mhr/MHRFormDialog';
import { EditableValue } from '@/components/ui/editable-value';
import { calculateMHR } from '@/lib/utils/mhrCalculations';
import type { MHRInputs, MHRCalculations } from '@/lib/utils/mhrCalculations';

export default function MHRDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';
  const router = useRouter();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editableInputs, setEditableInputs] = useState<MHRInputs | null>(null);
  const [liveCalculations, setLiveCalculations] = useState<MHRCalculations | null>(null);

  const { data: record, isLoading, error, isError } = useMHRRecord(id);
  const updateMHR = useUpdateMHR();

  useEffect(() => {
    if (record && !editableInputs) {
      const inputs: MHRInputs = {
        shiftsPerDay: record.shiftsPerDay,
        hoursPerShift: record.hoursPerShift,
        workingDaysPerYear: record.workingDaysPerYear,
        plannedMaintenanceHoursPerYear: record.plannedMaintenanceHoursPerYear,
        capacityUtilizationRate: record.capacityUtilizationRate,
        landedMachineCost: record.landedMachineCost,
        accessoriesCostPercentage: record.accessoriesCostPercentage,
        installationCostPercentage: record.installationCostPercentage,
        paybackPeriodYears: record.paybackPeriodYears,
        interestRatePercentage: record.interestRatePercentage,
        insuranceRatePercentage: record.insuranceRatePercentage,
        maintenanceCostPercentage: record.maintenanceCostPercentage,
        machineFootprintSqm: record.machineFootprintSqm,
        rentPerSqmPerMonth: record.rentPerSqmPerMonth,
        powerKwhPerHour: record.powerKwhPerHour,
        electricityCostPerKwh: record.electricityCostPerKwh,
        adminOverheadPercentage: record.adminOverheadPercentage,
        profitMarginPercentage: record.profitMarginPercentage,
      };
      setEditableInputs(inputs);
      setLiveCalculations(record.calculations);
    }
  }, [record, editableInputs]);

  useEffect(() => {
    if (editableInputs && isEditMode) {
      setLiveCalculations(calculateMHR(editableInputs));
    }
  }, [editableInputs, isEditMode]);

  const handleInputChange = (field: keyof MHRInputs, value: number) => {
    if (!editableInputs) return;
    setEditableInputs({ ...editableInputs, [field]: value });
  };

  const handleCancelEdit = () => {
    setIsEditMode(false);
    if (record) {
      const inputs: MHRInputs = {
        shiftsPerDay: record.shiftsPerDay, hoursPerShift: record.hoursPerShift,
        workingDaysPerYear: record.workingDaysPerYear, plannedMaintenanceHoursPerYear: record.plannedMaintenanceHoursPerYear,
        capacityUtilizationRate: record.capacityUtilizationRate, landedMachineCost: record.landedMachineCost,
        accessoriesCostPercentage: record.accessoriesCostPercentage, installationCostPercentage: record.installationCostPercentage,
        paybackPeriodYears: record.paybackPeriodYears, interestRatePercentage: record.interestRatePercentage,
        insuranceRatePercentage: record.insuranceRatePercentage, maintenanceCostPercentage: record.maintenanceCostPercentage,
        machineFootprintSqm: record.machineFootprintSqm, rentPerSqmPerMonth: record.rentPerSqmPerMonth,
        powerKwhPerHour: record.powerKwhPerHour, electricityCostPerKwh: record.electricityCostPerKwh,
        adminOverheadPercentage: record.adminOverheadPercentage, profitMarginPercentage: record.profitMarginPercentage,
      };
      setEditableInputs(inputs);
      setLiveCalculations(record.calculations);
    }
  };

  const handleSaveChanges = async () => {
    if (!editableInputs || !record) return;
    try {
      await updateMHR.mutateAsync({ id, data: editableInputs });
      setIsEditMode(false);
    } catch (err) {
      console.error('Failed to update MHR record:', err);
    }
  };

  const handleExport = () => {
    if (!record) return;
    const calc = record.calculations;
    const csvContent = [
      ['MHR Report'], [],
      ['Machine Name', record.machineName],
      ['Process Group', record.processGroup || record.commodityCode || '-'],
      ['Machine Class', record.machineClass || '-'],
      ['Wage Grade', record.wageGrade || '-'],
      ['Automation Level', record.automationLevel || '-'],
      ['Manufacturer', record.manufacturer || '-'],
      ['Manufacturer Country', record.manufacturerCountry || '-'],
      ['Location', record.location],
      ['Machine Price (USD)', record.machinePriceUsd ? `$${record.machinePriceUsd}` : '-'],
      ['LHR (₹/hr)', record.lhrInrPerHr || '-'],
      ['USD LHR Total', record.usdLhrTotal ? `$${record.usdLhrTotal}` : '-'],
      [], ['Machine Operating Hours'],
      ['Shifts per Day', record.shiftsPerDay], ['Hours per Shift', record.hoursPerShift],
      ['Working Days per Year', record.workingDaysPerYear],
      ['Working Hours per Year', calc.workingHoursPerYear],
      ['Capacity Utilization (%)', record.capacityUtilizationRate],
      ['Effective Hours per Year', calc.effectiveHoursPerYear],
      [], ['Cost per Hour'],
      ['Depreciation (₹/hr)', calc.depreciationPerHour], ['Interest (₹/hr)', calc.interestPerHour],
      ['Insurance (₹/hr)', calc.insurancePerHour], ['Rent (₹/hr)', calc.rentPerHour],
      ['Maintenance (₹/hr)', calc.maintenancePerHour], ['Electricity (₹/hr)', calc.electricityPerHour],
      ['Total MHR (₹/hr)', calc.totalMachineHourRate],
      [], ['Annual'],
      ['Total Annual Cost (₹)', calc.totalAnnualCost],
    ].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.download = `mhr-${record.machineName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  }

  if (isError || !record) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <h3 className="font-semibold text-lg">MHR Record Not Found</h3>
            <p className="text-sm text-muted-foreground">{(error as any)?.message || 'This record may have been deleted.'}</p>
            <Button variant="outline" onClick={() => router.push('/hr-rates')}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back to HR Rates
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const calc = liveCalculations || record.calculations;
  const inputs = editableInputs || {
    shiftsPerDay: record.shiftsPerDay, hoursPerShift: record.hoursPerShift,
    workingDaysPerYear: record.workingDaysPerYear, plannedMaintenanceHoursPerYear: record.plannedMaintenanceHoursPerYear,
    capacityUtilizationRate: record.capacityUtilizationRate, landedMachineCost: record.landedMachineCost,
    accessoriesCostPercentage: record.accessoriesCostPercentage, installationCostPercentage: record.installationCostPercentage,
    paybackPeriodYears: record.paybackPeriodYears, interestRatePercentage: record.interestRatePercentage,
    insuranceRatePercentage: record.insuranceRatePercentage, maintenanceCostPercentage: record.maintenanceCostPercentage,
    machineFootprintSqm: record.machineFootprintSqm, rentPerSqmPerMonth: record.rentPerSqmPerMonth,
    powerKwhPerHour: record.powerKwhPerHour, electricityCostPerKwh: record.electricityCostPerKwh,
    adminOverheadPercentage: record.adminOverheadPercentage, profitMarginPercentage: record.profitMarginPercentage,
  };

  return (
    <div className="space-y-4 print:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/hr-rates')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <PageHeader title="MHR Detail" description={`${record.machineName} · ${record.processGroup || record.commodityCode || ''}`} />
        </div>
        <div className="flex gap-2">
          {isEditMode ? (
            <>
              <Button variant="outline" onClick={handleCancelEdit}><X className="h-4 w-4 mr-2" />Cancel</Button>
              <Button onClick={handleSaveChanges} disabled={updateMHR.isPending}>
                <Save className="h-4 w-4 mr-2" />{updateMHR.isPending ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setIsEditMode(true)}><Edit2 className="h-4 w-4 mr-2" />Edit</Button>
              <Button variant="outline" onClick={handleExport}><FileDown className="h-4 w-4 mr-2" />CSV</Button>
              <Button variant="outline" onClick={() => exportSingleMHRToPDF(record, '', '')}><FileText className="h-4 w-4 mr-2" />PDF</Button>
              <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
            </>
          )}
        </div>
      </div>

      {/* Machine Overview — 4 cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Machine Identity */}
        <Card className="border-l-4 border-l-blue-500 md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Machine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="font-bold text-xl leading-tight">{record.machineName}</div>
            {record.machineDescription && <div className="text-sm text-muted-foreground">{record.machineDescription}</div>}
            <div className="flex flex-wrap gap-1 pt-1">
              {record.processGroup && <Badge variant="secondary">{record.processGroup}</Badge>}
              {record.machineClass && <Badge variant="outline">{record.machineClass}</Badge>}
              {record.automationLevel && <Badge variant="outline" className="text-purple-700 border-purple-300">{record.automationLevel}</Badge>}
            </div>
            <div className="text-sm pt-1 space-y-0.5">
              {record.manufacturer && <div><span className="text-muted-foreground">Manufacturer: </span><span className="font-medium">{record.manufacturer}{record.manufacturerCountry ? ` (${record.manufacturerCountry})` : ''}</span></div>}
              {record.wageGrade && <div><span className="text-muted-foreground">Wage Grade: </span><span className="font-medium">{record.wageGrade}</span></div>}
              {record.operators && <div><span className="text-muted-foreground">Operators: </span><span className="font-medium">{record.operators}</span></div>}
              <div><span className="text-muted-foreground">Location: </span><span className="font-medium">{record.location}</span></div>
              {record.machinePriceUsd && <div><span className="text-muted-foreground">Machine Price: </span><span className="font-medium">${record.machinePriceUsd.toLocaleString()}</span></div>}
              {record.setupTimeHr && <div><span className="text-muted-foreground">Setup Time: </span><span className="font-medium">{record.setupTimeHr} hr</span></div>}
            </div>
          </CardContent>
        </Card>

        {/* MHR */}
        <Card className="border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wide">MHR (₹/hr)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-primary">{formatCurrency(calc.totalMachineHourRate)}</div>
            <div className="text-xs text-muted-foreground mt-1">per operating hour</div>
            <div className="mt-3 text-sm space-y-0.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Fixed</span><span className="font-medium">{formatCurrency(calc.totalFixedCostPerHour)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Variable</span><span className="font-medium">{formatCurrency(calc.totalVariableCostPerHour)}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* LHR */}
        <Card className="border-2 border-blue-400 bg-gradient-to-br from-blue-50/50 to-blue-100/30 dark:from-blue-950/30 dark:to-blue-900/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-blue-600 uppercase tracking-wide">LHR (Labour)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-blue-700 dark:text-blue-400">
              {record.lhrInrPerHr ? formatCurrency(record.lhrInrPerHr) : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">₹ per hour (India)</div>
            {(record.usdLhrBase || record.usdLhrTotal) && (
              <div className="mt-3 text-sm space-y-0.5">
                {record.usdLaborRatePerHr && <div className="flex justify-between"><span className="text-muted-foreground">Labor Rate</span><span className="font-medium">${record.usdLaborRatePerHr.toFixed(2)}</span></div>}
                {record.usdLhrBase && <div className="flex justify-between"><span className="text-muted-foreground">LHR Base</span><span className="font-medium">${record.usdLhrBase.toFixed(2)}</span></div>}
                {record.usdLhrBurden && <div className="flex justify-between"><span className="text-muted-foreground">Burden @38%</span><span className="font-medium">${record.usdLhrBurden.toFixed(2)}</span></div>}
                {record.usdLhrTotal && <div className="flex justify-between font-semibold text-blue-700 dark:text-blue-400"><span>Total USD</span><span>${record.usdLhrTotal.toFixed(2)}</span></div>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Input Parameters (edit mode) */}
      <Card className={isEditMode ? 'border-2 border-primary print:hidden' : 'print:hidden'}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold">
            Input Parameters {isEditMode && <span className="text-xs font-normal text-muted-foreground ml-2">(Click values to edit)</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Operational */}
            <div className="space-y-2">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wide">Operational</h4>
              <div className="space-y-1.5 text-sm">
                {([
                  ['Shifts/Day', 'shiftsPerDay', formatNumber, 0, 4, 0.5],
                  ['Hours/Shift', 'hoursPerShift', formatNumber, 0, 24, 1],
                  ['Working Days/Year', 'workingDaysPerYear', formatNumber, 0, 365, 1],
                  ['Maintenance Hrs/Year', 'plannedMaintenanceHoursPerYear', formatNumber, 0, undefined, 1],
                  ['Capacity Utilization', 'capacityUtilizationRate', (v: number) => `${formatNumber(v)}%`, 0, 100, 1],
                ] as const).map(([label, field, fmt, min, max, step]) => (
                  <div key={field} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{label}:</span>
                    <EditableValue value={inputs[field as keyof MHRInputs]} onChange={v => handleInputChange(field as keyof MHRInputs, v)}
                      isEditable={isEditMode} formatDisplay={fmt as any} className="font-medium" min={min} step={step}
                      {...(max !== undefined ? { max } : {})} />
                  </div>
                ))}
              </div>
            </div>

            {/* Capital & Financial */}
            <div className="space-y-2">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wide">Capital & Financial</h4>
              <div className="space-y-1.5 text-sm">
                {([
                  ['Landed Machine Cost', 'landedMachineCost', formatCurrency, 0],
                  ['Accessories %', 'accessoriesCostPercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                  ['Installation %', 'installationCostPercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                  ['Payback Period', 'paybackPeriodYears', (v: number) => `${formatNumber(v)} yrs`, 1],
                  ['Interest Rate', 'interestRatePercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                  ['Insurance Rate', 'insuranceRatePercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                  ['Maintenance %', 'maintenanceCostPercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                ] as const).map(([label, field, fmt, min, max]) => (
                  <div key={field} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{label}:</span>
                    <EditableValue value={inputs[field as keyof MHRInputs]} onChange={v => handleInputChange(field as keyof MHRInputs, v)}
                      isEditable={isEditMode} formatDisplay={fmt as any} className="font-medium" min={min}
                      {...(max !== undefined ? { max } : {})} />
                  </div>
                ))}
              </div>
            </div>

            {/* Physical & Other */}
            <div className="space-y-2">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wide">Physical & Other</h4>
              <div className="space-y-1.5 text-sm">
                {([
                  ['Machine Footprint', 'machineFootprintSqm', (v: number) => `${formatNumber(v)} m²`, 0],
                  ['Rent per m²/month', 'rentPerSqmPerMonth', formatCurrency, 0],
                  ['Power KWH/hr', 'powerKwhPerHour', formatNumber, 0],
                  ['Electricity Cost/KWH', 'electricityCostPerKwh', formatCurrency, 0],
                  ['Admin Overhead', 'adminOverheadPercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                  ['Profit Margin', 'profitMarginPercentage', (v: number) => `${formatNumber(v)}%`, 0, 100],
                ] as const).map(([label, field, fmt, min, max]) => (
                  <div key={field} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{label}:</span>
                    <EditableValue value={inputs[field as keyof MHRInputs]} onChange={v => handleInputChange(field as keyof MHRInputs, v)}
                      isEditable={isEditMode} formatDisplay={fmt as any} className="font-medium" min={min}
                      {...(max !== undefined ? { max } : {})} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Operating Hours + Capital */}
        <div className="space-y-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Operating Hours</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="bg-slate-50 dark:bg-slate-900 px-2 py-1.5 rounded text-center">
                  <div className="text-xs text-muted-foreground">Shifts/Day</div>
                  <div className="font-bold">{formatNumber(inputs.shiftsPerDay)}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900 px-2 py-1.5 rounded text-center">
                  <div className="text-xs text-muted-foreground">Hours/Shift</div>
                  <div className="font-bold">{formatNumber(inputs.hoursPerShift)}</div>
                </div>
              </div>
              {[
                ['Working Days/Year', formatNumber(inputs.workingDaysPerYear), ''],
                ['Working Hours', formatNumber(calc.workingHoursPerYear) + ' hrs', 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'],
                ['Maintenance', `-${formatNumber(inputs.plannedMaintenanceHoursPerYear)} hrs`, 'text-orange-600'],
                ['Available Hours', formatNumber(calc.availableHoursPerYear) + ' hrs', 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300'],
                ['Utilization', formatNumber(inputs.capacityUtilizationRate) + '%', ''],
              ].map(([label, val, cls]) => (
                <div key={label} className={`flex justify-between items-center px-2 py-1 rounded ${cls}`}>
                  <span>{label}</span><span className="font-semibold">{val}</span>
                </div>
              ))}
              <div className="flex justify-between items-center bg-primary px-3 py-2 rounded-lg">
                <span className="font-bold text-white">Effective Hours</span>
                <span className="font-black text-lg text-white">{formatNumber(calc.effectiveHoursPerYear)} hrs</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Capital Investment</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Landed Machine Cost</span><span className="font-bold">{formatCurrency(inputs.landedMachineCost)}</span></div>
              <div className="flex justify-between"><span>Accessories ({formatNumber(inputs.accessoriesCostPercentage)}%)</span><span className="font-bold">+{formatCurrency(calc.accessoriesCost)}</span></div>
              <div className="flex justify-between"><span>Installation ({formatNumber(inputs.installationCostPercentage)}%)</span><span className="font-bold">+{formatCurrency(calc.installationCost)}</span></div>
              <div className="flex justify-between items-center bg-primary px-3 py-2 rounded-lg mt-1">
                <span className="font-bold text-white">Total Capital</span>
                <span className="font-black text-xl text-white">{formatCurrency(calc.totalCapitalInvestment)}</span>
              </div>
              <div className="border-t pt-2 space-y-0.5">
                <div className="flex justify-between"><span>Payback Period</span><span className="font-bold">{formatNumber(inputs.paybackPeriodYears)} yrs</span></div>
                <div className="flex justify-between bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded">
                  <span className="font-semibold">Annual Depreciation</span>
                  <span className="font-black">{formatCurrency(calc.depreciationPerAnnum)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Hourly Cost + Final MHR */}
        <div className="space-y-4">
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Hourly Cost Components</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Fixed Costs</div>
              {[
                ['Depreciation', calc.depreciationPerHour],
                ['Interest', calc.interestPerHour],
                ['Insurance', calc.insurancePerHour],
                ['Rent', calc.rentPerHour],
                ['Maintenance', calc.maintenancePerHour],
              ].map(([label, val]) => (
                <div key={label as string} className="flex justify-between"><span>{label as string}</span><span className="font-semibold">{formatCurrency(val as number)}</span></div>
              ))}
              <div className="flex justify-between bg-blue-50 dark:bg-blue-950 px-2 py-1.5 rounded font-bold text-blue-700 dark:text-blue-300">
                <span>Total Fixed</span><span>{formatCurrency(calc.totalFixedCostPerHour)}</span>
              </div>
              <div className="border-t pt-1">
                <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Variable Costs</div>
                <div className="flex justify-between"><span>Electricity</span><span className="font-semibold">{formatCurrency(calc.electricityPerHour)}</span></div>
                <div className="flex justify-between bg-orange-50 dark:bg-orange-950 px-2 py-1.5 rounded font-bold text-orange-700 dark:text-orange-300">
                  <span>Total Variable</span><span>{formatCurrency(calc.totalVariableCostPerHour)}</span>
                </div>
              </div>
              <div className="flex justify-between bg-green-600 px-3 py-2 rounded-lg font-bold text-white">
                <span>Operating Cost</span><span className="text-lg font-black">{formatCurrency(calc.totalOperatingCostPerHour)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10">
            <CardHeader className="pb-2 bg-primary/10"><CardTitle className="text-base font-bold">Final MHR Calculation</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Operating Cost</span><span className="font-semibold">{formatCurrency(calc.totalOperatingCostPerHour)}</span></div>
              <div className="flex justify-between"><span>Admin Overhead ({formatNumber(inputs.adminOverheadPercentage)}%)</span><span className="font-semibold text-purple-600">+{formatCurrency(calc.adminOverheadPerHour)}</span></div>
              <div className="flex justify-between bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded font-bold">
                <span>Subtotal</span><span>{formatCurrency(calc.totalOperatingCostPerHour + calc.adminOverheadPerHour)}</span>
              </div>
              <div className="flex justify-between"><span>Profit Margin ({formatNumber(inputs.profitMarginPercentage)}%)</span><span className="font-semibold text-emerald-600">+{formatCurrency(calc.profitMarginPerHour)}</span></div>
              <div className="flex justify-between items-center bg-primary px-4 py-3 rounded-lg border-2 border-primary/50 mt-1">
                <span className="font-black text-white">MHR per Hour</span>
                <span className="text-3xl font-black text-white">{formatCurrency(calc.totalMachineHourRate)}</span>
              </div>
              <div className="border-t pt-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Annual Projection</div>
                <div className="flex justify-between"><span>Effective Hours/Year</span><span className="font-semibold">{formatNumber(calc.effectiveHoursPerYear)} hrs</span></div>
                <div className="flex justify-between bg-primary/20 px-3 py-2 rounded-lg font-black text-primary">
                  <span>Annual Revenue Potential</span>
                  <span>{formatCurrency(calc.totalMachineHourRate * calc.effectiveHoursPerYear)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Annual Cost Analysis */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Annual Cost Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Annual Fixed Costs</div>
              {[['Depreciation', calc.depreciationPerAnnum], ['Interest', calc.interestPerAnnum], ['Insurance', calc.insurancePerAnnum], ['Rent', calc.rentPerAnnum], ['Maintenance', calc.maintenancePerAnnum]].map(([l, v]) => (
                <div key={l as string} className="flex justify-between"><span>{l as string}</span><span className="font-semibold">{formatCurrency(v as number)}</span></div>
              ))}
              <div className="flex justify-between bg-blue-50 dark:bg-blue-950 px-2 py-1.5 rounded font-bold text-blue-700 dark:text-blue-300">
                <span>Total Fixed</span><span>{formatCurrency(calc.totalFixedCostPerAnnum)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Annual Variable Costs</div>
              <div className="flex justify-between"><span>Electricity</span><span className="font-semibold">{formatCurrency(calc.electricityPerAnnum)}</span></div>
              <div className="flex justify-between bg-orange-50 dark:bg-orange-950 px-2 py-1.5 rounded font-bold text-orange-700 dark:text-orange-300">
                <span>Total Variable</span><span>{formatCurrency(calc.totalVariableCostPerAnnum)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Total Annual Impact</div>
              <div className="flex justify-between"><span>Operating Cost</span><span className="font-semibold">{formatCurrency(calc.totalAnnualCost)}</span></div>
              <div className="flex justify-between"><span>Admin Overhead</span><span className="font-semibold">{formatCurrency(calc.adminOverheadPerHour * calc.effectiveHoursPerYear)}</span></div>
              <div className="flex justify-between"><span>Profit Margin</span><span className="font-semibold">{formatCurrency(calc.profitMarginPerHour * calc.effectiveHoursPerYear)}</span></div>
              <div className="flex justify-between bg-primary px-3 py-2 rounded-lg font-black text-white">
                <span>Total Annual Value</span>
                <span className="text-lg">{formatCurrency(calc.totalMachineHourRate * calc.effectiveHoursPerYear)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <MHRFormDialog open={isEditOpen} onOpenChange={setIsEditOpen} editingId={id} />
    </div>
  );
}
