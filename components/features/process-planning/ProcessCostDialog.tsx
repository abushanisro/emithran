'use client';

import React, { useState, useEffect, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMHRRecords, useMHRRecord, useMHRBenchmark } from '@/lib/api/hooks/useMHR';
import { useLHR, useLHRById, useLHRBenchmark } from '@/lib/api/hooks/useLHR';
import { useProcessHierarchy, useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { useCalculators, useCalculator, useExecuteCalculator } from '@/lib/api/hooks/useCalculators';
import { Loader2, Calculator as CalculatorIcon, Play, Eye } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';


interface ProcessCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  editData?: any;
  bomItemData?: any;
  existingProcesses?: any[];
  defaultLocation?: string | undefined;
  currencySymbol?: string;
}

export function ProcessCostDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
  bomItemData,
  existingProcesses = [],
  defaultLocation,
  currencySymbol = '$',
}: ProcessCostDialogProps) {
  const [opNbr, setOpNbr] = useState<number>(0);
  const [location, setLocation] = useState<string>('');
  // Hierarchical selections
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [selectedOperation, setSelectedOperation] = useState<string>('');
  const [selectedProcessCalculatorId, setSelectedProcessCalculatorId] = useState<string>('');

  // Resource selections
  const [selectedMHRId, setSelectedMHRId] = useState<string>('');
  const [selectedLHRId, setSelectedLHRId] = useState<string>('');
  const [setupManning, setSetupManning] = useState<number | string>('');
  const [setupTime, setSetupTime] = useState<number | string>('');
  const [batchSize, setBatchSize] = useState<number | string>('');
  const [heads, setHeads] = useState<number | string>('');
  const [cycleTime, setCycleTime] = useState<number | string>('');
  const [partsPerCycle, setPartsPerCycle] = useState<number | string>('');
  const [scrap, setScrap] = useState<number | string>('');
  const [machineValue, setMachineValue] = useState<number | string>('');
  // Manual rate fallback — used when MHR/LHR dropdown has no records
  const [manualMhrRate, setManualMhrRate] = useState<number | ''>('');
  const [manualLhrRate, setManualLhrRate] = useState<number | ''>('');

  // Track whether the engineer explicitly chose a rate — prevents auto-select from overriding a manual pick
  const [userOverrodeMHR, setUserOverrodeMHR] = useState(false);
  const [userOverrodeLHR, setUserOverrodeLHR] = useState(false);

  // Prevents the full pickers from flashing empty before the load effect fires in edit mode.
  // false = load effect hasn't run yet for this open; true = fields are populated from editData.
  const [editDataApplied, setEditDataApplied] = useState(false);
  // When true, show hierarchy pickers instead of read-only "Saved process" panel (after Re-select click)
  const [reSelectMode, setReSelectMode] = useState(false);

  // Preserve facilityId and facilityRateId from editData for updates
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const [facilityRateId, setFacilityRateId] = useState<string | undefined>(undefined);

  // Calculator state
  const [calculatorOpen, setCalculatorOpen] = useState<boolean>(false);
  const [calculatorTarget, setCalculatorTarget] = useState<string | null>(null);
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<string>('');
  const [calculatorInputs, setCalculatorInputs] = useState<Record<string, any>>({});
  const [calculatorResults, setCalculatorResults] = useState<Record<string, any> | null>(null);
  const [selectedLookupField, setSelectedLookupField] = useState<any>(null);
  const [showLookupTable, setShowLookupTable] = useState<boolean>(false);
  const [lookupTableData, setLookupTableData] = useState<any>(null);

  // Fetch process hierarchy (processGroups, processRoutes, operations)
  const { data: hierarchyData, isLoading: isLoadingHierarchy, error: hierarchyError } = useProcessHierarchy();

  // Fetch ALL calculator mappings to enable proper filtering (set high limit to get all)
  const { data: allMappingsData } = useProcessCalculatorMappings({ limit: 1000 }, { enabled: open });

  // Fetch calculator mappings based on selections
  const { data: processCalculatorMappings } = useProcessCalculatorMappings(
    { processGroup: selectedGroup, processRoute: selectedRoute, operation: selectedOperation },
    { enabled: open && !!selectedGroup && !!selectedRoute && !!selectedOperation }
  );

  const { data: mhrData, isLoading: isLoadingMHR, error: mhrError } = useMHRRecords({ limit: 100 });
  // Benchmark MHR from DB — global table, no user_id, seeded by migration 345
  const { data: benchmarkMHR } = useMHRBenchmark(undefined, { enabled: open });
  // When editing, fetch the specific saved MHR/LHR so they always appear in their lists
  const savedMHRId = editData?.mhrId || editData?.machineId || '';
  const savedLHRId = editData?.lhrId ? String(editData.lhrId) : '';
  const { data: savedMHRRecord } = useMHRRecord(savedMHRId, { enabled: !!savedMHRId && open });
  const { data: savedLHRRecord } = useLHRById(savedLHRId && open ? savedLHRId : '');
  const { data: lhrData, isLoading: isLoadingLHR, error: lhrError } = useLHR();
  const { data: benchmarkLHR } = useLHRBenchmark();
  const { data: calculatorsData, isLoading: isLoadingCalculators, error: calculatorsError } = useCalculators();
  const { data: selectedCalculator } = useCalculator(selectedCalculatorId, { enabled: !!selectedCalculatorId });
  const executeCalculator = useExecuteCalculator();

  // Check for errors
  const hasErrors = mhrError || lhrError || hierarchyError || calculatorsError;

  const getSuggestedOpNbr = () => {
    if (!existingProcesses || existingProcesses.length === 0) return 10;
    const maxOpNbr = Math.max(...existingProcesses.map(p => p.opNbr || 0));
    return maxOpNbr + 10;
  };

  // Get process groups from hierarchy
  const processGroups = useMemo(() => {
    return hierarchyData?.processGroups || [];
  }, [hierarchyData]);

  // Get process routes filtered by selected group
  const processRoutes = useMemo(() => {
    if (!selectedGroup || !allMappingsData?.mappings) return [];

    // Filter mappings by selected group and get unique process routes
    const routesForGroup = allMappingsData.mappings
      .filter((mapping: any) => mapping.processGroup === selectedGroup)
      .map((mapping: any) => mapping.processRoute);

    return [...new Set(routesForGroup)].sort();
  }, [allMappingsData, selectedGroup]);

  // Get operations filtered by selected route
  const operations = useMemo(() => {
    if (!selectedGroup || !selectedRoute || !allMappingsData?.mappings) return [];

    // Filter mappings by selected group and route, then get unique operations
    const operationsForRoute = allMappingsData.mappings
      .filter((mapping: any) =>
        mapping.processGroup === selectedGroup &&
        mapping.processRoute === selectedRoute
      )
      .map((mapping: any) => mapping.operation);

    return [...new Set(operationsForRoute)].sort();
  }, [allMappingsData, selectedGroup, selectedRoute]);

  // Get available calculators from mappings
  const availableCalculators = useMemo(() => {
    if (!processCalculatorMappings?.mappings) return [];
    return processCalculatorMappings.mappings;
  }, [processCalculatorMappings]);

  // ─── filteredMHR ─────────────────────────────────────────────────────────────
  // Priority: 1) user's own mhr_records (exact location+group)
  //           2) user's own mhr_records (location only)
  //           3) mhr_benchmark_rates DB table (migration 345) — location+group
  //           4) mhr_benchmark_rates DB table — location only
  // Never falls back across locations; never uses hardcoded constants.
  const filteredMHR = useMemo(() => {
    const base = mhrData?.records ?? [];
    const bm   = benchmarkMHR ?? [];
    const locLower = location.toLowerCase();

    const byLoc = (arr: any[]) =>
      !location ? arr : arr.filter(r => (r.location ?? '').toLowerCase() === locLower);
    const byGroup = (arr: any[]) =>
      selectedGroup ? arr.filter(r => r.processGroup === selectedGroup) : arr;

    // 1 & 2 — user's own records
    const dbLoc   = byLoc(base);
    const dbMatch = byGroup(dbLoc);
    const dbResult = dbMatch.length > 0 ? dbMatch : (dbLoc.length > 0 ? dbLoc : null);
    if (dbResult && dbResult.length > 0) {
      if (savedMHRRecord && !dbResult.some((r: any) => String(r.id) === String(savedMHRRecord.id))) {
        return [savedMHRRecord, ...dbResult] as any[];
      }
      return dbResult as any[];
    }

    // 3 & 4 — DB benchmark table (mhr_benchmark_rates)
    const bmLoc   = byLoc(bm);
    const bmMatch = byGroup(bmLoc);
    const bmResult = bmMatch.length > 0 ? bmMatch : (bmLoc.length > 0 ? bmLoc : bm);
    if (savedMHRRecord && !bmResult.some((r: any) => String(r.id) === String(savedMHRRecord.id))) {
      return [savedMHRRecord, ...bmResult] as any[];
    }
    return bmResult as any[];
  }, [mhrData, benchmarkMHR, location, selectedGroup, savedMHRRecord]);

  // ─── filteredLHR ─────────────────────────────────────────────────────────────
  // Priority: 1) user's own lsr_records (location+group)
  //           2) user's own lsr_records (location only)
  //           3) lhr_benchmark_rates DB table (migration 345) — location+group
  //           4) lhr_benchmark_rates DB table — location only
  const filteredLHR = useMemo(() => {
    const records = lhrData?.records ?? [];
    const bm      = benchmarkLHR ?? [];
    const locLower = location.toLowerCase();

    const byLoc = (arr: any[]) =>
      !location ? arr : arr.filter((r: any) => (r.location ?? '').toLowerCase() === locLower);
    const byGroup = (arr: any[]) =>
      selectedGroup ? arr.filter((r: any) => r.processGroup === selectedGroup) : arr;

    // 1 & 2 — user's own records
    const userLoc   = byLoc(records);
    const userMatch = byGroup(userLoc);
    const userResult = userMatch.length > 0 ? userMatch : (userLoc.length > 0 ? userLoc : null);
    const withSaved = (base: any[]) => {
      if (savedLHRRecord && !base.some((r: any) => String(r.id) === String((savedLHRRecord as any).id))) {
        return [savedLHRRecord, ...base] as any[];
      }
      return base as any[];
    };
    if (userResult && userResult.length > 0) return withSaved(userResult);

    // 3 & 4 — DB benchmark table (lhr_benchmark_rates)
    const bmLoc   = byLoc(bm);
    const bmMatch = byGroup(bmLoc);
    const bmResult = bmMatch.length > 0 ? bmMatch : (bmLoc.length > 0 ? bmLoc : bm);
    return withSaved(bmResult as any[]);
  }, [lhrData, benchmarkLHR, location, selectedGroup, savedLHRRecord]);

  // Get selected MHR and LHR — both use String() to avoid number/string type mismatch
  const selectedMHR = useMemo(() => {
    return filteredMHR.find(r => String(r.id) === String(selectedMHRId));
  }, [filteredMHR, selectedMHRId]);

  const selectedLHR = useMemo(() => {
    return filteredLHR.find((r: any) => String(r.id) === String(selectedLHRId));
  }, [filteredLHR, selectedLHRId]);

  useEffect(() => {
    if (hierarchyError) {
    }
  }, [hierarchyError]);

  // Auto-select top MHR match when process group changes — skip if the engineer already picked one explicitly
  useEffect(() => {
    if (!selectedGroup || userOverrodeMHR) return;
    if (filteredMHR.length > 0 && !selectedMHRId) {
      setSelectedMHRId(String(filteredMHR[0].id));
    }
  }, [selectedGroup, filteredMHR, userOverrodeMHR, selectedMHRId]);

  // Auto-select top LHR match when process group changes — skip if the engineer already picked one explicitly
  useEffect(() => {
    if (!selectedGroup || userOverrodeLHR) return;
    if (filteredLHR.length > 0 && !selectedLHRId) {
      setSelectedLHRId(String((filteredLHR[0] as any).id));
    }
  }, [selectedGroup, filteredLHR, userOverrodeLHR, selectedLHRId]);

  // Calculator handlers
  const handleCalculatorValue = (value: number | string) => {
    if (calculatorTarget === 'setupManning') setSetupManning(Number(value));
    else if (calculatorTarget === 'setupTime') setSetupTime(Number(value));
    else if (calculatorTarget === 'batchSize') setBatchSize(Number(value));
    else if (calculatorTarget === 'cycleTime') setCycleTime(Number(value));
    else if (calculatorTarget === 'partsPerCycle') setPartsPerCycle(Number(value));
    else if (calculatorTarget === 'heads') setHeads(Number(value));
    else if (calculatorTarget === 'scrap') setScrap(Number(value));
    else if (calculatorTarget === 'machineValue') setMachineValue(Number(value));
    else if (calculatorTarget === 'operation') {
      // For operation, we might get an operation name
      if (typeof value === 'string') {
        setSelectedOperation(value);
      }
    }
    else if (calculatorTarget === 'processCalculator') {
      // For process calculator, the value is used automatically from calculator results
      // The calculator ID is already set, so we just close the panel
      // The actual values would be set from calculator results in handleExecuteCalculator
    }

    setCalculatorOpen(false);
    setCalculatorResults(null);
    setCalculatorInputs({});
    // Don't reset selectedCalculatorId for processCalculator as we want to keep it selected
    if (calculatorTarget !== 'processCalculator') {
      setSelectedCalculatorId('');
    }
    setCalculatorTarget(null);
  };

  const handleExecuteCalculator = async () => {
    if (!selectedCalculatorId) return;
    try {
      const result = await executeCalculator.mutateAsync({
        calculatorId: selectedCalculatorId,
        inputValues: calculatorInputs,
      });
      if (result.success) {
        setCalculatorResults(result.results);
      }
    } catch (error) {
    }
  };

  // Auto-populate calculator inputs from BOM data
  const autoPopulateFromBOM = () => {
    if (!bomItemData || !selectedCalculator) return;

    const bomFieldMapping: Record<string, any> = {
      // Weight mappings
      'weight': bomItemData.weight || bomItemData.unitWeight,
      'unitWeight': bomItemData.unitWeight || bomItemData.weight,
      'Weight': bomItemData.weight || bomItemData.unitWeight,
      'Weight(kg)': bomItemData.weight || bomItemData.unitWeight,
      
      // Dimension mappings
      'length': bomItemData.length || bomItemData.maxLength,
      'maxLength': bomItemData.maxLength || bomItemData.length,
      'Length': bomItemData.length || bomItemData.maxLength,
      'Max Length': bomItemData.maxLength || bomItemData.length,
      'Max Length(mm)': bomItemData.maxLength || bomItemData.length,
      
      'width': bomItemData.width || bomItemData.maxWidth,
      'maxWidth': bomItemData.maxWidth || bomItemData.width,
      'Width': bomItemData.width || bomItemData.maxWidth,
      'Max Width': bomItemData.maxWidth || bomItemData.width,
      'Max Width(mm)': bomItemData.maxWidth || bomItemData.width,
      
      'height': bomItemData.height || bomItemData.maxHeight,
      'maxHeight': bomItemData.maxHeight || bomItemData.height,
      'Height': bomItemData.height || bomItemData.maxHeight,
      'Max Height': bomItemData.maxHeight || bomItemData.height,
      'Max Height(mm)': bomItemData.maxHeight || bomItemData.height,
      
      // Surface area mapping
      'surfaceArea': bomItemData.surfaceArea,
      'Surface Area': bomItemData.surfaceArea,
      'Surface Area(mm²)': bomItemData.surfaceArea,
    };

    const newInputs: Record<string, any> = { ...calculatorInputs };

    selectedCalculator.fields
      ?.filter((field: any) => field.fieldType !== 'calculated')
      .forEach((field: any) => {
        const fieldName = field.fieldName;
        const displayName = field.displayLabel || field.displayName;

        // Try to match by field name or display name
        const bomValue = bomFieldMapping[fieldName] || bomFieldMapping[displayName];
        
        if (bomValue !== undefined && bomValue !== null && bomValue !== '') {
          newInputs[fieldName] = typeof bomValue === 'number' ? bomValue : parseFloat(bomValue) || 0;
        }
      });

    setCalculatorInputs(newInputs);
  };

  // Auto-populate when calculator or BOM data changes
  useEffect(() => {
    if (selectedCalculator && bomItemData) {
      autoPopulateFromBOM();
    }
  }, [selectedCalculator?.id, bomItemData?.id, calculatorTarget]);

  // Also auto-populate when dialog opens with calculator already selected
  useEffect(() => {
    if (open && selectedCalculatorId && bomItemData) {
      // Small delay to ensure calculator data is loaded
      setTimeout(autoPopulateFromBOM, 100);
    }
  }, [open, selectedCalculatorId, bomItemData?.id]);

  // Handle viewing lookup table
  const handleViewLookupTable = async (field: any) => {
    setSelectedLookupField(field);

    try {
      const { processesApi } = await import('@/lib/api/processes');

      // Case 1: sourceField is set — fetch by table ID directly
      if (field.sourceField) {
        let tableId = field.sourceField;
        if (field.sourceField.startsWith('from_')) {
          tableId = field.sourceField.replace('from_', '');
        }

        const table = await processesApi.getReferenceTable(tableId);
        if (table) {
          const processedRows = table.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          setLookupTableData({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: table.tableName,
            tableId: table.id,
            column_definitions: table.columnDefinitions || [],
            rows: processedRows,
          });
          setShowLookupTable(true);
          return;
        }
      }

      // Case 2: No sourceField — find reference table by matching field label against
      // all reference tables belonging to the calculator's associated process.
      // The already-loaded selectedCalculator object often carries associatedProcessId.
      const processId: string | undefined =
        (selectedCalculator as any)?.associatedProcessId ||
        (selectedCalculator as any)?.processId;

      if (processId) {
        const tables = await processesApi.getReferenceTables(processId);
        // Enhanced matching for various field types
        const fieldLabel = (field.displayLabel || field.fieldName || '').toLowerCase();
        const fieldName = (field.fieldName || '').toLowerCase();

        let matched = tables.find((t: any) => {
          const tableName = (t.tableName || '').toLowerCase();

          // Direct matches
          if (tableName.includes(fieldLabel) || fieldLabel.includes(tableName)) return true;
          if (tableName.includes(fieldName) || fieldName.includes(tableName)) return true;

          // Special cases for common field types
          if (fieldName.includes('viscosity') && tableName.includes('viscosity')) return true;
          if (fieldName.includes('gross') && tableName.includes('weight')) return true;
          if (fieldName.includes('usage') && tableName.includes('weight')) return true;
          if (fieldName.includes('density') && tableName.includes('density')) return true;

          return false;
        });

        // Fallback to first table if no specific match and only one table exists
        if (!matched && tables.length === 1) {
          matched = tables[0];
        }

        if (matched) {
          const processedRows = matched.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          setLookupTableData({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: matched.tableName,
            tableId: matched.id,
            column_definitions: matched.columnDefinitions || [],
            rows: processedRows,
          });
          setShowLookupTable(true);
          return;
        }
      }


    } catch (error) {
    }
  };

  // Reset calculator when closed
  useEffect(() => {
    if (!calculatorOpen) {
      setSelectedCalculatorId('');
      setCalculatorInputs({});
      setCalculatorResults(null);
      setCalculatorTarget(null);
    }
  }, [calculatorOpen]);

  // Control page scroll when calculator is open
  useEffect(() => {
    if (calculatorOpen) {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
    
    return () => {
      document.body.classList.remove('overflow-hidden');
    };
  }, [calculatorOpen]);

  // Load edit data (wait for data to be loaded before populating)
  useEffect(() => {
    if (!open) { setEditDataApplied(false); setReSelectMode(false); return; }

    if (editData && open && !isLoadingHierarchy && !isLoadingMHR && !isLoadingLHR) {
      setEditDataApplied(true);
      setOpNbr(editData.opNbr || 0);
      setLocation(editData.location || defaultLocation || '');
      setSelectedGroup(editData.processGroup || '');
      setSelectedRoute(editData.processRoute || '');
      setSelectedOperation(editData.operation || '');
      setSelectedProcessCalculatorId(editData.processCalculatorId || '');
      
      // Use the actual field names from the process data
      const mhrId = editData.mhrId || editData.machineId || '';
      const lhrId = editData.lhrId ? String(editData.lhrId) : (editData.laborId ? String(editData.laborId) : '');
      
      setSelectedMHRId(mhrId);
      setSelectedLHRId(lhrId);
      
      setSetupManning(editData.setupManning || 1);
      setSetupTime(editData.setupTime || 0);
      setBatchSize(editData.batchSize || 1);
      setHeads(editData.heads || 1);
      setCycleTime(editData.cycleTime || 0);
      setPartsPerCycle(editData.partsPerCycle || 1);
      setScrap(editData.scrap || 0);
      setMachineValue(editData.machineValue || 0);
      setManualMhrRate(editData.machineRate || '');
      setManualLhrRate(editData.laborRate  || '');
      setFacilityId(editData.facilityId);
      setFacilityRateId(editData.facilityRateId);
    } else if (!editData && open) {
      setEditDataApplied(false);
      // Reset for new entry - suggest next operation number but user can change it
      setOpNbr(getSuggestedOpNbr()); // Suggest next operation number but user can enter any number
      setLocation(defaultLocation ?? '');
      setSelectedGroup('');
      setSelectedRoute('');
      setSelectedOperation('');
      setSelectedProcessCalculatorId('');
      setSelectedMHRId('');
      setSelectedLHRId('');
      setSetupManning('');
      setSetupTime('');
      setBatchSize('');
      setHeads('');
      setCycleTime('');
      setPartsPerCycle('');
      setScrap('');
      setMachineValue('');
      setManualMhrRate('');
      setManualLhrRate('');
      setFacilityId(undefined);
      setFacilityRateId(undefined);
      setUserOverrodeMHR(false);
      setUserOverrodeLHR(false);
      setReSelectMode(false);
    }
  }, [editData, open, isLoadingHierarchy, isLoadingMHR, isLoadingLHR, mhrData, lhrData, existingProcesses]);

  // Effective rates: dropdown selection → manual input → editData stored fallback
  const effectiveMachineRate = selectedMHR
    ? selectedMHR.calculations.totalMachineHourRate
    : (typeof manualMhrRate === 'number' && manualMhrRate > 0 ? manualMhrRate : (Number(editData?.machineRate) || 0));
  // For benchmark records lhr is already in USD (= lhrUsdEffective). For user records
  // lhrUsdEffective is the correct USD value; fall back to lhr when it is missing.
  const effectiveLaborRate = selectedLHR
    ? (Number((selectedLHR as any).lhrUsdEffective) || Number((selectedLHR as any).lhr) || 0)
    : (typeof manualLhrRate === 'number' && manualLhrRate > 0 ? manualLhrRate : (Number(editData?.laborRate) || 0));

  // Derived — no extra re-render per keystroke
  const totalCost = useMemo(() => {
    const cycleTimeNum     = parseFloat(cycleTime     as string) || 0;
    const batchSizeNum     = parseFloat(batchSize     as string) || 0;
    const partsPerCycleNum = parseFloat(partsPerCycle as string) || 0;
    const setupManningNum  = parseFloat(setupManning  as string) || 0;
    const setupTimeNum     = parseFloat(setupTime     as string) || 0;
    const headsNum         = parseFloat(heads         as string) || 0;
    const scrapNum         = parseFloat(scrap         as string) || 0;

    if (cycleTimeNum <= 0 || batchSizeNum <= 0 || partsPerCycleNum <= 0) return 0;

    const setupCostPerPart = ((setupTimeNum / 60) * (effectiveMachineRate + effectiveLaborRate * setupManningNum)) / Math.max(batchSizeNum, 1);
    const cycleTimeHours   = cycleTimeNum / 3600;
    const cycleCostPerPart = (cycleTimeHours * (effectiveMachineRate + effectiveLaborRate * headsNum)) / partsPerCycleNum;
    const baseCost         = setupCostPerPart + cycleCostPerPart;
    return Math.max(0, baseCost * (1 + scrapNum / 100));
  }, [effectiveMachineRate, effectiveLaborRate, setupManning, setupTime, batchSize, heads, cycleTime, partsPerCycle, scrap]);

  // Benchmark LHR/MHR records use synthetic IDs (e.g. "bm-USA-Sheet Metal") that are not
  // UUIDs. The backend DTO validates @IsUUID() when the field is non-empty, so we must strip
  // non-UUID IDs before submitting. The actual rates (machineRate/laborRate) are already
  // included in the payload, so the row stays correct — it just won't have an FK reference.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const toUUID = (id: string) => (id && UUID_RE.test(id) ? id : undefined);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cycleTimeNum = parseFloat(cycleTime as string) || 0;
    const batchSizeNum = parseFloat(batchSize as string) || 0;

    if (cycleTimeNum <= 0) {
      alert('Please enter a valid Cycle Time (greater than 0)');
      return;
    }
    if (batchSizeNum <= 0) {
      alert('Please enter a valid Batch Size (greater than 0)');
      return;
    }


    onSubmit({
      id: editData?.id,
      opNbr,
      location,
      group: selectedGroup,
      processRoute: selectedRoute,
      operation: selectedOperation,
      processCalculatorId: selectedProcessCalculatorId,
      mhrId: toUUID(selectedMHRId),
      lhrId: toUUID(selectedLHRId),
      machineName: selectedMHR?.machineName || '',
      operationName: selectedOperation || '',
      processRouteName: selectedRoute || '',
      machineRate: effectiveMachineRate,
      laborRate: effectiveLaborRate,
      setupManning: parseFloat(setupManning as string) || 0,
      setupTime: parseFloat(setupTime as string) || 0,
      batchSize: parseFloat(batchSize as string) || 0,
      heads: parseFloat(heads as string) || 0,
      cycleTime: parseFloat(cycleTime as string) || 0,
      partsPerCycle: parseFloat(partsPerCycle as string) || 0,
      scrap: parseFloat(scrap as string) || 0,
      machineValue: parseFloat(machineValue as string) || 0,
      totalCost,
      facilityId,
      facilityRateId,
    });

    onOpenChange(false);
  };

  return (
    <>
      <Dialog 
        open={open} 
        modal={false}
        onOpenChange={(openState) => {
          // Prevent closing if calculator is open
          if (!openState && calculatorOpen) {
            return;
          }
          onOpenChange(openState);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-primary">
              {editData ? 'Edit Process Cost' : 'Create Process Cost'}
            </DialogTitle>
            <DialogDescription>
              Configure process parameters, select resources, and calculate costs
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(90vh-120px)] overflow-y-auto">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
              {/* Op Nbr */}
              <div className="space-y-2">
                <Label>Op Nbr <span className="text-muted-foreground text-xs">(Enter any number - table will sort by sequence)</span></Label>
                <Input
                  type="number"
                  step="1"
                  value={opNbr}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOpNbr(val === '' ? 0 : parseInt(val) || 0);
                  }}
                  placeholder="Enter operation number (e.g. 5, 10, 20, 100)"
                />
              </div>

              {/* Error State */}
              {hasErrors && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-destructive font-semibold mb-2">Error loading data</p>
                  <p className="text-sm text-muted-foreground">
                    Please check your connection and try again
                  </p>
                </div>
              )}

              {/* Loading State */}
              {!hasErrors && (isLoadingMHR || isLoadingLHR || isLoadingHierarchy || isLoadingCalculators) && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Loading data...</span>
                </div>
              )}

              {!hasErrors && !isLoadingMHR && !isLoadingLHR && !isLoadingHierarchy && !isLoadingCalculators && (
                <>
                  {/* HIERARCHICAL SECTION */}
                  <Card className="border-primary/50 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-md">Process Selection (Hierarchical)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* When editing a record with saved hierarchy values that don't exist in
                          calculator mappings, show them as read-only text to avoid confusing
                          "no routes" errors. The user can clear all three to re-pick. */}
                      {/* Loading state — editData present but effect hasn't fired yet */}
                      {editData && !editDataApplied && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading process data…
                        </div>
                      )}

                      {/* In edit mode, always show saved values as read-only text once loaded.
                          Never try to match the saved route against the hierarchy — that causes
                          false-positives when the DB has legacy underscore routes. The engineer
                          must explicitly click "Re-select" to swap to the picker. */}
                      {editData && editDataApplied && !reSelectMode && (selectedGroup || selectedRoute || selectedOperation) && (
                        <div className="rounded-md bg-muted/60 border p-3 space-y-2">
                          <p className="text-xs text-muted-foreground font-medium">Saved process</p>
                          {selectedGroup && <div className="text-sm"><span className="text-muted-foreground">Group: </span><span className="font-medium">{selectedGroup}</span></div>}
                          {selectedRoute && <div className="text-sm"><span className="text-muted-foreground">Route: </span><span className="font-medium">{selectedRoute}</span></div>}
                          {selectedOperation && <div className="text-sm"><span className="text-muted-foreground">Operation: </span><span className="font-medium">{selectedOperation}</span></div>}
                          <button
                            type="button"
                            className="text-xs text-primary underline"
                            onClick={() => {
                              // Keep selectedGroup so the Route dropdown is immediately usable
                              setSelectedRoute('');
                              setSelectedOperation('');
                              setSelectedProcessCalculatorId('');
                              setReSelectMode(true);
                            }}
                          >
                            Re-select from hierarchy
                          </button>
                        </div>
                      )}

                      {/* Full pickers: always for new entry; after Re-select (reSelectMode); or if all cleared */}
                      {(!editData || reSelectMode || (!selectedGroup && !selectedRoute && !selectedOperation)) && (
                        <>
                      {/* 1. Group Selection */}
                      <div className="space-y-2">
                        <Label className="font-semibold">1. Group</Label>
                        <Select
                          value={selectedGroup}
                          onValueChange={(value) => {
                            setSelectedGroup(value);
                            setSelectedRoute('');
                            setSelectedOperation('');
                            setSelectedProcessCalculatorId('');
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select process group" />
                          </SelectTrigger>
                          <SelectContent>
                            {processGroups.length > 0 ? (
                              processGroups.map((group) => (
                                <SelectItem key={group} value={group}>
                                  {group}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem key="no-groups" value="none" disabled>
                                No groups available
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* 2. Process Route Selection */}
                      <div className="space-y-2">
                        <Label className="font-semibold">
                          2. Process Route
                          {!selectedGroup && <span className="text-muted-foreground text-xs ml-2">(Select Group first)</span>}
                        </Label>
                        <Select
                          value={selectedRoute}
                          onValueChange={(value) => {
                            setSelectedRoute(value);
                            setSelectedOperation('');
                            setSelectedProcessCalculatorId('');
                          }}
                          disabled={!selectedGroup}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select process route" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLoadingHierarchy ? (
                              <SelectItem key="loading" value="loading" disabled>
                                Loading routes...
                              </SelectItem>
                            ) : processRoutes.length > 0 ? (
                              processRoutes.map((route: string) => (
                                <SelectItem key={route} value={route}>
                                  {route}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem key="no-routes" value="none" disabled>
                                No process routes for {selectedGroup}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {hierarchyError && (
                          <p className="text-xs text-red-600 dark:text-red-400">
                            Error loading hierarchy: {(hierarchyError as Error).message || 'Unknown error'}
                          </p>
                        )}
                        {selectedGroup && !isLoadingHierarchy && !hierarchyError && processRoutes.length === 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-500">
                            No routes found for "{selectedGroup}". Create process calculator mappings first.
                          </p>
                        )}
                      </div>

                      {/* 3. Operations Selection */}
                      <div className="space-y-2">
                        <Label className="font-semibold">
                          3. Operations
                          {!selectedRoute && <span className="text-muted-foreground text-xs ml-2">(Select Process Route first)</span>}
                        </Label>
                        <Select
                          value={selectedOperation}
                          onValueChange={(value) => {
                            setSelectedOperation(value);
                            setSelectedProcessCalculatorId('');
                          }}
                          disabled={!selectedRoute}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select operation" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLoadingHierarchy ? (
                              <SelectItem key="loading" value="loading" disabled>
                                Loading operations...
                              </SelectItem>
                            ) : operations.length > 0 ? (
                              operations.map((op: string) => (
                                <SelectItem key={op} value={op}>
                                  {op}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem key="no-operations" value="none" disabled>
                                No operations available
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {hierarchyError && (
                          <p className="text-xs text-red-600 dark:text-red-400">
                            Error loading operations: {(hierarchyError as Error).message || 'Unknown error'}
                          </p>
                        )}
                        {selectedRoute && !isLoadingHierarchy && !hierarchyError && operations.length === 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-500">
                            No operations found for "{selectedRoute}". Create process calculator mappings first.
                          </p>
                        )}
                      </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* RESOURCES SECTION */}
                  <Card className="border-secondary/50">
                    <CardHeader>
                      <CardTitle className="text-md">Resources & Location</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Location Filter */}
                      <div className="space-y-2">
                        <Label>Location <span className="text-muted-foreground text-xs">(Optional)</span></Label>
                        <Select
                          value={location || '__all__'}
                          onValueChange={(v) => {
                            setLocation(v === '__all__' ? '' : v);
                            setSelectedMHRId('');
                            setSelectedLHRId('');
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="All locations" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">🌍 All locations</SelectItem>
                            <SelectItem value="India">🇮🇳 India</SelectItem>
                            <SelectItem value="USA">🇺🇸 USA</SelectItem>
                            <SelectItem value="China">🇨🇳 China</SelectItem>
                            <SelectItem value="Germany">🇩🇪 Germany</SelectItem>
                            <SelectItem value="France">🇫🇷 France</SelectItem>
                            <SelectItem value="W. Europe">🇪🇺 W. Europe</SelectItem>
                            <SelectItem value="E. Europe">🇪🇺 E. Europe</SelectItem>
                            <SelectItem value="UK">🇬🇧 UK</SelectItem>
                            <SelectItem value="Vietnam">🇻🇳 Vietnam</SelectItem>
                            <SelectItem value="Mexico">🇲🇽 Mexico</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Machine Value */}
                      <div className="space-y-2">
                        <Label>Machine Value</Label>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={machineValue}
                            onChange={(e) => {
                              setMachineValue(e.target.value);
                            }}
                            placeholder="Enter machine value"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              setCalculatorTarget('machineValue');
                              setCalculatorOpen(true);
                            }}
                            title="Use Calculator"
                          >
                            <CalculatorIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Machine (MHR) Selection */}
                      <div className="space-y-2">
                        <Label>Machine</Label>
                        {filteredMHR.length > 0 ? (
                          <>
                          <Select value={selectedMHRId} onValueChange={(v) => { setSelectedMHRId(v); setUserOverrodeMHR(true); }}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select machine" />
                            </SelectTrigger>
                            <SelectContent>
                              {filteredMHR.map((mhr: any) => (
                                <SelectItem key={mhr.id} value={String(mhr.id)}>
                                  {mhr.machineName} - ${mhr.calculations.totalMachineHourRate.toFixed(2)}/hr
                                  {mhr.location ? ` (${mhr.location})` : ''}
                                  {mhr.isBenchmark ? ' ★' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {filteredMHR.some((r: any) => r.isBenchmark) && (
                            <p className="text-xs text-muted-foreground">
                              ★ Benchmark rates — add custom rates in HR Rates to override
                            </p>
                          )}
                          </>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">$/hr</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={manualMhrRate}
                                onChange={(e) => setManualMhrRate(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                                placeholder="Enter machine rate ($/hr)"
                                className="flex-1"
                              />
                            </div>
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              No MHR records{location ? ` for ${location}` : ''}. Enter rate manually or add in HR Rates.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Labour (LHR) Selection */}
                      <div className="space-y-2">
                        <Label>Labour Type</Label>
                        {filteredLHR.length > 0 ? (
                          <>
                            <Select value={selectedLHRId} onValueChange={(v) => { setSelectedLHRId(v); setUserOverrodeLHR(true); }}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select labour type" />
                              </SelectTrigger>
                              <SelectContent>
                                {filteredLHR.map((lhrRecord: any) => {
                                  const pg = lhrRecord.processGroup;
                                  const lt = lhrRecord.labourType;
                                  // Only append process group when it adds info (avoids "Sheet Metal Operator — Sheet Metal")
                                  const showPg = pg && pg !== lt && !lt?.includes(pg);
                                  const rate = Number(lhrRecord.lhrUsdEffective || lhrRecord.lhr).toFixed(2);
                                  return (
                                    <SelectItem key={String(lhrRecord.id)} value={String(lhrRecord.id)}>
                                      {lt}{showPg ? ` — ${pg}` : ''} — ${rate}/hr
                                      {lhrRecord.location ? ` (${lhrRecord.location})` : ''}
                                      {lhrRecord.isBenchmark ? ' ★' : ''}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {filteredLHR.some((r: any) => r.isBenchmark) && (
                              <p className="text-xs text-muted-foreground">
                                ★ Benchmark rates — add custom rates in HR Rates to override
                              </p>
                            )}
                          </>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">$/hr</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={manualLhrRate}
                                onChange={(e) => setManualLhrRate(e.target.value === '' ? '' : parseFloat(e.target.value) || 0)}
                                placeholder="Enter labour rate ($/hr)"
                                className="flex-1"
                              />
                            </div>
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              No LHR records{location ? ` for ${location}` : ''}. Enter rate manually or add in HR Rates.
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              {/* Rate Information — always shows effective rates being used for calculation */}
              <Card className="bg-secondary/20">
                <CardHeader>
                  <CardTitle className="text-sm">Active Rates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {/* Machine */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Machine (MHR)</span>
                    {effectiveMachineRate > 0 ? (
                      <>
                        <span className="font-semibold">
                          {selectedMHR
                            ? selectedMHR.machineName
                            : editData?.machineName
                              ? editData.machineName
                              : manualMhrRate
                                ? 'Manual entry'
                                : 'Stored (AI route)'}
                          {selectedMHR?.location
                            ? ` · ${selectedMHR.location}`
                            : editData?.location
                              ? ` · ${editData.location}`
                              : location
                                ? ` · ${location}`
                                : ''}
                        </span>
                        <span className="text-primary font-bold">${effectiveMachineRate.toFixed(2)}/hr</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">Not set</span>
                    )}
                  </div>
                  {/* Labour */}
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Labour (LHR)</span>
                    {effectiveLaborRate > 0 ? (
                      <>
                        <span className="font-semibold">
                          {selectedLHR
                            ? (() => {
                                const lt = (selectedLHR as any).labourType;
                                const pg = (selectedLHR as any).processGroup;
                                const showPg = pg && pg !== lt && !lt?.includes(pg);
                                return `${lt}${showPg ? ` — ${pg}` : ''}`;
                              })()
                            : editData?.processGroup
                              ? editData.processGroup
                              : manualLhrRate
                                ? 'Manual entry'
                                : 'Stored (AI route)'}
                          {selectedLHR
                            ? ((selectedLHR as any).location ? ` · ${(selectedLHR as any).location}` : '')
                            : editData?.location
                              ? ` · ${editData.location}`
                              : location
                                ? ` · ${location}`
                                : ''}
                          {(selectedLHR as any)?.isBenchmark ? ' ★' : ''}
                        </span>
                        <span className="text-primary font-bold">${effectiveLaborRate.toFixed(2)}/hr</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">Not set</span>
                    )}
                  </div>
                </CardContent>
              </Card>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Setup Manning</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={setupManning}
                        onChange={(e) => {
                          setSetupManning(e.target.value);
                        }}
                        placeholder="Enter setup manning"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Setup Time (mins)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={setupTime}
                        onChange={(e) => {
                          setSetupTime(e.target.value);
                        }}
                        placeholder="Enter setup time"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Batch Size</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={batchSize}
                        onChange={(e) => {
                          setBatchSize(e.target.value);
                        }}
                        placeholder="Enter batch size"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Heads</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={heads}
                        onChange={(e) => {
                          setHeads(e.target.value);
                        }}
                        placeholder="Enter number of heads"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Cycle Time (secs)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={cycleTime}
                          onChange={(e) => {
                            setCycleTime(e.target.value);
                          }}
                          placeholder="Enter cycle time"
                          required
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            setCalculatorTarget('cycleTime');
                            setCalculatorOpen(true);
                          }}
                          title="Use Calculator"
                        >
                          <CalculatorIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Parts/Cycle</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="1"
                        value={partsPerCycle}
                        onChange={(e) => {
                          setPartsPerCycle(e.target.value);
                        }}
                        placeholder="Enter parts per cycle"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Scrap %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={scrap}
                      onChange={(e) => {
                        setScrap(e.target.value);
                      }}
                      placeholder="Enter scrap percentage"
                    />
                  </div>

              {/* Total Cost Display */}
              <Card className="bg-primary/10 border border-primary/20">
                <CardContent className="pt-6">
                  <Label className="block mb-2">Total Cost</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary">{currencySymbol}{totalCost.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={Number(cycleTime) <= 0 || Number(batchSize) <= 0}
                >
                  {editData ? 'Update Process' : 'Add Process'}
                </Button>
              </DialogFooter>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Calculator Side Panel */}
      <Sheet open={calculatorOpen} onOpenChange={(open) => {
        // Prevent calculator from closing if lookup table is open
        if (!open && showLookupTable) {
          return;
        }
        
        if (!open) {
          // When closing calculator, also close lookup table
          setShowLookupTable(false);
          setSelectedLookupField(null);
          setLookupTableData(null);
        }
        
        setCalculatorOpen(open);
      }} modal={false}>
        <SheetContent side="right" className="w-[600px] sm:w-[700px]" style={{ overflowY: 'auto' }}>
          <SheetHeader>
            <SheetTitle>Calculator - {calculatorTarget}</SheetTitle>
            <SheetDescription>
              Use calculator to compute values for {calculatorTarget}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Calculator Selector */}
            <div className="space-y-2">
              <Label>Select Calculator</Label>
              <Select value={selectedCalculatorId} onValueChange={setSelectedCalculatorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a calculator" />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingCalculators ? (
                    <SelectItem key="loading" value="__loading__" disabled>
                      Loading calculators...
                    </SelectItem>
                  ) : calculatorsError ? (
                    <SelectItem key="error" value="__error__" disabled>
                      Error loading calculators
                    </SelectItem>
                  ) : calculatorsData?.calculators && calculatorsData.calculators.length > 0 ? (
                    calculatorsData.calculators.map((calc: any) => (
                      <SelectItem key={calc.id} value={calc.id}>
                        {calc.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem key="no-calc" value="__none__" disabled>
                      No calculators available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {calculatorTarget === 'processCalculator' && availableCalculators && availableCalculators.length === 0 && (
                <p className="text-xs text-amber-600">
                  No calculators are mapped to the selected operation. You can still use general calculators.
                </p>
              )}
              {calculatorTarget === 'processCalculator' && selectedCalculatorId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedProcessCalculatorId(selectedCalculatorId);
                    setCalculatorOpen(false);
                    setCalculatorResults(null);
                    setCalculatorInputs({});
                    setCalculatorTarget(null);
                  }}
                  className="w-full"
                >
                  Use This Calculator
                </Button>
              )}
            </div>

            {/* Auto-populate from BOM button */}
            {bomItemData && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline" 
                  onClick={autoPopulateFromBOM}
                  className="w-full"
                  disabled={!selectedCalculator}
                >
                  Auto-fill from BOM Data
                </Button>
                {!selectedCalculator && (
                  <p className="text-xs text-muted-foreground text-center">
                    Select a calculator above to enable auto-fill
                  </p>
                )}
              </div>
            )}

            {/* Calculator Inputs */}
            {selectedCalculator && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Input Values</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedCalculator.fields
                      ?.filter((field: any) => field.fieldType !== 'calculated')
                      .map((field: any) => {
                        // Only show eye button for fields that have actual lookup tables configured
                        const isLookupTableField = 
                          // Only show for explicitly configured database lookup fields
                          (field.fieldType === 'database_lookup' && field.dataSource === 'processes') ||
                          // Only show for fields with sourceField starting with 'from_' (linked to reference tables)
                          (field.sourceField && field.sourceField.startsWith('from_'));





                        return (
                          <div key={field.id} className="space-y-2">
                            <Label htmlFor={field.fieldName}>
                              {field.displayLabel || field.fieldName}
                              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
                            </Label>

                            {isLookupTableField ? (
                              // Input field WITH eye icon for lookup table fields
                              <div className="flex gap-2">
                                <Input
                                  id={field.fieldName}
                                  type="number"
                                  step="0.01"
                                  value={calculatorInputs[field.fieldName] || ''}
                                  onChange={(e) =>
                                    setCalculatorInputs({
                                      ...calculatorInputs,
                                      [field.fieldName]: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                                  className="flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewLookupTable(field)}
                                  className="px-3"
                                  title="View reference table"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              // Regular input field only
                              <Input
                                id={field.fieldName}
                                type="number"
                                step="0.01"
                                value={calculatorInputs[field.fieldName] || ''}
                                onChange={(e) =>
                                  setCalculatorInputs({
                                    ...calculatorInputs,
                                    [field.fieldName]: parseFloat(e.target.value) || 0,
                                  })
                                }
                                placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                              />
                            )}
                          </div>
                        );
                      })}

                    <Button
                      onClick={handleExecuteCalculator}
                      disabled={executeCalculator.isPending}
                      className="w-full"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {executeCalculator.isPending ? 'Calculating...' : 'Calculate'}
                    </Button>
                  </CardContent>
                </Card>

                {/* Calculator Results */}
                {calculatorResults && (
                  <Card className="border-primary">
                    <CardHeader>
                      <CardTitle className="text-lg">Results</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedCalculator.fields
                        ?.filter((field: any) => field.fieldType === 'calculated')
                        .map((field: any) => {
                          const result = calculatorResults[field.fieldName];
                          const value = result?.value !== undefined ? result.value : result;

                          return (
                            <div
                              key={field.id}
                              className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg"
                            >
                              <div>
                                <div className="font-medium">{field.displayName || field.fieldName}</div>
                                {field.unit && (
                                  <div className="text-xs text-muted-foreground">{field.unit}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-lg font-bold text-primary">
                                  {typeof value === 'number' ? value.toFixed(4) : value || 'N/A'}
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCalculatorValue(value)}
                                  disabled={typeof value !== 'number' && typeof value !== 'string'}
                                >
                                  Use
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Lookup Table Panel */}
      {showLookupTable && lookupTableData && (() => {
        return (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 bg-black/20 z-[59]" 
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.nativeEvent?.stopImmediatePropagation?.();
                setShowLookupTable(false);
                setSelectedLookupField(null);
                setLookupTableData(null);
              }}
            />
            
            {/* Lookup Table */}
            <div
              className="fixed top-0 left-0 h-screen w-[500px] bg-background border-r border-border shadow-xl z-[60] flex flex-col"
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
          <div className="flex items-center justify-between p-3 border-b border-border bg-background">
            <div>
              <h3 className="font-semibold text-sm">Reference Table</h3>
              <p className="text-xs text-muted-foreground">{lookupTableData.tableName}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                e.nativeEvent?.stopImmediatePropagation?.();
                setShowLookupTable(false);
                setSelectedLookupField(null);
                setLookupTableData(null);
              }}
              className="h-6 w-6 p-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18"></path>
                <path d="m6 6 12 12"></path>
              </svg>
            </Button>
          </div>

          {/* Hint */}
          <div className="px-3 py-1.5 bg-primary/5 border-b border-border text-xs text-muted-foreground flex items-center gap-1.5">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            Click any row to use that value for <strong className="text-foreground mx-0.5">{lookupTableData.fieldLabel}</strong>. Highlighted column = selected value.
          </div>

          <div
            className="flex-1 p-3 relative overflow-auto"
            style={{
              height: 'calc(100vh - 120px)',
              pointerEvents: 'auto',
              zIndex: 10000
            }}
            onClick={(e) => e.stopPropagation()}
            onScroll={(e) => e.stopPropagation()}
          >
            <div className="w-full">
              <table className="w-full border-collapse text-sm bg-background">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="border border-border text-center text-xs font-medium py-1 px-1 text-muted-foreground w-6">
                      #
                    </th>
                    {lookupTableData.column_definitions.map((col: any, colIdx: number) => {
                      const isOutputCol = colIdx === lookupTableData.column_definitions.length - 1;
                      return (
                        <th
                          key={col.name}
                          className={`border border-border text-left text-xs font-semibold py-1 px-2 ${isOutputCol ? 'text-primary bg-primary/10' : 'text-foreground'
                            }`}
                        >
                          {col.label}
                          {isOutputCol && <span className="ml-1 text-primary/60">(↵ select)</span>}
                          {col.unit && (
                            <span className="text-primary/70 ml-1">({col.unit})</span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {lookupTableData.rows.map((row: any, rowIndex: number) => {
                    const outputCol = lookupTableData.column_definitions[lookupTableData.column_definitions.length - 1];
                    const getVal = (col: any) => {
                      const camel = col.name.replace(/_([a-z])/g, (_: string, l: string) => l.toUpperCase());
                      return row[col.name] !== undefined ? row[col.name] : row[camel];
                    };
                    const outputValue = outputCol ? getVal(outputCol) : undefined;
                    return (
                      <tr
                        key={rowIndex}
                        className="hover:bg-primary/10 cursor-pointer transition-colors"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          e.nativeEvent?.stopImmediatePropagation?.();
                          
                          if (selectedLookupField && outputValue !== undefined) {
                            setCalculatorInputs((prev: Record<string, any>) => ({
                              ...prev,
                              [selectedLookupField.fieldName]: typeof outputValue === "number"
                                ? outputValue
                                : parseFloat(outputValue) || outputValue,
                            }));
                          }
                          
                          // Use setTimeout to ensure state updates don't conflict
                          setTimeout(() => {
                            // Close ONLY lookup table after selection
                            setShowLookupTable(false);
                            setSelectedLookupField(null);
                            setLookupTableData(null);
                          }, 0);
                          
                          return false;
                        }}
                        title={outputCol ? `Click to use: ${outputCol.label} = ${outputValue}` : `Click to select`}
                      >
                        <td className="border border-border text-center text-xs py-1 px-1 text-muted-foreground font-mono bg-muted/20">
                          {rowIndex + 1}
                        </td>
                        {lookupTableData.column_definitions.map((col: any) => {
                          const value = getVal(col);
                          const isOutput = col.name === outputCol?.name;
                          return (
                            <td
                              key={col.name}
                              className={`border border-border py-1 px-2 text-xs${isOutput ? ' font-semibold text-primary bg-primary/5' : ''}`}
                            >
                              {value !== undefined && value !== null ? String(value) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        </>
        );
      })()}
    </>
  );
}
