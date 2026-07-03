'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, FileDown, FileText, Printer, Edit2, Save, X, AlertTriangle } from 'lucide-react';

const FX_RATES_LOCAL_PER_USD: Record<string, number> = {
  INR: 84.5, USD: 1.0, EUR: 0.92, CNY: 7.25, MXN: 17.5, GBP: 0.79,
  JPY: 154, TWD: 32.5, KRW: 1380, AUD: 1.56, CAD: 1.37, BRL: 5.1,
  THB: 36, MYR: 4.75, IDR: 15700, VND: 25300, SGD: 1.35, ZAR: 19.5,
  TRY: 34, RUB: 91, SAR: 3.75, AED: 3.67, PLN: 4.0, CZK: 23.5, HUF: 365, RON: 4.6,
};

function getCurrencyFromLocation(location: string): { currency: string; symbol: string } {
  const loc = (location || '').toLowerCase();
  if (!loc || loc.includes('india') || loc.includes('bangalore') || loc.includes('pune') ||
      loc.includes('chennai') || loc.includes('mumbai') || loc.includes('delhi') ||
      loc.includes('hyderabad')) return { currency: 'INR', symbol: '₹' };
  if (loc.includes('china') || loc.includes('shenzhen') || loc.includes('shanghai') ||
      loc.includes('beijing') || loc.includes('guangzhou')) return { currency: 'CNY', symbol: '¥' };
  if (loc.includes('germany') || loc.includes('france') || loc.includes('europe') ||
      loc.includes('spain') || loc.includes('italy') || loc.includes('netherlands') ||
      loc.includes('austria') || loc.includes('belgium') || loc.includes('poland') ||
      loc.includes('czech') || loc.includes('romania') || loc.includes('hungary') ||
      loc.includes('sweden') || loc.includes('norway') || loc.includes('finland')) return { currency: 'EUR', symbol: '€' };
  if (loc.includes('usa') || loc.includes('united states') || loc.includes('america') ||
      loc.includes('us -')) return { currency: 'USD', symbol: '$' };
  if (loc.includes('uk') || loc.includes('united kingdom') || loc.includes('britain')) return { currency: 'GBP', symbol: '£' };
  if (loc.includes('japan')) return { currency: 'JPY', symbol: '¥' };
  if (loc.includes('mexico')) return { currency: 'MXN', symbol: 'MX$' };
  if (loc.includes('taiwan')) return { currency: 'TWD', symbol: 'NT$' };
  if (loc.includes('korea')) return { currency: 'KRW', symbol: '₩' };
  if (loc.includes('australia')) return { currency: 'AUD', symbol: 'A$' };
  if (loc.includes('canada')) return { currency: 'CAD', symbol: 'CA$' };
  if (loc.includes('brazil')) return { currency: 'BRL', symbol: 'R$' };
  if (loc.includes('singapore')) return { currency: 'SGD', symbol: 'S$' };
  if (loc.includes('thailand')) return { currency: 'THB', symbol: '฿' };
  if (loc.includes('malaysia')) return { currency: 'MYR', symbol: 'RM' };
  if (loc.includes('indonesia')) return { currency: 'IDR', symbol: 'Rp' };
  if (loc.includes('vietnam')) return { currency: 'VND', symbol: '₫' };
  if (loc.includes('south africa')) return { currency: 'ZAR', symbol: 'R' };
  if (loc.includes('turkey')) return { currency: 'TRY', symbol: '₺' };
  if (loc.includes('uae') || loc.includes('dubai')) return { currency: 'AED', symbol: 'AED' };
  if (loc.includes('saudi')) return { currency: 'SAR', symbol: 'SR' };
  return { currency: 'INR', symbol: '₹' };
}
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
  const [editableLhrUsd, setEditableLhrUsd] = useState<{
    usdLaborRatePerHr: number;
    usdLhrBase: number;
    usdLhrBurden: number;
    usdLhrTotal: number;
  } | null>(null);

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
      setEditableLhrUsd({
        usdLaborRatePerHr: record.usdLaborRatePerHr ?? 0,
        usdLhrBase: record.usdLhrBase ?? 0,
        usdLhrBurden: record.usdLhrBurden ?? 0,
        usdLhrTotal: record.usdLhrTotal ?? 0,
      });
    }
  }, [record, editableInputs]);

  useEffect(() => {
    if (editableInputs && isEditMode) {
      const isPreCalcRecord = record?.isManualEntry && !!record?.mhrUsdPerHour;
      if (!isPreCalcRecord) {
        setLiveCalculations(calculateMHR(editableInputs));
      }
    }
  }, [editableInputs, isEditMode, record]);

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
      setEditableLhrUsd({
        usdLaborRatePerHr: record.usdLaborRatePerHr ?? 0,
        usdLhrBase: record.usdLhrBase ?? 0,
        usdLhrBurden: record.usdLhrBurden ?? 0,
        usdLhrTotal: record.usdLhrTotal ?? 0,
      });
    }
  };

  const handleSaveChanges = async () => {
    if (!editableInputs || !record) return;
    try {
      await updateMHR.mutateAsync({ id, data: { ...editableInputs, ...(editableLhrUsd || {}) } });
      setIsEditMode(false);
    } catch (err) {
      console.error('Failed to update MHR record:', err);
    }
  };

  const handleFixUsdToInr = async () => {
    if (!record?.machinePriceUsd) return;
    const { currency } = getCurrencyFromLocation(record.location);
    const localPerUsd = FX_RATES_LOCAL_PER_USD[currency] ?? 84.5;
    const correctedLandedCost = Math.round(record.machinePriceUsd * localPerUsd);
    try {
      await updateMHR.mutateAsync({ id, data: { landedMachineCost: correctedLandedCost, isManualEntry: false } });
      setEditableInputs(prev => prev ? { ...prev, landedMachineCost: correctedLandedCost } : prev);
    } catch (err) {
      console.error('Failed to fix landed cost:', err);
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

  // Currency-aware formatter: uses record's actual currency symbol
  const currSym = record.currencySymbol ?? (record.currency === 'INR' ? '₹' : '$');
  const fmtLocal = (v: number) =>
    `${currSym}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const isPreCalc = record.isManualEntry && !!record.mhrUsdPerHour;
  const machineOnlyMHR = isPreCalc ? (record.manualMHRValue ?? calc.totalMachineHourRate) : calc.totalMachineHourRate;
  const headlineMHR = isPreCalc && record.fullyBurdenedLocalPerHr
    ? record.fullyBurdenedLocalPerHr
    : calc.totalMachineHourRate;
  // LHR component added on top of machine MHR (shown explicitly in breakdown)
  const lhrComponent = record.lhrInrPerHr && record.lhrInrPerHr > 0 && headlineMHR > machineOnlyMHR
    ? headlineMHR - machineOnlyMHR
    : null;

  // Detect USD stored as INR: machine_price_usd > 0 but landed_machine_cost ≤ machine_price_usd × 20
  // (legitimate INR landed cost should be ~84.5× the USD price; anything below 20× is clearly USD)
  const { currency: locCurr, symbol: locSym } = getCurrencyFromLocation(record.location);
  const locPerUsd = FX_RATES_LOCAL_PER_USD[locCurr] ?? 84.5;
  const isUsdStoredAsInr = !!(
    record.machinePriceUsd && record.machinePriceUsd > 0 &&
    record.landedMachineCost > 0 &&
    record.landedMachineCost < record.machinePriceUsd * 20
  );
  const correctedLandedCost = record.machinePriceUsd
    ? Math.round(record.machinePriceUsd * locPerUsd) : 0;

  // Detect whether the Excel provided individual cost components or only aggregated totals
  const hasFixedBreakdown = calc.depreciationPerHour > 0 || calc.interestPerHour > 0 ||
    calc.insurancePerHour > 0 || calc.rentPerHour > 0 || calc.maintenancePerHour > 0;
  const hasAnnualBreakdown = calc.depreciationPerAnnum > 0 || calc.interestPerAnnum > 0 ||
    calc.insurancePerAnnum > 0 || calc.rentPerAnnum > 0 || calc.maintenancePerAnnum > 0;


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
            <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wide">MHR ({currSym}/hr)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-black text-primary">{fmtLocal(headlineMHR)}</div>
            <div className="text-xs text-muted-foreground mt-1">per operating hour</div>
            {isPreCalc && record.fullyBurdenedLocalPerHr && record.manualMHRValue != null && (
              <div className="text-xs text-muted-foreground">Machine only: {fmtLocal(record.manualMHRValue)}</div>
            )}
            <div className="mt-3 text-sm space-y-0.5">
              <div className="flex justify-between"><span className="text-muted-foreground">Fixed</span><span className="font-medium">{fmtLocal(calc.totalFixedCostPerHour)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Variable</span><span className="font-medium">{fmtLocal(calc.totalVariableCostPerHour)}</span></div>
              {(record.fullyBurdenedUsdPerHr || (record.mhrUsdPerHour && record.manualMHRValue && record.fullyBurdenedLocalPerHr) || record.mhrUsdPerHour) && (
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="text-muted-foreground">MHR USD</span>
                  <span className="font-medium text-green-600">
                    {(() => {
                      if (record.fullyBurdenedUsdPerHr) return `$${record.fullyBurdenedUsdPerHr.toFixed(2)}`;
                      if (record.mhrUsdPerHour && record.manualMHRValue && record.fullyBurdenedLocalPerHr) {
                        const fxRate = record.mhrUsdPerHour / record.manualMHRValue;
                        return `$${(record.fullyBurdenedLocalPerHr * fxRate).toFixed(2)}`;
                      }
                      return `$${record.mhrUsdPerHour!.toFixed(2)}`;
                    })()}
                  </span>
                </div>
              )}
              {record.fullyBurdenedLocalPerHr && (
                <div className="flex justify-between"><span className="text-muted-foreground">Fully Burdened</span><span className="font-medium">{fmtLocal(record.fullyBurdenedLocalPerHr)}</span></div>
              )}
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
              {record.lhrInrPerHr ? fmtLocal(record.lhrInrPerHr) : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{currSym} per hour ({record.location})</div>
            {(record.usdLhrBase || record.usdLhrTotal || isEditMode) && editableLhrUsd && (
              <div className="mt-3 text-sm space-y-0.5">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Labor Rate</span>
                  <EditableValue value={editableLhrUsd.usdLaborRatePerHr} onChange={v => setEditableLhrUsd(p => ({ ...p!, usdLaborRatePerHr: v }))} isEditable={isEditMode} formatDisplay={(v: number) => `$${v.toFixed(2)}`} className="font-medium" min={0} step={0.01} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">LHR Base</span>
                  <EditableValue value={editableLhrUsd.usdLhrBase} onChange={v => setEditableLhrUsd(p => ({ ...p!, usdLhrBase: v }))} isEditable={isEditMode} formatDisplay={(v: number) => `$${v.toFixed(2)}`} className="font-medium" min={0} step={0.01} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Burden @38%</span>
                  <EditableValue value={editableLhrUsd.usdLhrBurden} onChange={v => setEditableLhrUsd(p => ({ ...p!, usdLhrBurden: v }))} isEditable={isEditMode} formatDisplay={(v: number) => `$${v.toFixed(2)}`} className="font-medium" min={0} step={0.01} />
                </div>
                <div className="flex justify-between items-center font-semibold text-blue-700 dark:text-blue-400">
                  <span>Total USD</span>
                  <EditableValue value={editableLhrUsd.usdLhrTotal} onChange={v => setEditableLhrUsd(p => ({ ...p!, usdLhrTotal: v }))} isEditable={isEditMode} formatDisplay={(v: number) => `$${v.toFixed(2)}`} className="font-semibold" min={0} step={0.01} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* USD-stored-as-INR warning banner */}
      {isUsdStoredAsInr && !isEditMode && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg print:hidden">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <span className="font-semibold">Landed cost is stored in USD, not {locCurr}.</span>
              {' '}Machine price ${record.machinePriceUsd?.toLocaleString()} USD → correct landed cost: {locSym}{correctedLandedCost.toLocaleString()} {locCurr}. MHR is being computed from the wrong base.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100"
            onClick={handleFixUsdToInr}
            disabled={updateMHR.isPending}
          >
            {updateMHR.isPending ? 'Fixing...' : `Fix: ×${locPerUsd} → ${locCurr}`}
          </Button>
        </div>
      )}

      {/* Pre-calc edit banner */}
      {isEditMode && isPreCalc && (
        <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700 print:hidden">
          Pre-calculated import — MHR and Fully Burdened rates are sourced from the Excel file.
          The input parameters below are stored for reference only and do not affect the MHR.
        </div>
      )}

      {/* Input Parameters (edit mode) */}
      {!isPreCalc && <Card className={isEditMode ? 'border-2 border-primary print:hidden' : 'print:hidden'}>
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
                  ['Landed Machine Cost', 'landedMachineCost', fmtLocal, 0],
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
                  ['Rent per m²/month', 'rentPerSqmPerMonth', fmtLocal, 0],
                  ['Power KWH/hr', 'powerKwhPerHour', formatNumber, 0],
                  ['Electricity Cost/KWH', 'electricityCostPerKwh', fmtLocal, 0],
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
      </Card>}

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
                <span className="font-bold text-primary-foreground">Effective Hours</span>
                <span className="font-black text-lg text-primary-foreground">{formatNumber(calc.effectiveHoursPerYear)} hrs</span>
              </div>
            </CardContent>
          </Card>

          {!isPreCalc && (
          <Card className="border-l-4 border-l-purple-500">
            <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Capital Investment</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Landed Machine Cost</span><span className="font-bold">{fmtLocal(inputs.landedMachineCost)}</span></div>
              <div className="flex justify-between"><span>Accessories ({formatNumber(inputs.accessoriesCostPercentage)}%)</span><span className="font-bold">+{fmtLocal(calc.accessoriesCost)}</span></div>
              <div className="flex justify-between"><span>Installation ({formatNumber(inputs.installationCostPercentage)}%)</span><span className="font-bold">+{fmtLocal(calc.installationCost)}</span></div>
              <div className="flex justify-between items-center bg-primary px-3 py-2 rounded-lg mt-1">
                <span className="font-bold text-primary-foreground">Total Capital</span>
                <span className="font-black text-xl text-primary-foreground">{fmtLocal(calc.totalCapitalInvestment)}</span>
              </div>
              <div className="border-t pt-2 space-y-0.5">
                <div className="flex justify-between"><span>Payback Period</span><span className="font-bold">{formatNumber(inputs.paybackPeriodYears)} yrs</span></div>
                <div className="flex justify-between bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded">
                  <span className="font-semibold">Annual Depreciation</span>
                  <span className="font-black">{fmtLocal(calc.depreciationPerAnnum)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
          )}
        </div>

        {/* Hourly Cost + Final MHR */}
        <div className="space-y-4">
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2"><CardTitle className="text-base font-bold">Hourly Cost Components</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Fixed Costs</div>
              {hasFixedBreakdown ? (
                [
                  ['Depreciation', calc.depreciationPerHour],
                  ['Interest', calc.interestPerHour],
                  ['Insurance', calc.insurancePerHour],
                  ['Rent', calc.rentPerHour],
                  ['Maintenance', calc.maintenancePerHour],
                ].map(([label, val]) => (
                  <div key={label as string} className="flex justify-between"><span>{label as string}</span><span className="font-semibold">{fmtLocal(val as number)}</span></div>
                ))
              ) : (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost of Ownership</span>
                  <span className="font-semibold">{fmtLocal(calc.totalFixedCostPerHour)}</span>
                </div>
              )}
              <div className="flex justify-between bg-blue-50 dark:bg-blue-950 px-2 py-1.5 rounded font-bold text-blue-700 dark:text-blue-300">
                <span>Total Fixed</span><span>{fmtLocal(calc.totalFixedCostPerHour)}</span>
              </div>
              <div className="border-t pt-1">
                <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Variable Costs</div>
                {calc.electricityPerHour > 0 ? (
                  <div className="flex justify-between"><span>Electricity</span><span className="font-semibold">{fmtLocal(calc.electricityPerHour)}</span></div>
                ) : calc.totalVariableCostPerHour > 0 ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">MRO & Utilities</span><span className="font-semibold">{fmtLocal(calc.totalVariableCostPerHour)}</span></div>
                ) : null}
                <div className="flex justify-between bg-orange-50 dark:bg-orange-950 px-2 py-1.5 rounded font-bold text-orange-700 dark:text-orange-300">
                  <span>Total Variable</span><span>{fmtLocal(calc.totalVariableCostPerHour)}</span>
                </div>
              </div>
              <div className="flex justify-between bg-green-600 px-3 py-2 rounded-lg font-bold text-white">
                <span>Operating Cost</span><span className="text-lg font-black">{fmtLocal(calc.totalOperatingCostPerHour)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-primary bg-gradient-to-br from-primary/5 to-primary/10">
            <CardHeader className="pb-2 bg-primary/10"><CardTitle className="text-base font-bold">Final MHR Calculation</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Machine Operating Cost</span><span className="font-semibold">{fmtLocal(calc.totalOperatingCostPerHour)}</span></div>
              <div className="flex justify-between"><span>Admin Overhead ({formatNumber(inputs.adminOverheadPercentage)}%)</span><span className="font-semibold text-purple-600">+{fmtLocal(calc.adminOverheadPerHour)}</span></div>
              <div className="flex justify-between bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded font-bold">
                <span>Subtotal</span><span>{fmtLocal(calc.totalOperatingCostPerHour + calc.adminOverheadPerHour)}</span>
              </div>
              <div className="flex justify-between"><span>Profit Margin ({formatNumber(inputs.profitMarginPercentage)}%)</span><span className="font-semibold text-emerald-600">+{fmtLocal(calc.profitMarginPerHour)}</span></div>
              {lhrComponent != null && (
                <div className="flex justify-between border-t pt-1">
                  <span className="text-blue-700 dark:text-blue-400">Labour (LHR)</span>
                  <span className="font-semibold text-blue-700 dark:text-blue-400">+{fmtLocal(lhrComponent)}</span>
                </div>
              )}
              <div className="flex justify-between items-center bg-primary px-4 py-3 rounded-lg border-2 border-primary/50 mt-1">
                <span className="font-black text-primary-foreground">{lhrComponent != null ? 'MHR + LHR / Hour' : 'MHR per Hour'}</span>
                <span className="text-3xl font-black text-primary-foreground">{fmtLocal(headlineMHR)}</span>
              </div>
              <div className="border-t pt-2">
                <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Annual Projection</div>
                <div className="flex justify-between"><span>Effective Hours/Year</span><span className="font-semibold">{formatNumber(calc.effectiveHoursPerYear)} hrs</span></div>
                <div className="flex justify-between bg-primary/20 px-3 py-2 rounded-lg font-black text-primary">
                  <span>Annual Revenue Potential</span>
                  <span>{fmtLocal(headlineMHR * calc.effectiveHoursPerYear)}</span>
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
              {hasAnnualBreakdown ? (
                [['Depreciation', calc.depreciationPerAnnum], ['Interest', calc.interestPerAnnum], ['Insurance', calc.insurancePerAnnum], ['Rent', calc.rentPerAnnum], ['Maintenance', calc.maintenancePerAnnum]].map(([l, v]) => (
                  <div key={l as string} className="flex justify-between"><span>{l as string}</span><span className="font-semibold">{fmtLocal(v as number)}</span></div>
                ))
              ) : (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cost of Ownership</span>
                  <span className="font-semibold">{fmtLocal(calc.totalFixedCostPerHour * calc.effectiveHoursPerYear)}</span>
                </div>
              )}
              <div className="flex justify-between bg-blue-50 dark:bg-blue-950 px-2 py-1.5 rounded font-bold text-blue-700 dark:text-blue-300">
                <span>Total Fixed</span>
                <span>{fmtLocal(hasAnnualBreakdown ? calc.totalFixedCostPerAnnum : calc.totalFixedCostPerHour * calc.effectiveHoursPerYear)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Annual Variable Costs</div>
              {calc.electricityPerAnnum > 0 ? (
                <div className="flex justify-between"><span>Electricity</span><span className="font-semibold">{fmtLocal(calc.electricityPerAnnum)}</span></div>
              ) : calc.totalVariableCostPerHour > 0 ? (
                <div className="flex justify-between"><span className="text-muted-foreground">MRO & Utilities</span><span className="font-semibold">{fmtLocal(calc.totalVariableCostPerHour * calc.effectiveHoursPerYear)}</span></div>
              ) : null}
              <div className="flex justify-between bg-orange-50 dark:bg-orange-950 px-2 py-1.5 rounded font-bold text-orange-700 dark:text-orange-300">
                <span>Total Variable</span>
                <span>{fmtLocal(calc.totalVariableCostPerAnnum > 0 ? calc.totalVariableCostPerAnnum : calc.totalVariableCostPerHour * calc.effectiveHoursPerYear)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Total Annual Impact</div>
              <div className="flex justify-between"><span>Operating Cost</span><span className="font-semibold">{fmtLocal(calc.totalAnnualCost)}</span></div>
              <div className="flex justify-between"><span>Admin Overhead</span><span className="font-semibold">{fmtLocal(calc.adminOverheadPerHour * calc.effectiveHoursPerYear)}</span></div>
              <div className="flex justify-between"><span>Profit Margin</span><span className="font-semibold">{fmtLocal(calc.profitMarginPerHour * calc.effectiveHoursPerYear)}</span></div>
              <div className="flex justify-between bg-primary px-3 py-2 rounded-lg font-black text-primary-foreground">
                <span>Total Annual Value</span>
                <span className="text-lg">{fmtLocal(headlineMHR * calc.effectiveHoursPerYear)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <MHRFormDialog open={isEditOpen} onOpenChange={setIsEditOpen} editingId={id} />
    </div>
  );
}
