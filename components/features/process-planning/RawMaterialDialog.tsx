'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useRawMaterials, useRawMaterialFilterOptions, useMaterialAliases, type RawMaterial } from '@/lib/api/hooks/useRawMaterials';
import { useCostSummary, type CalculationTraceStep, type ConfidenceLevel } from '@/lib/api/hooks/useBOMItems';
import { CalculationTracePanel } from './CalculationTracePanel';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useCalculators, useCalculator, useExecuteCalculator } from '@/lib/api/hooks/useCalculators';
import { useExchangeRates } from '@/lib/api/hooks/useExchangeRates';
import { Loader2, Calculator as CalculatorIcon, Play, Eye } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// Static lookup — defined outside component so it is never recreated on re-render
const CALCULATOR_PROPERTY_MAPPINGS: Record<string, string> = {
  meltingTempCelsius: 'meltingTempC',
  densityKgM3: 'densityKgM3',
  costPerKg: 'cost',
  costPerUnit: 'unitCost',
  utsMpa: 'ultimateTensileStrength',
  ytsMpa: 'yieldTensileStrength',
  thermalConductivityWMK: 'thermalConductivityMelt',
  specificHeatJGK: 'specificHeatMelt',
  moldTempCelsiusMin: 'moldTempC',
  moldTempCelsiusMax: 'moldTempC',
  ejectDeflectionTempCelsius: 'ejectDeflectionTempC',
  material: 'material',
  materialGrade: 'materialGrade',
  materialGroup: 'materialGroup',
  materialType: 'materialType',
  materialDescription: 'materialDescription',
  application: 'application',
  density: 'densityKgM3',
  ultimateTensileStrength: 'ultimateTensileStrength',
  yieldTensileStrength: 'yieldTensileStrength',
  shearingStrength: 'shearingStrength',
  meltingTempC: 'meltingTempC',
  moldTempC: 'moldTempC',
  ejectDeflectionTempC: 'ejectDeflectionTempC',
  thermalConductivityMelt: 'thermalConductivityMelt',
  specificHeatMelt: 'specificHeatMelt',
  clampingPressureMpa: 'clampingPressureMpa',
  regrindingPercentage: 'regrindingPercentage',
  regrinding: 'regrinding',
  cost: 'cost',
  unitCost: 'unitCost',
  currency: 'currency',
  location: 'location',
  country: 'country',
  shape: 'shape',
  astmStandard: 'astmStandard',
  dinStandard: 'dinStandard',
  enStandard: 'enStandard',
  jisStandard: 'jisStandard',
};

// Resolves a material's price for the given pricing location to USD, mirroring
// getRegionalRate's own per-country column selection (India->costIndia,
// USA->costUsa, ...) then pivoting through INR to USD via live exchange
// rates. This used to be copy-pasted separately into the live preview memo
// and the "new material" submit handler -- and was MISSING entirely from the
// "edit material" submit handler, which instead checked selectedMaterial?.
// unitCost / ?.cost (neither of which exists for a material priced only via
// a regional column, e.g. AL6101's cost_usa/cost_india/cost_china with no
// generic cost/unitCost column) and silently fell back to 0. Confirmed live:
// editing an already-saved AL6101 line kept re-persisting $0 forever even
// though the dialog's own preview showed a real nonzero cost. One shared
// resolver now backs the preview AND both submit paths, so this can't
// silently drift out of sync a second time.
//
// `costSummaryFx` is this item's own live cost-summary toUsdRate/
// usdToDisplayRate (same object autoAddMaterialCost in page.tsx reads to
// compute nativeToUsd = toUsdRate/usdToDisplayRate for the record it
// persists) -- ONLY valid when the price being resolved is for the SAME
// country as the active Digital Factory, since it's native-factory-currency
// ->USD, not a generic cross-currency rate. When it's on file for that case,
// it MUST be preferred over the Budget exchange_rates table below: this
// item's scenario can have a pinned FX snapshot (Currency & Ask Price
// widget, rateType 'reference'/'custom') that intentionally overrides the
// live Budget rate for reproducibility -- see resolveDisplayCurrency's own
// doc comment. Confirmed live: editing SECC (India, scenario pinned to a
// 'reference' snapshot) recomputed $0.014/kg from the live Budget table here
// while the persisted record (created via autoAddMaterialCost, which DOES
// go through the scenario's pinned rate) held $0.012/kg -- same material,
// same country, two different numbers depending on which code path priced
// it. Falling back to the Budget table only when costSummaryFx isn't
// available yet (still loading) or the priced country differs from the
// active factory (cost-summary's rate doesn't apply cross-currency) keeps
// this resolver from ever guessing while staying consistent with whatever
// this item is actually priced against everywhere else.
function resolveRegionalUnitCostUsd(
  material: RawMaterial | null | undefined,
  countryStr: string,
  rates: Record<string, number>,
  costSummaryFx?: { toUsdRate?: number | undefined; usdToDisplayRate?: number | undefined; factoryCountry?: string | undefined } | null,
): number {
  if (!material) return 0;
  const cl = (countryStr || '').toLowerCase();
  let localAmount = 0;
  let localCurrency = 'USD';

  if (cl.includes('india')) { localAmount = material.costIndia ?? 0; localCurrency = 'INR'; }
  else if (cl.includes('usa') || cl.includes('united states')) { localAmount = material.costUsa ?? 0; localCurrency = 'USD'; }
  else if (cl.includes('germany')) { localAmount = material.costGermany ?? 0; localCurrency = 'EUR'; }
  else if (cl.includes('france')) { localAmount = material.costFrance ?? 0; localCurrency = 'EUR'; }
  else if (cl.includes('w. europe') || cl.includes('western europe')) { localAmount = material.costWEurope ?? 0; localCurrency = 'EUR'; }
  else if (cl.includes('e. europe') || cl.includes('eastern europe')) { localAmount = material.costEEurope ?? 0; localCurrency = 'EUR'; }
  else if (cl.includes('china')) { localAmount = material.costChina ?? 0; localCurrency = 'CNY'; }
  else { localAmount = (material as any).unitCost || (material as any).cost || (material as any).costPerUnit || (material as any).price || 0; localCurrency = (material as any).currency || 'USD'; }

  if (!localAmount) {
    if (material.costIndia) { localAmount = material.costIndia; localCurrency = 'INR'; }
    else { localAmount = (material as any).unitCost || (material as any).cost || 0; localCurrency = (material as any).currency || 'USD'; }
  }
  if (!localAmount) return 0;

  const pricedActiveFactory = !costSummaryFx?.factoryCountry
    || costSummaryFx.factoryCountry.toLowerCase() === cl;
  if (pricedActiveFactory && costSummaryFx?.toUsdRate && costSummaryFx?.usdToDisplayRate) {
    return localAmount * (costSummaryFx.toUsdRate / costSummaryFx.usdToDisplayRate);
  }

  // Never guess a missing FX leg (localCurrency->INR or USD->INR) as 1 —
  // that silently mispriced any material whose regional currency wasn't yet
  // loaded from the live exchange_rates table. 0 here reads the same as "no
  // price on file", which callers already handle honestly.
  const toInr = rates[localCurrency];
  const usdToInr = rates['USD'];
  if (!toInr || !usdToInr) return 0;
  return (localAmount * toInr) / usdToInr;
}

// Substitutes every {Field Name} token in a calculator_fields.default_value
// formula string with the actual value that produced this result -- the
// real DB formula (documentation-only once physics_key drives the value,
// but genuinely the same formula the backend function implements, verified
// field-by-field), never a re-derived or approximated caption. Prose-only
// default_value strings (e.g. "evaluated across every viable standard
// sheet...") have no {tokens} to replace and pass through unchanged.
function formatFormulaWithValues(
  formula: string | null | undefined,
  results: Record<string, any>,
  inputs: Record<string, any>,
): string | null {
  if (!formula) return null;
  return formula.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const raw = results[name] !== undefined ? results[name] : inputs[name];
    const val = raw?.value !== undefined ? raw.value : raw;
    if (typeof val === 'number') {
      const fixed = val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      return fixed || '0';
    }
    if (typeof val === 'string' && val !== '') return val;
    return `{${name}}`; // unresolved — keep the token visible rather than silently dropping it
  });
}

interface RawMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  estimateId?: string;
  editData?: any;
  bomItemData?: any;
  location?: string; // pre-selects pricing region (India / USA / Germany …)
  batchSize?: number; // order quantity — drives nesting sheetsRequired disclosure
}

export function RawMaterialDialog({
  open,
  onOpenChange,
  onSubmit,
  editData,
  bomItemData,
  location,
  batchSize,
}: RawMaterialDialogProps) {
  // Real nesting result for this BOM item, if one exists — the single source
  // of truth for sheet-metal Gross Usage (see sheet-metal-nesting.engine.ts).
  // Gated on `open` so the always-mounted dialog doesn't fire this on every
  // parent render. `partsPerSheet` presence (not just blankSpec existing) is
  // the reliable "did nesting run at all" signal — it's only ever set in the
  // backend's `if (smNestingResult)` branch, never the volume-fallback one.
  const nestingItemId = open ? (bomItemData?.id as string | undefined) : undefined;
  const { data: nestingCostSummary } = useCostSummary(nestingItemId, batchSize ?? 1, location);
  const nestingBlankSpec = nestingCostSummary?.blankSpec;
  const hasRealNesting = nestingBlankSpec?.form === 'sheet' && typeof nestingBlankSpec.partsPerSheet === 'number';
  // "Nesting ran" is not the same as "nesting is trustworthy": when the true
  // unfolded flat-pattern rectangle couldn't be resolved, the engine falls
  // back to packing the part's FOLDED 3D bounding box instead (disclosed via
  // nestingDimensionConfidence: 'fallback') — for a bent part that box is
  // much smaller than the real flat blank, so parts/sheet is systematically
  // OVERCOUNTED (confirmed live: 3640 parts/sheet, 94.5% util on a fallback
  // result — physically implausible). Only a 'verified' result (packed
  // against the real CAD-derived flat pattern) is trustworthy enough to lock
  // Gross Usage to. A fallback result is still disclosed to the user (see
  // JSX below) but must NOT silently drive a read-only field.
  const nestingIsTrustworthy = hasRealNesting && nestingBlankSpec.nestingDimensionConfidence === 'verified';
  // True whenever this BOM item is sheet metal at all (flat-pattern area,
  // thickness, and density all resolved server-side) -- set on BOTH backend
  // blankSpec branches (real nesting result AND its own volumetric-fallback
  // branch), so this is true even when nesting itself didn't run. For any
  // sheet-metal item, the net÷(1−scrap%) formula must NEVER auto-populate
  // Gross Usage -- that formula is a guess, and guessing is exactly what
  // this whole fix exists to stop doing for sheet metal. When nesting isn't
  // trustworthy, Gross Usage requires real manual entry instead (see JSX):
  // no computed number, honest empty/gap state. Non-sheet-metal material
  // records (round bar, billet, casting, ...) are untouched by this rule --
  // out of scope for the nesting engine, so the pre-existing manual formula
  // remains their only costing path.
  const isSheetMetalItem = nestingBlankSpec?.form === 'sheet';
  const [materialGroup, setMaterialGroup] = useState<string>('');
  const [country, setCountry] = useState<string>('');
  const [selectedQuarter, setSelectedQuarter] = useState<string>('q1');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('');
  const [grossUsage, setGrossUsage] = useState<number | ''>('');
  const [netUsage, setNetUsage] = useState<number | ''>('');
  const [scrap, setScrap] = useState<number | ''>('');
  const [overhead, setOverhead] = useState<number | ''>('');
  const [manualUnitCost, setManualUnitCost] = useState<number>(0);
  // Digital Factory's own live scenario currency + FX — reuses nestingCostSummary
  // (already fetched above for the same location/batchSize), never a hardcoded
  // '$'/USD table. manualUnitCost itself is always stored in USD internally
  // (matches resolveRegionalUnitCostUsd's convention, which every downstream
  // consumer — submit payload, preview calc — already assumes); only the
  // FIELD the engineer types into is shown/edited in the real display
  // currency, converted both ways through usdToDisplay.
  const displaySymbol = nestingCostSummary?.currencySymbol;
  const usdToDisplay = nestingCostSummary?.usdToDisplayRate;
  const hasDisplayCurrency = !!displaySymbol && usdToDisplay != null;
  const [reclaimRate, setReclaimRate] = useState<number | ''>(0);
  // true when netUsage was auto-derived from CAD volume × material density
  const [cadFilled, setCadFilled] = useState(false);

  // Calculator state
  const [calculatorOpen, setCalculatorOpen] = useState<boolean>(false);
  const [calculatorTarget, setCalculatorTarget] = useState<'grossUsage' | 'netUsage' | null>(null);
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<string>('');
  const [calculatorInputs, setCalculatorInputs] = useState<Record<string, any>>({});
  const [calculatorResults, setCalculatorResults] = useState<Record<string, any> | null>(null);
  const [calculatorWarnings, setCalculatorWarnings] = useState<string[]>([]);

  // Gross Usage manual-override state. `grossUsageOverridden` starts false
  // every time the dialog opens (the calculator-computed value is always
  // trusted first) and flips true only when the user explicitly applies an
  // override with a reason -- at which point the auto-sync effect below
  // must stop overwriting it on every nesting refetch. Persisted (Apply
  // Override writes these into the raw-material-cost record) so the "⚠
  // Manual Override" state survives a reopen, not just this session.
  const [grossUsageOverridden, setGrossUsageOverridden] = useState(false);
  const [grossUsageOverrideReason, setGrossUsageOverrideReason] = useState('');
  const [grossUsageEditOpen, setGrossUsageEditOpen] = useState(false);
  const [grossUsageEditDraft, setGrossUsageEditDraft] = useState('');
  const [grossUsageEditReasonDraft, setGrossUsageEditReasonDraft] = useState('');

  // Lookup table state
  const [selectedLookupField, setSelectedLookupField] = useState<any>(null);
  const [showLookupTable, setShowLookupTable] = useState<boolean>(false);
  const [lookupTableData, setLookupTableData] = useState<any>(null);

  // Fetch calculators
  const { data: calculatorsData } = useCalculators();
  const { data: selectedCalculator } = useCalculator(selectedCalculatorId, { enabled: !!selectedCalculatorId });
  const executeCalculator = useExecuteCalculator();

  // The two global (user_id NULL, is_public) sheet-metal material-usage
  // calculators seeded by migrations 057/058 -- looked up by name, never a
  // hardcoded UUID (same "no hardcoded identity" discipline as the seed
  // migrations themselves). Absent until those migrations are applied on
  // this DB, in which case the calculator icon falls back to the generic
  // any-calculator picker exactly as it always has.
  const grossUsageCalculator = calculatorsData?.calculators?.find(
    (c: any) => c.name === 'Sheet Metal - Gross Material Usage (Nesting)',
  );
  const netUsageCalculator = calculatorsData?.calculators?.find(
    (c: any) => c.name === 'Sheet Metal - Net Material Usage',
  );

  // Explicit, honest auto-population for the two sheet-metal usage
  // calculators -- deliberately separate from autoPopulateFromBOM below
  // (which maps calculator fields to bomItemData properties by name/label
  // heuristics). Only sets a field when this dialog genuinely has the real
  // value in scope. bomItemData.sheetThicknessMm and .flatPatternAreaMm2 are
  // real, stored CAD-analysis fields (backend/src/modules/bom-items/dto/
  // bom-item-response.dto.ts) -- not derived/estimated here. Shear Strength
  // comes straight from the selected material's own shearingStrength
  // property (lib/api/hooks/useRawMaterials.ts).
  const autoPopulateUsageCalculatorInputs = (target: 'grossUsage' | 'netUsage') => {
    const materialLabel = selectedMaterial ? (selectedMaterial.materialGrade || selectedMaterial.material || '') : '';
    const thicknessMm = bomItemData?.sheetThicknessMm;
    if (target === 'netUsage') {
      setCalculatorInputs((prev) => ({
        ...prev,
        ...(materialLabel && { 'Material': materialLabel }),
        ...(bomItemData?.flatPatternAreaMm2 != null && bomItemData.flatPatternAreaMm2 > 0 && { 'Flat Pattern Area': bomItemData.flatPatternAreaMm2 }),
        ...(typeof thicknessMm === 'number' && thicknessMm > 0 && { 'Thickness': thicknessMm }),
        ...(matDensityKgM3 != null && { 'Material Density': matDensityKgM3 }),
      }));
    } else {
      setCalculatorInputs((prev) => ({
        ...prev,
        ...(materialLabel && { 'Material': materialLabel }),
        ...(typeof thicknessMm === 'number' && thicknessMm > 0 && { 'Thickness': thicknessMm }),
        ...(selectedMaterial?.shearingStrength != null && selectedMaterial.shearingStrength > 0 && { 'Shear Strength': selectedMaterial.shearingStrength }),
        ...(matDensityKgM3 != null && { 'Material Density': matDensityKgM3 }),
        ...(typeof netUsage === 'number' && netUsage > 0 && { 'Net Weight Per Part': netUsage }),
        'Edge Allowance': 2,
        ...(typeof batchSize === 'number' && batchSize > 0 && { 'Batch Quantity': batchSize }),
      }));
    }
  };

  // Exchange rates for currency conversion (USD/EUR/GBP → INR)
  const { data: exchangeRates } = useExchangeRates();

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

  // Handle calculator value selection
  const handleUseCalculatorValue = (value: number) => {
    if (calculatorTarget === 'grossUsage') {
      setGrossUsage(value);
    } else if (calculatorTarget === 'netUsage') {
      setNetUsage(value);
    }
    // Close calculator when "Use" button is clicked
    setCalculatorOpen(false);
    setCalculatorResults(null);
    setCalculatorWarnings([]);
    setCalculatorInputs({});
    setSelectedCalculatorId('');
  };

  // Handle calculator execution
  const handleExecuteCalculator = async () => {
    if (!selectedCalculatorId) return;

    try {
      const result = await executeCalculator.mutateAsync({
        calculatorId: selectedCalculatorId,
        inputValues: calculatorInputs,
        ...(bomItemData?.id && { itemId: bomItemData.id }),
      });

      if (result.success) {
        setCalculatorResults(result.results);
        setCalculatorWarnings(result.warnings ?? []);
      }
    } catch (error) {
    }
  };

  // Handle viewing lookup table
  const handleViewLookupTable = async (field: any) => {
    setSelectedLookupField(field);

    try {
      // Case 1: Raw Materials database lookup
      if (field.dataSource === 'raw_materials') {
        const { apiClient } = await import('@/lib/api/client');
        
        try {
          // Use enhanced materials endpoint to get all material data
          const categoryParam = field.materialCategory === 'PLASTIC_RUBBER' ? 'PLASTIC' : 
                               field.materialCategory === 'FERROUS_NON_FERROUS' ? 'FERROUS' :
                               'FERROUS'; // Default to ferrous
          
          const response = await apiClient.get('/raw-materials/enhanced', { 
            params: { 
              limit: 500,
              category: categoryParam
            } 
          });
          
          if (response?.items) {
            // Transform raw materials data into lookup table format
            const fieldPropertyMap: Record<string, string> = {
              'meltingTempCelsius': 'Melting Temp (°C)',
              'densityKgM3': 'Density (kg/m³)',
              'costPerKg': 'Cost per kg ($)',
              'costPerUnit': 'Cost per unit ($)',
              'utsMpa': 'UTS (MPa)',
              'ytsMpa': 'YTS (MPa)',
              'shearingStrength': 'Shear Strength (MPa)',
              'thermalConductivityWMK': 'Thermal Conductivity (W/mK)',
              'specificHeatJGK': 'Specific Heat (J/gK)',
              'moldTempCelsiusMin': 'Min Mold Temp (°C)',
              'moldTempCelsiusMax': 'Max Mold Temp (°C)',
            };

            // Create column definitions based on available properties
            const columns = [
              { name: 'materialName', key: 'materialName', label: 'Material Name', dataType: 'text' },
              { name: 'materialGrade', key: 'materialGrade', label: 'Grade', dataType: 'text' },
              { name: 'categoryName', key: 'categoryName', label: 'Category', dataType: 'text' }
            ];

            // Add the specific property column being looked up
            if (field.sourceProperty && fieldPropertyMap[field.sourceProperty]) {
              columns.push({
                name: field.sourceProperty,
                key: field.sourceProperty,
                label: fieldPropertyMap[field.sourceProperty] || field.sourceProperty,
                dataType: 'number'
              });
            }

            // Transform materials into rows
            const materialItems: Array<Record<string, unknown>> = response.items;
            const rows = materialItems
              .filter((material) => {
                // Filter by property availability
                if (field.sourceProperty) {
                  const v = material[field.sourceProperty];
                  return v != null && Number(v) > 0;
                }
                return true;
              })
              .map((material) => ({
                materialName: material.materialName || '',
                materialGrade: material.materialGrade || '',
                categoryName: material.categoryName || '',
                [field.sourceProperty]: material[field.sourceProperty] || 0
              }));

            const tableData = {
              fieldName: field.fieldName,
              fieldLabel: field.displayLabel || field.fieldName,
              tableName: `Raw Materials - ${fieldPropertyMap[field.sourceProperty] || field.sourceProperty}`,
              tableId: 'raw_materials_' + field.sourceProperty,
              column_definitions: columns,
              rows: rows,
            };
            
            setLookupTableData(tableData);
            setShowLookupTable(true);
            return;
          }
        } catch (error) {
          console.error('Failed to fetch raw materials data:', error);
          // Fall through to existing process table logic
        }
      }

      // Case 2: Process reference tables (existing logic)
      const { processesApi } = await import('@/lib/api/processes');

      // sourceField is set — fetch by table ID directly
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
          const tableData = {
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: table.tableName,
            tableId: table.id,
            column_definitions: table.columnDefinitions || [],
            rows: processedRows,
          };
          setLookupTableData(tableData);
          setShowLookupTable(true);
          return;
        }
      }

      // Case 2: Find reference table by matching field label
      const processId: string | undefined =
        (selectedCalculator as any)?.associatedProcessId ||
        (selectedCalculator as any)?.processId;

      if (processId) {
        const tables = await processesApi.getReferenceTables(processId);
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
      // Don't auto-close lookup table - let user control it independently
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

  // Fetch raw materials from API
  const { data: rawMaterialsData, isLoading } = useRawMaterials();
  const { data: filterOptions, isLoading: isLoadingOptions } = useRawMaterialFilterOptions();
  // Regional/shorthand designations (e.g. "AL6101" for "Generic Aluminum, ANSI
  // 6101") that don't appear in a material's own name -- without these, typing
  // the CAD-detected grade into the material search can't find its own row.
  const { data: materialAliases } = useMaterialAliases();
  const aliasesByMaterialId = useMemo(() => {
    const map = new Map<string, string[]>();
    (materialAliases ?? []).forEach((a) => {
      const list = map.get(a.rawMaterialId) ?? [];
      list.push(a.aliasNormalized);
      map.set(a.rawMaterialId, list);
    });
    return map;
  }, [materialAliases]);
  // Reverse of the above: alias -> the one real row it resolves to. Used to
  // re-find a saved line's material when it was stored under a shorthand
  // grade (e.g. "AL6101") that has no direct field match on its own row.
  const materialIdByAliasNormalized = useMemo(() => {
    const map = new Map<string, string>();
    (materialAliases ?? []).forEach((a) => map.set(a.aliasNormalized, a.rawMaterialId));
    return map;
  }, [materialAliases]);

  // Debug logging

  // Get unique material groups
  const materialGroups = useMemo(() => {
    return filterOptions?.materialGroups || [];
  }, [filterOptions]);

  // Get materials filtered by selected group only.
  // Pricing location (country) only affects which cost column is shown — it does NOT filter the list.
  const materials = useMemo(() => {
    if (!rawMaterialsData?.items || !materialGroup) return [];
    return rawMaterialsData.items.filter(m => m.materialGroup === materialGroup);
  }, [rawMaterialsData, materialGroup]);

  // Get selected material details
  const selectedMaterial = useMemo(() => {
    if (!selectedMaterialId || !materials.length) return null;
    return materials.find(m => m.id === selectedMaterialId);
  }, [selectedMaterialId, materials]);

  const usageCalculatorInputProvenance: Record<string, string> = {
    'Material': 'Selected material',
    'Flat Pattern Area': 'CAD flat-pattern geometry (bom_items.flat_pattern_area_mm2)',
    'Thickness': 'Effective sheet thickness (bom_items.sheet_thickness_mm)',
    'Shear Strength': `raw_materials lookup${selectedMaterial ? ` — ${selectedMaterial.materialGrade || selectedMaterial.material}` : ''} (shearingStrength)`,
    'Material Density': `raw_materials lookup${selectedMaterial ? ` — ${selectedMaterial.materialGrade || selectedMaterial.material}` : ''} (densityKgM3)`,
    'Net Weight Per Part': 'Net Usage calculator result',
    'Edge Allowance': 'Sheet-metal nesting configuration',
    'Batch Quantity': 'Order/batch quantity',
    'Flat Pattern Outline': 'Resolved server-side from CAD wire-walk extraction — not user-enterable',
  };

  // Combobox options -- alias keywords let a search for "AL6101" (or any other
  // regional/shorthand designation from material_aliases) find its real row
  // even though that text never appears in the row's own displayed label.
  const materialOptions: ComboboxOption[] = useMemo(() => materials.map((material) => ({
    value: material.id,
    label: `${material.material}${material.materialType ? ` (${material.materialType})` : ''}${material.country ? ` - ${material.country}` : ''}`,
    keywords: [
      material.material,
      material.materialGrade ?? '',
      ...(aliasesByMaterialId.get(material.id) ?? []),
    ].filter(Boolean),
  })), [materials, aliasesByMaterialId]);

  // ── Smart Fill ──────────────────────────────────────────────────────────────
  // Derives net usage directly from CAD volume × material density without going
  // through the DB-driven calculator template system.
  const cadVolumeMm3   = bomItemData?.volume         ?? null;
  const matDensityKgM3 = selectedMaterial?.densityKgM3 ?? null;
  const smartFillAvailable = cadVolumeMm3 != null && cadVolumeMm3 > 0 && matDensityKgM3 != null && matDensityKgM3 > 0;

  const handleSmartFill = () => {
    if (!cadVolumeMm3 || !matDensityKgM3) return;
    // mass_kg = volume_mm³ × density_kg/m³ / 1,000,000,000
    const net = parseFloat(((cadVolumeMm3 * matDensityKgM3) / 1e9).toFixed(6));
    setNetUsage(net);
    setCadFilled(true);
  };

  // Auto-trigger Smart Fill when material is selected for the first time on a new
  // entry and the user has not manually typed a net usage yet.
  useEffect(() => {
    if (!editData && open && smartFillAvailable && !cadFilled && (netUsage === 0 || netUsage === '')) {
      handleSmartFill();
    }
    // Only on material selection or dialog open — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialId, open]);

  // Finds a material by name OR grade (grade match covers auto-created records where
  // materialName = "IS2062 E250 CRCA" but DB has material.material = "CRCA Steel").
  const findMaterialByEditData = (pool: RawMaterial[] | null | undefined, ed: any) => {
    if (!pool || !ed) return undefined;
    const direct = pool.find(m =>
      m.material === ed.materialName ||
      (m as any).materialName === ed.materialName ||
      m.materialGrade === ed.materialName ||
      m.id === ed.materialId,
    );
    if (direct) return direct;
    // Alias fallback: a saved line's materialName can be a shorthand/regional
    // grade (e.g. "AL6101") that has no substring/field match anywhere on its
    // real row ("Generic Aluminum, ANSI 6101") -- same root cause as the
    // backend costing resolver's alias gap (bom-items.service.ts), just for
    // this dialog's own re-lookup when reopening a saved line.
    const normalized = String(ed.materialName ?? '').toUpperCase().replace(/[\s-]/g, '');
    const aliasedId = normalized ? materialIdByAliasNormalized.get(normalized) : undefined;
    return aliasedId ? pool.find(m => m.id === aliasedId) : undefined;
  };

  // Load edit data first (wait for data to be loaded AND options to be available)
  useEffect(() => {
    if (editData && open && !isLoading && !isLoadingOptions && materialGroups.length > 0) {
      const allMaterials = rawMaterialsData?.items || [];
      const materialToUse = findMaterialByEditData(allMaterials, editData);

      if (materialToUse) {
        setMaterialGroup(materialToUse.materialGroup || '');
        // Digital Factory (location prop) always wins — same rule as
        // ProcessCostDialog's location field: reopening a material saved
        // under a stale country (or a raw_materials catalog row whose own
        // metadata `country` has nothing to do with THIS item's costing
        // location) must never silently re-price against the wrong country.
        // Confirmed live: a SECC record kept pricing against 'USA' after the
        // Digital Factory was set to India, because materialToUse.country
        // ('USA', catalog metadata) outranked the current location here.
        setCountry(location || editData.country || (materialToUse as any).country || '');
      } else {
        setMaterialGroup(editData.materialGroup || '');
        setCountry(location || editData.country || '');
        setSelectedMaterialId('');
      }

      setScrap(editData.scrap ?? 0);
      setOverhead(editData.overhead ?? 0);
      setManualUnitCost(editData.unitCost || 0);
      setSelectedQuarter(editData.quarter || 'q1');

      // Seed net/gross from CAD weight when the auto-created record has zero usage.
      // Gross Usage itself is no longer seeded here with a guessed scrap% divide —
      // when a real nesting result exists, the dedicated effect below is the sole
      // writer of grossUsage; when it doesn't, savedGross (or 0) is kept as-is and
      // the user enters it manually.
      const savedNet = Number(editData.netUsage ?? 0);
      const savedGross = Number(editData.grossUsage ?? 0);
      const cadWeight = Number(bomItemData?.weight ?? 0);
      if (!savedNet && cadWeight > 0) {
        const net = parseFloat(cadWeight.toFixed(6));
        setNetUsage(net);
        setCadFilled(true);
      } else {
        setNetUsage(savedNet);
      }
      setGrossUsage(savedGross);
    } else if (!editData && open) {
      // Reset for new entry — pre-select pricing location from parent context
      setMaterialGroup('');
      setCountry(location || '');
      setSelectedQuarter('q1');
      setSelectedMaterialId('');
      setGrossUsage(0);
      setNetUsage(0);
      setScrap(0);
      setOverhead(0);
      setManualUnitCost(0);
      setReclaimRate(0);
      setCadFilled(false);
    }
  }, [editData, open, isLoading, isLoadingOptions, materialGroups, rawMaterialsData]);

  // Set selected material ID after material group filter is applied (separate effect for edit mode)
  useEffect(() => {
    if (editData && open && !isLoading && !isLoadingOptions && materials.length > 0 && materialGroup) {
      const materialToUse = findMaterialByEditData(materials, editData);
      setSelectedMaterialId(materialToUse?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, materials, materialGroup]);

  // Reset material selection when material group changes (pricing location change does not reset)
  useEffect(() => {
    if (!editData) {
      setSelectedMaterialId('');
    }
  }, [materialGroup, editData]);

  // ── Live cost preview ────────────────────────────────────────────────────
  const { previewCost, previewBreakdown } = useMemo(() => {
    const zero = { previewCost: 0, previewBreakdown: null as null | Record<string, number> };
    if (!((selectedMaterial || editData) && (Number(grossUsage) > 0 || (netUsage as number) > 0))) return zero;
    // No fabricated FX table while the real exchange_rates fetch is in
    // flight — an empty map makes resolveRegionalUnitCostUsd honestly return
    // 0 (falls through to manualUnitCost below) instead of pricing against a
    // guessed rate.
    const rates = exchangeRates ?? {};
    const unitCostUsd = resolveRegionalUnitCostUsd(selectedMaterial, country, rates, {
      toUsdRate: nestingCostSummary?.toUsdRate,
      usdToDisplayRate: nestingCostSummary?.usdToDisplayRate,
      factoryCountry: location,
    });

    const finalUnitCost = unitCostUsd || manualUnitCost || 0;
    if (!finalUnitCost) return zero;

    const net        = typeof netUsage  === 'number' ? netUsage  : 0;
    const scrapPct   = typeof scrap     === 'number' ? scrap     : 0;
    const overheadPct = typeof overhead  === 'number' ? overhead  : 0;
    const reclaimPct  = typeof reclaimRate === 'number' ? reclaimRate : 0;

    // gross: from the real nesting engine ONLY when its result is trustworthy
    // (packed against the verified true flat-pattern rectangle, not the
    // folded-3D-bbox fallback — see nestingIsTrustworthy's doc comment).
    // For sheet-metal items without a trustworthy result, NEVER compute a
    // guessed number — use only what the user actually typed into Gross
    // Usage. The net÷(1−scrap%) formula remains solely for genuinely
    // non-sheet-metal material records (out of scope for the nesting fix).
    const gross = nestingIsTrustworthy
      ? nestingBlankSpec.grossWeightKg
      : isSheetMetalItem
        ? (typeof grossUsage === 'number' ? grossUsage : 0)
        : (net > 0
          ? net / Math.max(1 - scrapPct / 100, 0.001)
          : (typeof grossUsage === 'number' ? grossUsage : 0));

    const grossMaterialCost = gross * finalUnitCost;
    const scrapAmount       = gross - net;
    // reclaimRate must not exceed unitCost — same rule the backend validates
    const reclaimRateInvalid = reclaimPct > finalUnitCost;
    // clamp so preview never goes negative even on bad input
    const reclaimValue    = Math.min(scrapAmount * reclaimPct, grossMaterialCost);
    const netMaterialCost = grossMaterialCost - reclaimValue;
    // no scrapAdjustment — scrap% is already encoded in the gross/net ratio
    const overheadCost    = netMaterialCost * (overheadPct / 100);
    const totalCostVal    = Math.max(0, netMaterialCost + overheadCost);

    const utilRate   = gross > 0 ? (net / gross) * 100 : 0;
    const effPerUnit = net   > 0 ? totalCostVal / net   : 0;

    return {
      previewCost: totalCostVal,
      previewBreakdown: { gross, grossMaterialCost, scrapAmount, reclaimValue, netMaterialCost, scrapAdjustment: 0, subtotal: netMaterialCost, overheadCost, totalCostVal, utilRate, effPerUnit, reclaimRateInvalid: reclaimRateInvalid ? 1 : 0 },
    };
  }, [selectedMaterial, manualUnitCost, grossUsage, netUsage, scrap, overhead, reclaimRate, editData, country, exchangeRates, nestingIsTrustworthy, isSheetMetalItem, nestingBlankSpec, nestingCostSummary, location]);

  const totalCost = previewCost;

  // Auto-derive Gross Usage from Net Usage + Scrap % for display — ONLY for
  // genuinely non-sheet-metal material records. Sheet-metal items must never
  // get an auto-computed Gross Usage from this formula, trustworthy nesting
  // or not — see isSheetMetalItem's doc comment. When trustworthy nesting
  // exists, the dedicated effect below is the sole writer of grossUsage.
  useEffect(() => {
    if (isSheetMetalItem) return;
    const net = typeof netUsage === 'number' ? netUsage : 0;
    if (net > 0) {
      const s = typeof scrap === 'number' ? Math.min(scrap, 99.9) : 0;
      setGrossUsage(parseFloat((net / Math.max(1 - s / 100, 0.001)).toFixed(4)));
    }
  }, [netUsage, scrap, isSheetMetalItem]);

  // Gross Usage from the real nesting engine's theoretical per-part yield —
  // the sole writer of grossUsage whenever a TRUSTWORTHY nesting result
  // exists (verified true flat pattern, not the folded-bbox fallback),
  // regardless of new entry / edit-with-zero-usage / edit-with-stale-saved-
  // value. Always wins over any manually-entered or previously-saved figure,
  // since a manual override would silently diverge from the real cut plan --
  // UNLESS the user has explicitly applied an override via the "Justify
  // Gross Usage" panel (grossUsageOverridden), in which case their entry is
  // the whole point and must not be silently clobbered on the next refetch.
  useEffect(() => {
    if (nestingIsTrustworthy && !grossUsageOverridden) {
      setGrossUsage(nestingBlankSpec.grossWeightKg);
    }
  }, [nestingIsTrustworthy, nestingBlankSpec, grossUsageOverridden]);

  // Real, server-built audit trail for Gross Usage -- once
  // "Sheet Metal - Gross Material Usage (Nesting)" calculator's mapping is
  // resolvable (see bom-items.service.ts's resolvePhysicsQuantity), blankSpec
  // carries the SAME calculationTrace/confidence/calculatorId shape as any
  // Laser/Bend process line, sourced from the real true-shape nest -- no
  // client-side approximation needed anymore.
  const grossUsageTrace: CalculationTraceStep[] = nestingBlankSpec?.calculationTrace ?? [];
  const grossUsageConfidence: ConfidenceLevel | undefined = nestingBlankSpec?.confidence;

  // Auto-populate calculator fields when material is selected
  useEffect(() => {
    if (!selectedMaterial || !selectedCalculator) return;
    const updatedInputs = { ...calculatorInputs };
    let hasUpdates = false;

    const rawMaterialFields = selectedCalculator.fields?.filter((field: any) =>
      field.fieldType === 'database_lookup' &&
      field.dataSource === 'raw_materials' &&
      (field.sourceProperty || field.sourceField),
    );

    rawMaterialFields?.forEach((field: any) => {
      const sourceProperty   = field.sourceProperty || field.sourceField;
      const actualPropertyName = CALCULATOR_PROPERTY_MAPPINGS[sourceProperty] || sourceProperty;
      const propertyValue    = (selectedMaterial as unknown as Record<string, unknown>)[actualPropertyName];
      if (propertyValue !== undefined && propertyValue !== null && Number(propertyValue) > 0) {
        updatedInputs[field.fieldName] = propertyValue;
        hasUpdates = true;
      }
    });

    if (hasUpdates) setCalculatorInputs(updatedInputs);
  }, [selectedMaterial, selectedCalculator]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // For editing, we can submit even if selectedMaterial is not loaded yet
    if (editData) {
      // Use editData information if selectedMaterial is not available
      const materialInfo = selectedMaterial || {
        id: editData.materialId,
        material: editData.material,
        materialGroup: editData.materialGroup,
        materialType: editData.materialType || '',
        materialDescription: editData.materialDescription || '',
        country: editData.country || '',
        unitCost: editData.unitCost || 0,
      };

      onSubmit({
        id: editData.id,
        materialId: selectedMaterialId || editData.materialId,
        materialName: materialInfo.material,
        materialGroup: materialInfo.materialGroup,
        material: materialInfo.material,
        materialType: materialInfo.materialType || '',
        materialDescription: materialInfo.materialDescription || '',
        // Same fix as unitCost below — the persisted `country` must reflect
        // the price actually used (this dialog's own live `country` state,
        // tracking the Digital Factory), never the catalog row's unrelated
        // metadata. Otherwise the raw material record's own staleness check
        // (autoAddMaterialCost's staleAgainstLocation) would keep comparing
        // against the wrong stored country too.
        country: country || materialInfo.country || '',
        quarter: selectedQuarter,
        // Freshly-resolved live price first -- editData.unitCost is whatever
        // was last SAVED, often stale $0 from before this material's regional
        // cost column existed. Preferring it here (as this used to) meant
        // every edit just re-persisted the old $0 forever, even once the
        // live preview above was already showing the real resolved cost.
        //
        // `country` (this dialog's own live state -- defaults to, and tracks,
        // the current Digital Factory; see the load-edit-data effect above)
        // must always win over materialInfo.country -- when selectedMaterial
        // has loaded, materialInfo IS selectedMaterial, and .country there is
        // just the raw_materials catalog row's own metadata (e.g. wherever
        // this SECC entry happened to be tagged from), completely unrelated
        // to which Digital Factory the part is actually being costed under.
        // Checking it first silently re-priced an India-scenario edit against
        // China (or whatever the catalog tag was) even though the dialog's
        // own price matrix was showing India, ₹1.14/kg, selected the whole time.
        unitCost: resolveRegionalUnitCostUsd(selectedMaterial, country || materialInfo.country, exchangeRates ?? {}, {
          toUsdRate: nestingCostSummary?.toUsdRate,
          usdToDisplayRate: nestingCostSummary?.usdToDisplayRate,
          factoryCountry: location,
        })
          || manualUnitCost
          || editData.unitCost
          || 0,
        grossUsage,
        netUsage,
        scrap,
        overhead,
        reclaimRate: Number(reclaimRate) || 0,
        totalCost,
        grossUsageIsOverridden: grossUsageOverridden,
        ...(grossUsageOverridden && { grossUsageOverrideReason }),
      });
    } else {
      // For new material, require selectedMaterial
      if (!materialGroup) {
        return;
      }
      if (!selectedMaterialId || !selectedMaterial) {
        return;
      }
      if (Number(grossUsage) <= 0) {
        return;
      }
      
      // Get unit cost in USD for the selected country (mirrors getRegionalRate + INR pivot)
      const rates = exchangeRates ?? {};
      const materialUnitCost = resolveRegionalUnitCostUsd(selectedMaterial, country, rates, {
        toUsdRate: nestingCostSummary?.toUsdRate,
        usdToDisplayRate: nestingCostSummary?.usdToDisplayRate,
        factoryCountry: location,
      });

      if (!materialUnitCost && !manualUnitCost) {
        alert(
          exchangeRates
            ? 'Please enter a unit cost. The selected material has no cost data available.'
            : 'Exchange rates are still loading — please wait a moment and try again.',
        );
        return;
      }
      
      // Additional validation for total cost
      if (totalCost <= 0) {
        console.error('Total cost validation failed:', {
          totalCost,
          finalUnitCost: materialUnitCost || manualUnitCost,
          grossUsage,
          scrap,
          overhead
        });
        alert('Total cost calculation failed. Please check your inputs and try again.');
        return;
      }
      const finalUnitCost = materialUnitCost || manualUnitCost || 0;

      onSubmit({
        materialId: selectedMaterialId,
        materialName: selectedMaterial.material,
        materialGroup: selectedMaterial.materialGroup,
        material: selectedMaterial.material,
        materialType: selectedMaterial.materialType || '',
        materialDescription: selectedMaterial.materialDescription || '',
        country: country || selectedMaterial.country || '',
        quarter: selectedQuarter,
        unitCost: finalUnitCost,
        grossUsage,
        netUsage,
        scrap,
        overhead,
        reclaimRate: Number(reclaimRate) || 0,
        totalCost,
        grossUsageIsOverridden: grossUsageOverridden,
        ...(grossUsageOverridden && { grossUsageOverrideReason }),
      });
    }

    // Reset form
    setMaterialGroup('');
    setCountry(location || '');
    setSelectedQuarter('q1');
    setSelectedMaterialId('');
    setGrossUsage(0);
    setNetUsage(0);
    setScrap(0);
    setOverhead(0);
    setManualUnitCost(0);
    setReclaimRate(0);
    setCadFilled(false);
    onOpenChange(false);
  };

  return (
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {editData ? 'Edit Material Cost' : 'Create Material Cost'}
          </DialogTitle>
          <DialogDescription>
            Select raw materials and calculate costs with weight and scrap factors
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(90vh-120px)] overflow-y-auto">
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
            {/* Loading State */}
            {(isLoading || isLoadingOptions) && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading materials...</span>
              </div>
            )}

            {!isLoading && !isLoadingOptions && (
              <>
                {/* Info Banner - Show when no data available */}
                {materialGroups.length === 0 && (
                  <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex gap-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                            No Raw Materials Available
                          </h4>
                          <p className="text-xs text-blue-700 dark:text-blue-300">
                            There are no raw materials in your database yet. Please add raw materials by uploading an Excel file or creating them manually in the Raw Materials management page.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Filters Row */}
                <div className="space-y-2">
                  {/* Material Group */}
                  <label className="text-sm font-semibold">Material Group</label>
                  <Select value={materialGroup} onValueChange={setMaterialGroup}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select material group" />
                    </SelectTrigger>
                    <SelectContent>
                      {materialGroups.length > 0 ? (
                        materialGroups.map((group) => (
                          <SelectItem key={group} value={group}>
                            {group}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem key="no-groups" value="none" disabled>
                          No material groups available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {/* Pricing location is now chosen from the "Price data available
                      for this material" matrix below (click a location to use its
                      price) once a material is selected -- this standalone dropdown
                      duplicated that and could disagree with it, so it's removed. */}
                </div>

                {/* Material Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold">
                    Material
                    {!materialGroup && (
                      <span className="ml-2 text-xs text-muted-foreground font-normal">
                        (Select material group first)
                      </span>
                    )}
                  </label>
                  <Combobox
                    options={materialOptions}
                    value={selectedMaterialId}
                    onValueChange={setSelectedMaterialId}
                    disabled={!materialGroup}
                    placeholder={materialGroup ? "Select material" : "Select material group first"}
                    searchPlaceholder="Search by name or grade (e.g. AL6101)..."
                    emptyText={materialGroup ? 'No materials found' : 'Select material group first'}
                  />
                </div>
              </>
            )}

            {/* Material Details + Location Price Matrix + Unit Cost (single guard) */}
            {selectedMaterial && (() => {
              // ── Rate calculations ──────────────────────────────────────────────
              // No fabricated FX table while the real exchange_rates fetch is
              // in flight (matches the other exchangeRates ?? {} sites in this
              // file) — usdPrice/toUsdPrice below fall back to 0 rather than a
              // guessed rate when a specific currency isn't loaded yet.
              const rates = exchangeRates ?? {};
              const countryLower = (country || '').toLowerCase();

              const getRegionalRate = (): [number, string, string] => {
                if (countryLower.includes('india'))
                  return [selectedMaterial.costIndia ?? 0, 'INR', '₹'];
                if (countryLower.includes('usa') || countryLower.includes('united states'))
                  return [selectedMaterial.costUsa ?? 0, 'USD', '$'];
                if (countryLower.includes('germany'))
                  return [selectedMaterial.costGermany ?? 0, 'EUR', '€'];
                if (countryLower.includes('france'))
                  return [selectedMaterial.costFrance ?? 0, 'EUR', '€'];
                if (countryLower.includes('w. europe') || countryLower.includes('western europe'))
                  return [selectedMaterial.costWEurope ?? 0, 'EUR', '€'];
                if (countryLower.includes('e. europe') || countryLower.includes('eastern europe'))
                  return [selectedMaterial.costEEurope ?? 0, 'EUR', '€'];
                if (countryLower.includes('china'))
                  return [selectedMaterial.costChina ?? 0, 'CNY', '¥'];
                const base = selectedMaterial.unitCost || selectedMaterial.cost || 0;
                const sym =
                  selectedMaterial.currency === 'EUR' ? '€' :
                  selectedMaterial.currency === 'GBP' ? '£' :
                  selectedMaterial.currency === 'INR' ? '₹' : '$';
                return [base, selectedMaterial.currency || 'USD', sym];
              };

              const [localCost, localCurrency, localSymbol] = getRegionalRate();
              const hasRegionalCost = !!country && localCost > 0;
              const rawLocalCost = hasRegionalCost ? localCost
                : (selectedMaterial.unitCost || selectedMaterial.cost || 0);
              const effectiveCurrency = hasRegionalCost ? localCurrency : (selectedMaterial.currency || 'USD');
              const inrAmount  = rawLocalCost * (rates[effectiveCurrency] ?? 1);
              const usdPrice   = rates['USD'] ? inrAmount / rates['USD'] : 0;
              const showLocalLine = effectiveCurrency !== 'USD' && rawLocalCost > 0;

              // ── Price matrix ───────────────────────────────────────────────────
              const locationPrices: Array<{ flag: string; label: string; cost: number | undefined; currency: string; symbol: string }> = [
                { flag: '🇮🇳', label: 'India',     cost: selectedMaterial.costIndia,   currency: 'INR', symbol: '₹'   },
                { flag: '🇺🇸', label: 'USA',       cost: selectedMaterial.costUsa,     currency: 'USD', symbol: '$'   },
                { flag: '🇨🇳', label: 'China',     cost: selectedMaterial.costChina,   currency: 'CNY', symbol: '¥'   },
                { flag: '🇩🇪', label: 'Germany',   cost: selectedMaterial.costGermany, currency: 'EUR', symbol: '€'   },
                { flag: '🇫🇷', label: 'France',    cost: selectedMaterial.costFrance,  currency: 'EUR', symbol: '€'   },
                { flag: '🇪🇺', label: 'W. Europe', cost: selectedMaterial.costWEurope, currency: 'EUR', symbol: '€'   },
                { flag: '🇪🇺', label: 'E. Europe', cost: selectedMaterial.costEEurope, currency: 'EUR', symbol: '€'   },
                { flag: '🇲🇽', label: 'Mexico',    cost: selectedMaterial.costMexico,  currency: 'MXN', symbol: 'MX$' },
              ].filter(p => p.cost && p.cost > 0);

              const toUsdPrice = (lc: number, curr: string) =>
                rates['USD'] ? (lc * (rates[curr] ?? 1)) / rates['USD'] : 0;

              return (
                <div className="space-y-3">
                  {/* Material Details */}
                  <div className="bg-secondary/20 p-4 rounded-lg space-y-3">
                    <label className="text-sm font-semibold block">Material Details</label>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Material:</span>
                        <span className="ml-2 font-medium">{selectedMaterial.material}</span>
                      </div>
                      {selectedMaterial.materialType && (
                        <div>
                          <span className="text-muted-foreground">Type:</span>
                          <span className="ml-2 font-medium">{selectedMaterial.materialType}</span>
                        </div>
                      )}
                      {selectedMaterial.materialDescription && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">Description:</span>
                          <span className="ml-2 font-medium">{selectedMaterial.materialDescription}</span>
                        </div>
                      )}
                      {selectedMaterial.densityKgM3 && (
                        <div>
                          <span className="text-muted-foreground">Density:</span>
                          <span className="ml-2 font-medium">{selectedMaterial.densityKgM3} kg/m³</span>
                        </div>
                      )}
                    </div>

                    {/* Location price matrix */}
                    {locationPrices.length > 0 && (
                      <div className="border-t border-border pt-3">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Price data available for this material:</p>
                        <div className="grid grid-cols-2 gap-1">
                          {locationPrices.map(p => {
                            const isSelected = country === p.label;
                            const locUsd = toUsdPrice(p.cost!, p.currency);
                            // Also gate on exchangeRates itself (not just
                            // hasDisplayCurrency) — locUsd honestly falls back
                            // to 0 while the live rates are still loading, and
                            // that must read as "—", never as a real ₹0.00.
                            const locDisplay = hasDisplayCurrency && exchangeRates ? locUsd * usdToDisplay! : null;
                            return (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() => setCountry(p.label)}
                                className={`flex items-center justify-between text-xs px-2 py-1 rounded transition-colors text-left ${
                                  isSelected
                                    ? 'bg-primary text-primary-foreground font-semibold'
                                    : 'bg-background hover:bg-primary/10 border border-border'
                                }`}
                              >
                                <span>{p.flag} {p.label}</span>
                                <div className="text-right ml-2">
                                  <div className="font-mono tabular-nums">
                                    {locDisplay != null ? `${displaySymbol}${locDisplay.toFixed(2)}` : '—'}
                                  </div>
                                  {p.currency !== nestingCostSummary?.currency && (
                                    <div className={`text-[9px] tabular-nums ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                      {p.symbol}{p.cost!.toFixed(2)} {p.currency}
                                    </div>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          Click a location to use that price
                          {nestingCostSummary?.currency ? ` · Converted to ${nestingCostSummary.currency} at the live Digital Factory rate` : ''}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Unit Cost */}
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Unit Cost</label>
                    <div className="p-4 border-2 border-primary/20 bg-primary/5 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-primary">
                          Price{nestingCostSummary?.currency ? ` (${nestingCostSummary.currency})` : ''}{country ? ` · ${country}` : ''}:
                        </span>
                        <span className="text-lg font-bold text-primary">
                          {hasDisplayCurrency && exchangeRates ? `${displaySymbol}${(usdPrice * usdToDisplay!).toFixed(2)} / kg` : 'Loading Digital Factory rate…'}
                        </span>
                      </div>
                      {showLocalLine && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-primary/10 pt-1">
                          <span>Local rate ({effectiveCurrency}):</span>
                          <span>{localSymbol}{rawLocalCost.toFixed(2)} / kg</span>
                        </div>
                      )}
                      {country && !hasRegionalCost && (
                        <div className="text-xs text-amber-600 border-t border-primary/10 pt-1">
                          No {country}-specific price in database — showing base rate
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Manual Unit Cost Input (when material has no cost) */}
            {(selectedMaterialId || editData) && (!selectedMaterial ||
              (!selectedMaterial.unitCost && !selectedMaterial.cost)) && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-orange-600">
                  Manual Unit Cost <span className="text-xs text-muted-foreground">(Material has no cost data)</span>
                </label>
                <div className="p-4 border-2 border-orange-200 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{hasDisplayCurrency ? displaySymbol : '…'}</span>
                    <Input
                      type="number"
                      step="0.01"
                      disabled={!hasDisplayCurrency}
                      // Typed and shown in the live Digital Factory currency;
                      // stored internally as USD (manualUnitCost's own
                      // convention — matches resolveRegionalUnitCostUsd and
                      // every other cost this dialog computes) via the same
                      // real FX rate used everywhere else on this page, never
                      // a second hardcoded table.
                      value={manualUnitCost === 0 ? '' : hasDisplayCurrency ? manualUnitCost * usdToDisplay! : manualUnitCost}
                      onChange={(e) => {
                        const val = e.target.value;
                        const parsed = val === '' ? 0 : parseFloat(val) || 0;
                        setManualUnitCost(hasDisplayCurrency ? parsed / usdToDisplay! : parsed);
                      }}
                      placeholder={hasDisplayCurrency ? 'Enter unit cost' : 'Loading Digital Factory rate…'}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground">per unit</span>
                  </div>
                  <div className="text-xs text-orange-600 mt-2">
                    This cost will be used for calculations since the selected material has no cost data.
                  </div>
                </div>
              </div>
            )}

            {/* ── CAD Geometry Banner ────────────────────────────────────────── */}
            {cadVolumeMm3 != null && cadVolumeMm3 > 0 && (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 dark:border-cyan-800 dark:bg-cyan-950/30 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-400 font-semibold mb-1.5">From CAD Analysis</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-800 dark:text-cyan-300">
                  <span>Volume: <strong>{cadVolumeMm3.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm³</strong></span>
                  {bomItemData?.weight && <span>Weight: <strong>{Number(bomItemData.weight).toFixed(4)} kg</strong></span>}
                  {bomItemData?.materialGrade && <span>Grade: <strong>{bomItemData.materialGrade}</strong></span>}
                  {matDensityKgM3 && <span>Density: <strong>{matDensityKgM3} kg/m³</strong></span>}
                </div>
                {smartFillAvailable && (
                  <Button type="button" size="sm" variant="outline"
                    className="mt-2 h-7 text-xs border-cyan-400 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900"
                    onClick={handleSmartFill}>
                    Smart Fill — net usage from geometry
                  </Button>
                )}
              </div>
            )}

            {/* Usage and Cost Fields */}
            {!selectedMaterialId && !editData && (
              <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
                Select a material above to enable usage and cost fields
              </div>
            )}

            {/* Net Usage + Gross Usage */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold flex items-center gap-2">
                  Net Usage
                  <span className="text-muted-foreground text-xs font-normal">(kg · finished part)</span>
                  {cadFilled && (
                    <span className="text-[10px] bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300 px-1.5 py-0.5 rounded font-semibold">CAD</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.000001"
                    value={netUsage === '' ? '' : netUsage.toString()}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNetUsage(val === '' ? '' : parseFloat(val) || 0);
                      setCadFilled(false);
                    }}
                    placeholder="Enter net usage"
                    className="flex-1"
                    disabled={!selectedMaterialId && !editData}
                  />
                  <Button
                    type="button" variant="outline" size="icon"
                    onClick={(e) => {
                      e.preventDefault(); e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.();
                      setCalculatorTarget('netUsage');
                      setCalculatorResults(null);
                      setCalculatorWarnings([]);
                      if (isSheetMetalItem && netUsageCalculator) {
                        setSelectedCalculatorId(netUsageCalculator.id);
                        setCalculatorInputs({});
                        autoPopulateUsageCalculatorInputs('netUsage');
                      }
                      setCalculatorOpen(true);
                    }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.(); }}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    title="Use DB Calculator"
                    disabled={!selectedMaterialId && !editData}
                  >
                    <CalculatorIcon className="h-4 w-4" />
                  </Button>
                </div>
                {cadFilled && cadVolumeMm3 && matDensityKgM3 ? (
                  <p className="text-[11px] text-cyan-600 dark:text-cyan-400 font-mono">
                    {cadVolumeMm3.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm³ × {matDensityKgM3.toLocaleString()} kg/m³ ÷ 1,000,000,000
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">weight of finished part in the material</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold flex items-center gap-2">
                  Gross Usage
                  <span className="text-muted-foreground text-xs font-normal">
                    {grossUsageOverridden
                      ? '(kg · manually overridden)'
                      : nestingIsTrustworthy
                        ? '(kg · from nesting engine, per part)'
                        : isSheetMetalItem
                          ? '(kg · enter manually)'
                          : '(kg · auto-calculated)'}
                  </span>
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.000001"
                    value={grossUsage === '' ? '' : grossUsage.toString()}
                    onChange={(e) => {
                      const val = e.target.value;
                      setGrossUsage(val === '' ? '' : parseFloat(val) || 0);
                    }}
                    placeholder={isSheetMetalItem && !nestingIsTrustworthy ? 'Enter gross usage — nesting unavailable/unverified' : 'Enter gross usage'}
                    className="flex-1"
                    disabled={(nestingIsTrustworthy && !grossUsageOverridden) || (!selectedMaterialId && !editData)}
                    title={nestingIsTrustworthy && !grossUsageOverridden ? 'Derived from the real nesting result — click the calculator icon to view the justification or override' : undefined}
                  />
                  <Button
                    type="button" variant="outline" size="icon"
                    onClick={(e) => {
                      e.preventDefault(); e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.();
                      setCalculatorTarget('grossUsage');
                      setCalculatorResults(null);
                      setCalculatorWarnings([]);
                      if (isSheetMetalItem && grossUsageCalculator) {
                        setSelectedCalculatorId(grossUsageCalculator.id);
                        setCalculatorInputs({});
                        autoPopulateUsageCalculatorInputs('grossUsage');
                      }
                      setCalculatorOpen(true);
                    }}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.(); }}
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    title={isSheetMetalItem && grossUsageCalculator ? 'View calculation & override' : 'Use DB Calculator'}
                    disabled={!selectedMaterialId && !editData}
                  >
                    <CalculatorIcon className="h-4 w-4" />
                  </Button>
                </div>
                {nestingIsTrustworthy ? (
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-cyan-600 dark:text-cyan-400 font-mono">
                      {nestingBlankSpec.sheetWidthMm}×{nestingBlankSpec.sheetLengthMm}mm sheet · {nestingBlankSpec.partsPerSheet} parts/sheet · {nestingBlankSpec.utilizationPct}% util · verified CAD flat pattern
                    </p>
                    {typeof nestingBlankSpec.sheetsRequired === 'number' && (
                      <p className="text-[11px] text-muted-foreground font-mono">
                        Batch: {nestingBlankSpec.sheetsRequired} sheet{nestingBlankSpec.sheetsRequired === 1 ? '' : 's'} required · {nestingBlankSpec.plannedParts} planned / {nestingBlankSpec.excessPositions} excess
                      </p>
                    )}
                    {grossUsageOverridden ? (
                      <div className="rounded border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2 space-y-0.5">
                        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          ⚠ Manual Override — {typeof grossUsage === 'number' ? grossUsage.toFixed(4) : '—'} kg/part
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Calculated value: {nestingBlankSpec.grossWeightKg.toFixed(4)} kg/part
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Difference: {typeof grossUsage === 'number'
                            ? `${grossUsage - nestingBlankSpec.grossWeightKg >= 0 ? '+' : ''}${(grossUsage - nestingBlankSpec.grossWeightKg).toFixed(4)}`
                            : '—'} kg/part
                        </p>
                        {grossUsageOverrideReason && (
                          <p className="text-[11px] text-muted-foreground italic">Reason: {grossUsageOverrideReason}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => { setGrossUsageOverridden(false); setGrossUsageOverrideReason(''); }}
                          className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline"
                        >
                          Clear override — use calculated value
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setGrossUsageEditDraft(nestingBlankSpec.grossWeightKg.toFixed(4));
                          setGrossUsageEditReasonDraft('');
                          setGrossUsageEditOpen((v) => !v);
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {grossUsageEditOpen ? 'Cancel edit' : 'Edit — override manually'}
                      </button>
                    )}
                    {grossUsageEditOpen && !grossUsageOverridden && (
                      <div className="rounded border border-border bg-muted/20 p-2 space-y-2">
                        <div>
                          <Label className="text-[10px]">Calculated Value</Label>
                          <p className="text-[11px] font-mono tabular-nums">{nestingBlankSpec.grossWeightKg.toFixed(4)} kg/part</p>
                        </div>
                        <div>
                          <Label className="text-[10px]">Manual Override (kg/part)</Label>
                          <Input
                            type="number" step="0.000001" className="h-7 text-xs"
                            value={grossUsageEditDraft}
                            onChange={(e) => setGrossUsageEditDraft(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px]">Reason</Label>
                          <Input
                            type="text" className="h-7 text-xs"
                            placeholder="e.g. Customer-supplied material allocation"
                            value={grossUsageEditReasonDraft}
                            onChange={(e) => setGrossUsageEditReasonDraft(e.target.value)}
                          />
                        </div>
                        <Button
                          type="button" size="sm" className="h-7 text-xs"
                          disabled={!grossUsageEditReasonDraft.trim()}
                          onClick={() => {
                            const parsed = parseFloat(grossUsageEditDraft);
                            if (!Number.isNaN(parsed) && parsed > 0) {
                              setGrossUsage(parsed);
                              setGrossUsageOverrideReason(grossUsageEditReasonDraft.trim());
                              setGrossUsageOverridden(true);
                            }
                            setGrossUsageEditOpen(false);
                          }}
                        >
                          Apply Override
                        </Button>
                      </div>
                    )}
                  </div>
                ) : hasRealNesting ? (
                  // Nesting ran but only on the folded-3D-bbox fallback (true flat
                  // pattern unresolved) — disclosed honestly, but NOT trusted to
                  // auto-fill anything: for a bent part that box overcounts
                  // capacity (see nestingIsTrustworthy's doc comment).
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Nesting ran on an unverified fallback ({nestingBlankSpec.sheetWidthMm}×{nestingBlankSpec.sheetLengthMm}mm sheet, {nestingBlankSpec.partsPerSheet} parts/sheet — folded 3D bounding box, not the true flat pattern) — this typically overcounts capacity for a bent part. Not used to fill Gross Usage; enter the real value manually.
                  </p>
                ) : isSheetMetalItem ? (
                  <p className="text-[11px] text-muted-foreground">Flat-pattern geometry unavailable — nesting could not run for this part. Enter Gross Usage manually.</p>
                ) : typeof netUsage === 'number' && netUsage > 0 ? (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    {netUsage} ÷ (1 − {typeof scrap === 'number' ? scrap : 0}% / 100)
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">net ÷ (1 − scrap%) — includes material lost in process</p>
                )}
              </div>
            </div>

            {/* Scrap, Reclaim Rate, Overhead */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold" title={isSheetMetalItem ? 'Derived display: (Gross Usage − Net Usage) / Gross Usage — not an independent input for sheet-metal parts' : '% of gross lost as chips/trim/yield — drives Gross = Net ÷ (1 − scrap%)'}>
                  Scrap / Yield Loss %
                </label>
                <Input
                  type="number" step="0.01"
                  value={
                    isSheetMetalItem
                      ? (() => {
                        const g = typeof grossUsage === 'number' ? grossUsage : 0;
                        const n = typeof netUsage === 'number' ? netUsage : 0;
                        return g > 0 ? (((g - n) / g) * 100).toFixed(2) : '';
                      })()
                      : (scrap === '' ? '' : scrap.toString())
                  }
                  onChange={(e) => { const v = e.target.value; setScrap(v === '' ? '' : parseFloat(v) || 0); }}
                  placeholder={isSheetMetalItem ? '—' : 'e.g. 10.5'}
                  disabled={isSheetMetalItem || (!selectedMaterialId && !editData)}
                  title={isSheetMetalItem ? 'Derived from Gross Usage and Net Usage — not independently editable for sheet-metal parts' : undefined}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold" title="Scrap metal reclaim value per kg (e.g. chip buy-back rate). Must not exceed unit cost.">
                  Reclaim Rate ($/kg)
                </label>
                <Input
                  type="number" step="0.001"
                  value={reclaimRate === '' ? '' : reclaimRate.toString()}
                  onChange={(e) => { const v = e.target.value; setReclaimRate(v === '' ? '' : parseFloat(v) || 0); }}
                  placeholder="e.g. 0.30"
                  disabled={!selectedMaterialId && !editData}
                  className={previewBreakdown?.reclaimRateInvalid ? 'border-destructive focus-visible:ring-destructive' : ''}
                />
                {previewBreakdown?.reclaimRateInvalid ? (
                  <p className="text-xs text-destructive">
                    Must be less than unit cost ({hasDisplayCurrency
                      ? `${displaySymbol}${(((previewBreakdown.grossMaterialCost ?? 0) / (previewBreakdown.gross || 1)) * usdToDisplay!).toFixed(3)}/kg`
                      : '…'})
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold">Overhead %</label>
                <Input
                  type="number" step="0.01"
                  value={overhead === '' ? '' : overhead.toString()}
                  onChange={(e) => { const v = e.target.value; setOverhead(v === '' ? '' : parseFloat(v) || 0); }}
                  placeholder="e.g. 5.0"
                  disabled={!selectedMaterialId && !editData}
                />
              </div>
            </div>

            {/* ── Live 8-Step Cost Breakdown — always visible ───────────────── */}
            {(() => {
              const b = previewBreakdown;
              const dim = 'text-muted-foreground/40';
              // b's own fields (grossMaterialCost, totalCostVal, ...) are USD
              // internally, same as everywhere else in this dialog — convert
              // to the live Digital Factory display currency here, never a
              // hardcoded '$'. When the rate hasn't loaded yet, show '—'
              // rather than a guessed symbol/number.
              const sym = hasDisplayCurrency ? displaySymbol! : null;
              const dsp = (n: number) => (usdToDisplay ?? 0) * n;
              const val = (n: number | undefined, d = 4) => (b && sym) ? `${sym}${dsp(n ?? 0).toFixed(d)}` : '—';
              const unitCostDisplay = (b && sym) ? `${sym}${dsp((b.grossMaterialCost ?? 0) / (b.gross || 1)).toFixed(3)}/kg` : '—';
              const grossKg = b ? `${(b.gross ?? 0).toFixed(4)} kg` : '— kg';
              const scrapKg = b ? `${(b.scrapAmount ?? 0).toFixed(4)} kg` : '— kg';
              const reclaimRateDisplay = (b && sym) ? `${sym}${dsp(Number(reclaimRate || 0)).toFixed(3)}/kg` : '—';
              return (
                <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                  {/* header */}
                  <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Live Cost Breakdown</span>
                    <span className={`text-xl font-bold tabular-nums ${b ? 'text-foreground' : dim}`}>
                      {(b && sym) ? `${sym}${dsp(b.totalCostVal ?? 0).toFixed(4)}` : '—'}
                    </span>
                  </div>

                  {/* rows */}
                  <div className="px-4 py-3 space-y-1.5 text-xs">

                    {/* Gross material cost */}
                    <div className={`flex items-baseline justify-between gap-4 ${b ? 'text-foreground' : dim}`}>
                      <span className="shrink-0">Gross material cost</span>
                      <span className={`font-mono text-muted-foreground text-[11px] flex-1 text-right truncate`}>
                        {grossKg} × {unitCostDisplay}
                      </span>
                      <span className="tabular-nums font-mono shrink-0">{val(b?.grossMaterialCost)}</span>
                    </div>

                    {/* Reclaim value */}
                    <div className={`flex items-baseline justify-between gap-4 ${b && (b.reclaimValue ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : dim}`}>
                      <span className="shrink-0">− Reclaim value</span>
                      <span className="font-mono text-[11px] flex-1 text-right truncate">
                        {scrapKg} × {reclaimRateDisplay}
                      </span>
                      <span className="tabular-nums font-mono shrink-0">
                        {(b && sym) ? `−${sym}${dsp(b.reclaimValue ?? 0).toFixed(4)}` : '—'}
                      </span>
                    </div>

                    {/* Net material cost */}
                    <div className={`flex items-baseline justify-between gap-4 ${b ? 'text-foreground' : dim}`}>
                      <span className="shrink-0">= Net material cost</span>
                      <span className="font-mono text-[11px] flex-1 text-right text-muted-foreground/60">
                        gross − reclaim
                      </span>
                      <span className="tabular-nums font-mono shrink-0">{val(b?.netMaterialCost)}</span>
                    </div>

                    {/* Overhead */}
                    <div className={`flex items-baseline justify-between gap-4 ${b && (b.overheadCost ?? 0) > 0 ? 'text-foreground' : dim}`}>
                      <span className="shrink-0">+ Overhead</span>
                      <span className="font-mono text-[11px] flex-1 text-right text-muted-foreground/60">
                        net × {Number(overhead || 0)}%
                      </span>
                      <span className="tabular-nums font-mono shrink-0">
                        {(b && sym) ? `+${sym}${dsp(b.overheadCost ?? 0).toFixed(4)}` : '—'}
                      </span>
                    </div>

                    {/* Total */}
                    <div className="border-t border-border mt-1 pt-2 flex items-baseline justify-between font-bold">
                      <span>Total cost</span>
                      <span className={`tabular-nums font-mono text-sm ${b ? 'text-foreground' : dim}`}>
                        {(b && sym) ? `${sym}${dsp(b.totalCostVal ?? 0).toFixed(4)}` : '—'}
                      </span>
                    </div>

                    {/* Efficiency row */}
                    <div className={`flex gap-6 pt-0.5 text-[11px] ${b ? 'text-muted-foreground' : dim}`}>
                      <span>
                        Utilization:{' '}
                        <strong className={!b ? '' : (b.utilRate ?? 0) < 50 ? 'text-destructive' : (b.utilRate ?? 0) < 75 ? 'text-amber-500' : 'text-emerald-500'}>
                          {b ? `${(b.utilRate ?? 0).toFixed(1)}%` : '—'}
                        </strong>
                      </span>
                      <span>
                        Eff. {nestingCostSummary?.currency ? `${nestingCostSummary.currency}/kg` : '$/kg'}:{' '}
                        <strong>{(b && sym) ? `${sym}${dsp(b.effPerUnit ?? 0).toFixed(3)}` : '—'}</strong>
                      </span>
                    </div>

                    {!b && (
                      <p className="text-[11px] text-muted-foreground/50 pt-0.5 italic">
                        Select a material and enter net usage to see live numbers
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !!previewBreakdown?.reclaimRateInvalid ||
                  (editData
                    ? Number(grossUsage) <= 0
                    : !materialGroup || !selectedMaterialId || Number(grossUsage) <= 0)
                }
              >
                {editData ? 'Update Material' : 'Add Material'}
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>

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
            <SheetTitle>
              Calculator - {calculatorTarget === 'grossUsage' ? 'Gross Usage' : 'Net Usage'}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Calculator Selector */}
            <div className="space-y-2">
              <Label>Select Calculator</Label>
              <Select
                value={selectedCalculatorId}
                onValueChange={(id) => {
                  setSelectedCalculatorId(id);
                  setCalculatorResults(null);
                  setCalculatorWarnings([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a calculator" />
                </SelectTrigger>
                <SelectContent>
                  {calculatorsData?.calculators?.map((calc: any) => (
                    <SelectItem key={calc.id} value={calc.id}>
                      {calc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    {/* Resolved Geometry — required by the real evaluation, but not a
                        calculator-form scalar. Rendered read-only/greyed, distinct from
                        the genuinely editable Input Values below, never an <Input>. */}
                    {selectedCalculator.fields
                      ?.filter((field: any) => field.fieldName === 'Flat Pattern Outline')
                      .map((field: any) => (
                        <div key={field.id} className="space-y-1 rounded border border-dashed border-border/60 bg-muted/20 p-2">
                          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Resolved Geometry — required, not editable
                          </Label>
                          <p className="text-xs">
                            {hasRealNesting ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                Verified CAD flat-pattern outline resolved
                              </span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">
                                Unavailable — no verified flat-pattern outline for this part yet
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{usageCalculatorInputProvenance['Flat Pattern Outline']}</p>
                        </div>
                      ))}
                    {selectedCalculator.fields
                      ?.filter((field: any) => field.fieldType !== 'calculated' && field.fieldName !== 'Flat Pattern Outline')
                      .map((field: any) => {
                        // Only show eye button for fields that are likely to have lookup tables
                        const isLookupTableField =
                          // Show for database lookup fields with processes data source
                          (field.fieldType === 'database_lookup' && field.dataSource === 'processes') ||
                          // Show for fields with sourceField starting with 'from_' (linked to reference tables)
                          (field.sourceField && field.sourceField.startsWith('from_')) ||
                          // Note: Raw materials fields now auto-populate, no eye icon needed --
                          // except the two sheet-metal usage calculators' own raw_materials
                          // fields, where seeing/verifying the matched material row was
                          // explicitly requested.
                          field.fieldName === 'Shear Strength' || field.fieldName === 'Material Density';
                        // These two fields' calculator_fields rows don't carry a
                        // source_property column (seeded generically) -- map it here
                        // instead of guessing a DB column that was never set.
                        const rawMaterialSourceProperty: Record<string, string> = {
                          'Shear Strength': 'shearingStrength',
                          'Material Density': 'densityKgM3',
                        };
                        const lookupField = rawMaterialSourceProperty[field.fieldName]
                          ? { ...field, dataSource: 'raw_materials', sourceProperty: rawMaterialSourceProperty[field.fieldName] }
                          : field;

                        return (
                          <div key={field.id} className="space-y-2">
                            <Label htmlFor={field.fieldName}>
                              {field.displayLabel || field.fieldName}
                              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
                              {field.fieldType === 'database_lookup' && field.dataSource === 'raw_materials' && (
                                <div className="ml-2 inline-flex flex-col gap-1">
                                  {(() => {
                                    const sourceProperty = field.sourceProperty || field.sourceField;
                                    
                                    // Property display mappings for better UI labels
                                    const propertyDisplayNames: Record<string, string> = {
                                      // Basic Material Info
                                      'material': 'Material Name',
                                      'materialGrade': 'Material Grade',
                                      'materialGroup': 'Material Group',
                                      'materialType': 'Material Type',
                                      'materialDescription': 'Material Description',
                                      
                                      // Physical Properties
                                      'density': 'Density (kg/m³)',
                                      'densityKgM3': 'Density (kg/m³)',
                                      
                                      // Mechanical Properties
                                      'ultimateTensileStrength': 'Ultimate Tensile Strength (MPa)',
                                      'yieldTensileStrength': 'Yield Tensile Strength (MPa)',
                                      'shearingStrength': 'Shearing Strength (MPa)',
                                      
                                      // Thermal Properties
                                      'meltingTempC': 'Melting Temperature (°C)',
                                      'moldTempC': 'Mold Temperature (°C)',
                                      'ejectDeflectionTempC': 'Heat Deflection Temperature (°C)',
                                      'thermalConductivityMelt': 'Thermal Conductivity (W/mK)',
                                      'specificHeatMelt': 'Specific Heat (J/gK)',
                                      
                                      // Processing Properties
                                      'clampingPressureMpa': 'Clamping Pressure (MPa)',
                                      'regrindingPercentage': 'Regrinding Percentage (%)',
                                      'regrinding': 'Regrinding Allowed',
                                      
                                      // Commercial Properties
                                      'cost': 'Cost per Unit',
                                      'unitCost': 'Unit Cost',
                                      'currency': 'Currency',
                                      'location': 'Location',
                                      'country': 'Country of Origin',
                                      'shape': 'Material Shape',
                                      
                                      // Standards
                                      'astmStandard': 'ASTM Standard',
                                      'dinStandard': 'DIN Standard',
                                      'enStandard': 'EN Standard',
                                      'jisStandard': 'JIS Standard',
                                      
                                      // Legacy mappings
                                      'meltingTempCelsius': 'Melting Temperature (°C)',
                                      'costPerKg': 'Cost per kg',
                                      'costPerUnit': 'Cost per Unit',
                                      'utsMpa': 'Ultimate Tensile Strength (MPa)',
                                      'ytsMpa': 'Yield Tensile Strength (MPa)',
                                      'thermalConductivityWMK': 'Thermal Conductivity (W/mK)',
                                      'specificHeatJGK': 'Specific Heat (J/gK)'
                                    };
                                    
                                    const displayName = propertyDisplayNames[sourceProperty] || sourceProperty;
                                    
                                    return sourceProperty ? (
                                      <span className="text-[10px] text-muted-foreground bg-gray-50 px-1.5 py-0.5 rounded border">
                                        {displayName}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                              )}
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
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleViewLookupTable(lookupField);
                                  }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  className="px-3"
                                  title="View reference table"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : field.fieldType === 'text' ? (
                              <Input
                                id={field.fieldName}
                                type="text"
                                value={calculatorInputs[field.fieldName] || ''}
                                onChange={(e) => setCalculatorInputs({ ...calculatorInputs, [field.fieldName]: e.target.value })}
                                placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                              />
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
                            {usageCalculatorInputProvenance[field.fieldName] && (
                              <p className="text-[10px] text-muted-foreground">
                                Why: {usageCalculatorInputProvenance[field.fieldName]}
                              </p>
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
                {calculatorWarnings.length > 0 && (
                  <Card className="border-amber-400">
                    <CardContent className="p-3 space-y-1">
                      {calculatorWarnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
                      ))}
                      {calculatorTarget === 'grossUsage' && !nestingIsTrustworthy && (
                        <p className="text-xs text-muted-foreground">
                          Enter Gross Usage manually in the field above, or disclose the rectangle-grid fallback
                          already shown there if the cost summary used it.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
                {calculatorResults && Object.keys(calculatorResults).length > 0 && (
                  <Card className="border-primary">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        {(selectedCalculator.name === 'Sheet Metal - Gross Material Usage (Nesting)') ? 'Nesting Result' : 'Results'}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {selectedCalculator.fields
                        ?.filter((field: any) => field.fieldType === 'calculated')
                        .map((field: any) => {
                          const result = calculatorResults[field.fieldName];
                          const value = result?.value !== undefined ? result.value : result;
                          if (value === undefined) return null;
                          // For the two sheet-metal usage calculators, only the field
                          // that actually feeds this dialog's target usage input gets
                          // a "Use" button -- showing it on every calculated field
                          // (Parts Per Sheet, Sheet Weight, ...) would let a click
                          // silently overwrite Gross/Net Usage with the wrong number.
                          const isUsageCalculator = selectedCalculator.name === 'Sheet Metal - Gross Material Usage (Nesting)'
                            || selectedCalculator.name === 'Sheet Metal - Net Material Usage';
                          const isPrimaryOutput = calculatorTarget === 'grossUsage'
                            ? field.fieldName === 'Gross Weight Per Part'
                            : field.fieldName === 'Net Usage';
                          const showUseButton = !isUsageCalculator || isPrimaryOutput;
                          // The real DB formula string (calculator_fields.default_value)
                          // with every {Field Name} token substituted for the actual
                          // value that produced this result -- the same real backend
                          // logic (physics_key), not a re-derived/approximated caption.
                          const formulaLine = formatFormulaWithValues(field.default_value, calculatorResults, calculatorInputs);

                          return (
                            <div
                              key={field.id}
                              className="p-3 bg-secondary/50 rounded-lg space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium">{field.displayLabel || field.fieldName}</div>
                                  {field.unit && (
                                    <div className="text-xs text-muted-foreground">{field.unit}</div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-lg font-bold text-primary">
                                    {typeof value === 'number' ? value.toFixed(4) : value || 'N/A'}
                                  </div>
                                  {showUseButton && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleUseCalculatorValue(value)}
                                      disabled={typeof value !== 'number'}
                                    >
                                      Use
                                    </Button>
                                  )}
                                </div>
                              </div>
                              {formulaLine && (
                                <p className="text-[10px] font-mono text-muted-foreground/80 break-all">= {formulaLine}</p>
                              )}
                            </div>
                          );
                        })}
                    </CardContent>
                  </Card>
                )}
                {calculatorTarget === 'grossUsage' && grossUsageTrace.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Calculation Trace</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CalculationTracePanel line={{ calculationTrace: grossUsageTrace, ...(grossUsageConfidence ? { confidence: grossUsageConfidence } : {}) }} />
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
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
                Click any row to use that value for <strong className="text-foreground mx-0.5">{lookupTableData.fieldLabel}</strong>. Highlighted column = selected value.
              </div>

              <div
                className="flex-1 p-3 relative overflow-auto"
                style={{
                  height: 'calc(100vh - 120px)',
                  pointerEvents: 'auto',
                  zIndex: 61
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
                              className={`border border-border text-left text-xs font-semibold py-1 px-2 ${isOutputCol ? 'text-primary bg-primary/10' : 'text-foreground'}`}
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
                        // Highlight the row matching the material actually selected in
                        // this dialog, so a user opening the lookup table can see exactly
                        // which real raw_materials row the auto-filled value came from.
                        const isSelectedMaterialRow = !!selectedMaterial && (
                          (row.materialGrade && row.materialGrade === selectedMaterial.materialGrade) ||
                          (row.materialName && row.materialName === selectedMaterial.material)
                        );
                        return (
                          <tr
                            key={rowIndex}
                            className={`hover:bg-primary/10 cursor-pointer transition-colors ${isSelectedMaterialRow ? 'bg-emerald-100 dark:bg-emerald-950/50 font-semibold' : ''}`}
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
                            title={
                              (isSelectedMaterialRow ? 'This is the currently selected material. ' : '') +
                              (outputCol ? `Click to use: ${outputCol.label} = ${outputValue}` : `Click to select`)
                            }
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
    </Dialog>
  );
}
