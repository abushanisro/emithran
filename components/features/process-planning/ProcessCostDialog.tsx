'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

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
import { resolveMhrUsdRate } from '@/lib/api/mhr';
import { mhrCategoryOf } from '@/lib/utils/mhrCategoryOf';
import {
  effectiveProcessGroupOf,
  processGroupOptionsFrom,
  categoryOptionsFrom,
  matchesProcessAndCategory,
  categoryMachineClassesOf,
  benchmarkMatchesCategory,
  calculatorMappingsForMachineClass,
  unambiguousMapping,
} from '@/lib/processCatalog/hr-rates-process-selection';
import { useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import { useCalculators, useCalculator, useExecuteCalculator } from '@/lib/api/hooks/useCalculators';
import { useCalculateProcessCost } from '@/lib/api/hooks/useProcessCosts';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { Loader2, Calculator as CalculatorIcon, Play, Eye } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { calculatorsApi } from '@/lib/api/calculators';
import { apiClient } from '@/lib/api/client';

// Known options for calculator fields whose fieldType is 'select' — the
// calculator engine has no generic options-storage column yet, so this is a
// small, explicit allowlist rather than an invented generic schema. Fields not
// listed here fall back to a plain text input (honest — no fabricated options).
const SELECT_FIELD_OPTIONS: Record<string, string[]> = {
  'Complexity': ['Simple', 'Intermediate', 'Complex'],
  'Machine Automation': ['Manual', 'Semi-Auto', 'Auto'],
};

// 'sheet_metal_lookup' is the real, DB-constraint-allowed data_source value
// (see backend/migrations/301_extend_data_source_constraint.sql) for fields
// backed by one of the 6 sm_lookup_* tables (POST /api/calculators/sheet-metal/lookup).
// sourceField names which table ('manual_stroke', 'stroke_rate', etc.) — the
// same tableName CalculatorsServiceV2.resolveSheetMetalLookup() accepts. The
// generic calculator execute() engine only reads plain inputs — it can't call
// this API mid-formula — so these fields are resolved between two execute() passes.
const SM_LOOKUP_DATA_SOURCE = 'sheet_metal_lookup';

// Mirrors backend normaliseLaserMaterial (bom-items/costing/sheet-metal-lookup.service.ts)
// — keep the keyword lists in sync. resolveSheetMetalLookup('laser_cut', ...)
// does a raw ILIKE match against sm_lookup_laser_cut.material, so it needs an
// already-normalized category string, not a raw material grade.
function normaliseLaserMaterial(grade: string): string {
  const g = grade.toUpperCase();
  if (/ALUMIN|AL\s*\d{4}|AA\s*\d{4}|6061|6063|5052|5754|7075|2024/.test(g)) return 'Aluminium';
  if (/STAINLESS|SS\s*3\d{2}|SS\s*4\d{2}|AISI\s*3\d{2}|17-4|SS304|SS316/.test(g)) return 'Stainless Steel';
  if (/BRASS|CUZ|CW/.test(g)) return 'Brass';
  return 'Carbon Steel';
}

// Inspection's per-feature cycle-time fields carry no data_source/sourceField
// either (they're seeded straight from inspection_operation_defaults inside
// inspection-engine.ts's planInspection(), never DB-tagged at the calculator-
// field level) — maps each visible field to the real `feature` column value
// that identifies its row in that table (method is an escalated, derived
// value — visual/caliper/height_gauge/cmm — not something typed into a
// field, so handleViewLookupTable matches by the field's OWN current value
// instead of trying to know which method was used).
const INSPECTION_FEATURE_BY_FIELD: Record<string, string> = {
  'Visual Pass Base': 'visual_base',
  'Hole Check Time': 'hole',
  'Bend Check Time': 'bend',
  'Thread Gauge Time': 'thread',
  'Thickness Check Time': 'thickness',
  'Dimension Check Time': 'dimension',
};

// Same idea as FIELD_NAME_EXTRA_DEPS (relevantFieldNames, above) but for the
// "eye" viewer button: several real lookup-fed fields carry no data_source/
// sourceField at the DB level (migration 378's own comment on Cutting Speed/
// Piercing Time Per Start applies equally here — their lookup is resolved
// entirely in application code, not marked sheet_metal_lookup at the field-
// definition level), so the generic dataSource-driven eye-button check can
// never see them on its own. Returns the REAL, FULL table name directly
// (not a sm_lookup_-suffix — inspection_operation_defaults and
// surface_treatment_rates don't follow that naming convention at all).
function resolveAdHocLookupTableKey(fieldName: string, machineClass: string | undefined): string | null {
  if (fieldName === 'Cutting Speed' || fieldName === 'Piercing Time Per Start') {
    return machineClass === 'waterjet' ? 'sm_lookup_waterjet_cut' : 'sm_lookup_laser_cut';
  }
  if (fieldName === 'Sec Per Metre' || fieldName === 'Sec Per Pierce') {
    return 'sm_lookup_deburr_rate';
  }
  if (fieldName === 'Insertion Cycle Time') {
    return 'sm_lookup_pem_hardware';
  }
  if (machineClass === 'roll_forming' && (fieldName === 'Line Speed' || fieldName === 'Setup Time')) {
    return 'sm_lookup_roll_forming';
  }
  if (fieldName in INSPECTION_FEATURE_BY_FIELD) {
    return 'inspection_operation_defaults';
  }
  if (fieldName === 'Rate Per M2' || fieldName === 'Min Lot Charge') {
    return 'surface_treatment_rates';
  }
  return null;
}

// Computes which real row a newly-covered ad-hoc field's CURRENT value came
// from, for highlighting — client-side, from the already-fetched table, no
// extra API call. Unlike Cutting Speed/Piercing Time Per Start (highlighted
// via a live re-resolution during auto-fill, calculatorMatchedRowKeys),
// these fields' real source (an escalated inspection method, a treatment
// type keyed on free-text callout matching) isn't reproducible client-side
// — but the row that produced the CURRENT numeric value is still real and
// findable: match on the static, always-known column (feature/location)
// plus the field's own value against the table's value column. Returns null
// (no highlight, table still shown) when nothing matches — never a guessed
// highlight.
function computeAdHocMatchedRow(
  tableName: string,
  fieldName: string,
  rows: any[],
  currentValue: unknown,
  location: string,
): Record<string, any> | null {
  const num = Number(currentValue);
  if (tableName === 'inspection_operation_defaults') {
    const feature = INSPECTION_FEATURE_BY_FIELD[fieldName];
    if (!feature || !Number.isFinite(num)) return null;
    return rows.find((r) => r.feature === feature && Math.abs(Number(r.cycleTimeSec) - num) < 1e-6) ?? null;
  }
  if (tableName === 'sm_lookup_deburr_rate') {
    // Only one real row exists today (material_family='__default__') — see
    // this session's own audit of this table.
    return rows.find((r) => r.materialFamily === '__default__') ?? rows[0] ?? null;
  }
  if (tableName === 'surface_treatment_rates') {
    if (!Number.isFinite(num)) return rows.find((r) => r.location === location) ?? null;
    return rows.find((r) => r.location === location &&
      (Math.abs(Number(r.ratePerM2Usd) - num) < 1e-6 || Math.abs(Number(r.minLotChargeUsd) - num) < 1e-6)) ?? null;
  }
  if (tableName === 'sm_lookup_pem_hardware') {
    // Exact match only — when the current value is a weighted average across
    // multiple matched PEM specs (see ProcessCostDialog's PEM featureBreakdown
    // block), no single row produced it, so this correctly falls through to
    // null (no highlight) rather than guessing one of the contributing rows.
    // Row keys are raw DB columns (snake_case) here, not camelCase — this
    // table is fetched via getSmLookupTableByName's live passthrough
    // (buildLiveSmLookupTablePayload's rowData: r), which returns the row
    // exactly as stored, unlike the other ad-hoc cases above.
    if (!Number.isFinite(num)) return null;
    return rows.find((r) => Math.abs(Number(r.insertion_cycle_sec) - num) < 1e-6) ?? null;
  }
  if (tableName === 'sm_lookup_roll_forming') {
    // Single real row (migration 442) — match against whichever column this
    // field actually reads (Line Speed -> line_speed_m_min, Setup Time ->
    // setup_time_min) so a manually-overridden value correctly shows no
    // highlight instead of always pointing at the one row regardless.
    const col = fieldName === 'Setup Time' ? 'setup_time_min' : 'line_speed_m_min';
    if (!Number.isFinite(num)) return null;
    return rows.find((r) => Math.abs(Number(r[col]) - num) < 1e-6) ?? null;
  }
  return null;
}

// Normalises the row a sheet_metal_lookup call resolved to, for
// calculatorMatchedRowKeys (below). Two different shapes exist across the
// sm_lookup_* resolvers: getManualStrokeTime's LookupResolution wraps the
// real row as { columns: {...} }, while resolveSheetMetalLookup's other
// cases (laser_cut, waterjet_cut, tool_setup) return the flat row directly.
function extractRowColumns(row: any): Record<string, any> | null {
  if (!row) return null;
  if (row.columns && typeof row.columns === 'object') return row.columns;
  return typeof row === 'object' ? row : null;
}

// Press-brake/turret-punch capacity stated plainly in the machine name (e.g.
// "Bend Brake-2500kN") — mhr_records.max_tonnage is null for most seeded
// press brakes, but machine-selection/selector.ts's own parseTonnageFromName
// already falls back to parsing the name for exactly this reason. Mirrors
// that same regex/conversion so this dialog's auto-fill agrees with the
// capacity figure machine selection already displays ("≤ 254.9 t machine
// capacity") instead of duplicating a different approximation.
function parseTonnageFromMachineName(machineName: string | undefined): number | null {
  if (!machineName) return null;
  const kn = machineName.match(/(\d+(?:\.\d+)?)\s*k\s*n\b/i);
  if (kn?.[1]) return Math.round((parseFloat(kn[1]) / 9.80665) * 10) / 10;
  const tons = machineName.match(/(\d+(?:\.\d+)?)\s*(?:tonnes?|tons?|t)\b/i);
  if (tons?.[1]) return parseFloat(tons[1]);
  return null;
}

interface ProcessCostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  editData?: any;
  bomItemData?: any;
  existingProcesses?: any[];
  defaultLocation?: string | undefined;
  currencySymbol?: string;
  // amount_usd × conversionRate = amount in `currencySymbol`'s currency —
  // machineRate/laborRate/totalCost computed in this dialog are always in
  // USD (process_cost_records' own rate columns, and the /process-costs/
  // calculate engine that operates on them) regardless of Digital Factory,
  // so displaying them under a non-USD currencySymbol requires this to
  // actually convert them, not just relabel them.
  conversionRate?: number;
  // When true, the dialog opens straight into the Cycle Time calculator (auto-
  // selected calculator, auto-filled from BOM data) instead of the plain edit
  // form — for callers whose entry point IS the cycle-time calculator icon.
  autoOpenCalculator?: boolean;
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
  conversionRate = 1,
  autoOpenCalculator,
}: ProcessCostDialogProps) {
  const [opNbr, setOpNbr] = useState<number>(0);
  // Locked to the Digital Factory location — no independent state. A free
  // per-row location override (formerly a Select with "🌍 All locations" +
  // 10 hardcoded countries) let a process line's MHR resolve against India
  // while its LHR silently fell through to an unscoped cross-country
  // benchmark (e.g. China) — the exact "MHR India / LHR China, doubled
  // total cost" bug. The rest of this dialog (filteredMHR, and
  // resolveMHRRates/resolveLHRRates server-side) already refuses to widen
  // across location once one is set; the only leak was this field letting
  // `location` become '' ("all locations") or a country the Digital Factory
  // isn't even set to. Deriving it directly from defaultLocation closes that.
  const location = defaultLocation ?? '';
  // Process selection — the SAME two things the HR Rates database is organised
  // by, read from mhr_records itself:
  //   Process  = mhr_records.process_group   ('Sheet Metal')
  //   Category = the real machine category   ('3 Roll Bender')
  // Category is not a raw column: it is benchmark_source_key up to the first
  // colon when the row matched the reference library, else machine_class through
  // mhrCategoryOf. Backend getDistinctCategories resolves it identically, so the
  // suggestion list and each row's own displayed category always agree.
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedProcessCalculatorId, setSelectedProcessCalculatorId] = useState<string>('');

  // Preserved, NOT edited. Older rows were configured through the retired
  // Group -> Process Route -> Operation cascade and still carry those values;
  // migration 719 deliberately leaves both columns alone. They are loaded from
  // the record being edited and written back unchanged on save, so re-saving an
  // old line through the new two-field form never blanks the identity it was
  // originally created with. Empty for anything created from here on.
  const [savedProcessRoute, setSavedProcessRoute] = useState<string>('');
  const [savedOperation, setSavedOperation] = useState<string>('');

  // Resource selections
  const [selectedMHRId, setSelectedMHRId] = useState<string>('');
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

  // Prevents the full pickers from flashing empty before the load effect fires in edit mode.
  // false = load effect hasn't run yet for this open; true = fields are populated from editData.
  const [editDataApplied, setEditDataApplied] = useState(false);
  // When true, show the catalog pickers instead of a read-only "Saved process" panel (after Re-select click)
  // reSelectMode was here: the flag that swapped the read-only "Saved process"
  // panel for the real pickers. The pickers are always shown now, so there is
  // no second mode to be in.

  // Preserve facilityId and facilityRateId from editData for updates
  const [facilityId, setFacilityId] = useState<string | undefined>(undefined);
  const [facilityRateId, setFacilityRateId] = useState<string | undefined>(undefined);

  // Calculator state
  const [calculatorOpen, setCalculatorOpen] = useState<boolean>(false);
  const [calculatorTarget, setCalculatorTarget] = useState<string | null>(null);
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<string>('');
  const [calculatorInputs, setCalculatorInputs] = useState<Record<string, any>>({});
  // autoPopulateFromBOM runs from two separate effects (immediate + a 100ms
  // delayed retry) and does async lookups in between — a closure over the
  // `calculatorInputs` state variable goes stale mid-flight, so a later plain
  // setCalculatorInputs(newInputs) call can clobber an earlier async lookup's
  // result (e.g. Cutting Speed lands but Piercing Time Per Start's write gets
  // overwritten back to blank). This ref always holds the true latest value.
  const calculatorInputsRef = useRef(calculatorInputs);
  useEffect(() => {
    calculatorInputsRef.current = calculatorInputs;
  }, [calculatorInputs]);
  // One-line provenance per auto-filled input field (which DB row / BOM
  // feature it came from) — rendered as a "Why:" caption under the field so
  // the engineer can see it's a real lookup/CAD value, not a guess, and can
  // check it against the machine plate the same way the machine-recommendation
  // panel's own "Why:" line works.
  const [calculatorInputProvenance, setCalculatorInputProvenance] = useState<Record<string, string>>({});
  const calculatorInputProvenanceRef = useRef<Record<string, string>>({});
  useEffect(() => {
    calculatorInputProvenanceRef.current = calculatorInputProvenance;
  }, [calculatorInputProvenance]);
  // Snapshot of the EXACT sm_lookup_* row each lookup-populated field
  // resolved to (its non-output key columns, e.g. { thicknessMm: 1,
  // laserPowerW: 6000, material: 'Carbon Steel' }) — the "Why:" text already
  // discloses this in prose, but with a stepped table seeding dozens of
  // thickness×power combos per material, finding the ONE matching row by
  // eye in the "eye" button's full table view was the actual ask here.
  // Lets the viewer highlight/scroll to it instead of the engineer having
  // to re-derive the match themselves.
  const [calculatorMatchedRowKeys, setCalculatorMatchedRowKeys] = useState<Record<string, Record<string, any>>>({});
  // Scrolls the "eye" viewer straight to the highlighted (currently-used)
  // row when it opens — see the matchedCurrentRowRef assignment below.
  const matchedCurrentRowRef = useRef<HTMLTableRowElement | null>(null);
  // True once the engineer explicitly picks a calculator — prevents auto-select
  // from overwriting a manual choice.
  const [userOverrodeCalculator, setUserOverrodeCalculator] = useState(false);
  const [calculatorResults, setCalculatorResults] = useState<Record<string, any> | null>(null);
  // Surfaces execute() request-level failures (network/validation errors) —
  // without this, a failed Calculate silently leaves every field showing
  // "N/A" with no indication anything went wrong.
  const [calculatorError, setCalculatorError] = useState<string | null>(null);
  const [selectedLookupField, setSelectedLookupField] = useState<any>(null);
  const [showLookupTable, setShowLookupTable] = useState<boolean>(false);
  const [lookupTableData, setLookupTableData] = useState<any>(null);

  // ─── ONE architecture: HR Rates (mhr_records) drives this whole dialog ────
  //
  // Process and Category are read straight from the machine database the
  // dialog then resolves a machine and a rate from, so there is no second
  // description of the shop floor to disagree with it. This replaces a
  // three-level Group -> Process Route -> Operation cascade read from the
  // process_calculator_mappings catalog, which was a parallel taxonomy
  // maintained by hand: its Route level carried nothing the engineer used
  // (it existed only to reach the Operation under it) and its names drifted
  // from the HR Rates names for the same machine.
  //
  // Not is_active-gated, and deliberately so: is_active on the calculator
  // catalog means "a calculator is wired to this route", which is a different
  // question from "does this shop have real machines on file for this
  // process". Migration 691 left every Machining catalog row inactive while
  // 141 real Machining machines already existed in mhr_records.
  // ONE query. Process, Category and the Machine list are all derived from these
  // same rows, so the three can never disagree with each other or with what the
  // HR Rates page shows -- that page issues the identical query and derives its
  // own grouping through the same shared module.
  //
  // location IS pushed to the server: it is the real scope of a costed line (the
  // Digital Factory) and the filter that actually reduces the table.
  //
  // Process group is deliberately NOT pushed down. The backend filter is an exact
  // `process_group = ...` match, but that column was only ever populated by
  // migrations 130, 646/647 and 694, each for a specific set of rows; everything
  // imported before them carries its group in commodity_code instead. Sending it
  // silently drops the large majority of real rows -- the same trap the HR Rates
  // page documents at its own query. effectiveProcessGroupOf applies the real
  // fallback client-side instead.
  //
  // The /mhr/process-groups and /mhr/categories endpoints are unused here for
  // the same reason: both read the raw process_group column, so both are blind
  // to every commodity-code-only group. Reading the rows themselves is the only
  // derivation that matches what the machine list can actually offer.
  const MHR_FETCH_LIMIT = 10000;
  const {
    data: mhrData,
    isLoading: isLoadingMHR,
    error: mhrError,
  } = useMHRRecords(
    { ...(location ? { location } : {}), limit: MHR_FETCH_LIMIT },
    { enabled: open },
  );

  const mhrRecords = useMemo(() => mhrData?.records ?? [], [mhrData]);

  // Every list below is built from this one page of rows, so if the table ever
  // outgrows it a real machine could be missing from a dropdown. Say so rather
  // than presenting a short list as the whole truth.
  const mhrTruncated = !!mhrData && (mhrData.total ?? 0) > mhrRecords.length;

  const processGroups = useMemo(() => processGroupOptionsFrom(mhrRecords), [mhrRecords]);
  const categories = useMemo(
    () => categoryOptionsFrom(mhrRecords, selectedGroup),
    [mhrRecords, selectedGroup],
  );

  const isLoadingCatalog = isLoadingMHR;
  const isLoadingCategories = isLoadingMHR;
  const catalogError = (mhrError as Error | null) ?? null;

  // The calculator catalog is still fetched — but only to answer ONE question
  // now: which calculator (and which lhr_process_group) belongs to the
  // machine_class of the machine actually selected below. It no longer feeds
  // any dropdown, so it is no longer a second taxonomy; machine_class is a
  // real column on both mhr_records and process_calculator_mappings, which
  // makes it a genuine join rather than a name match.
  const { data: allMappingsData } = useProcessCalculatorMappings(
    { limit: 1000, isActive: true },
    { enabled: open },
  );

  // Benchmark MHR from DB, unfiltered by class. It cannot be filtered here any
  // more: machine_class is now read from the machine the engineer picks, which
  // is downstream of this fetch. filteredMHR narrows these rows to the chosen
  // Category instead — see byBmCategory, which matches them on the real classes
  // that category resolves to, since benchmark rows carry no benchmark_source_key
  // of their own to derive a category from.
  const { data: benchmarkMHR } = useMHRBenchmark(undefined, undefined, { enabled: open });
  // When editing, fetch the specific saved MHR/LHR so they always appear in their lists
  const savedMHRId = editData?.mhrId || editData?.machineId || '';
  const { data: savedMHRRecord } = useMHRRecord(savedMHRId, { enabled: !!savedMHRId && open });

  // Same "always appear in the list" guarantee as savedMHRRecord/savedLHRRecord
  // above, but for a saved benchmark (★) pick. filteredMHR narrows benchmark
  // rows to the classes the chosen Category resolves to — if the saved row's
  // machine_class was recorded differently (or the machine has since been
  // recategorised), that filter excludes it, so without this injection the
  // Select renders blank despite selectedMHRId correctly holding the id (see
  // savedBenchmarkMhrId usage in filteredMHR/LHR below). Only fetched
  // (unfiltered, matching migration 379's stored id verbatim — already prefixed
  // bm-mhr-/bm-lhr-) when there's actually a saved benchmark id to look for.
  const savedBenchmarkMhrId = editData?.benchmarkMhrId ? String(editData.benchmarkMhrId) : '';
  const { data: allBenchmarkMHR } = useMHRBenchmark(undefined, undefined, { enabled: open && !!savedBenchmarkMhrId });
  const savedBenchmarkMHRRecord = useMemo(
    () => (savedBenchmarkMhrId ? (allBenchmarkMHR ?? []).find((r) => String(r.id) === savedBenchmarkMhrId) ?? null : null),
    [allBenchmarkMHR, savedBenchmarkMhrId],
  );
  // limit:100 — the max the backend allows/clamps to (QueryCalculatorDto's
  // @Max(200), further clamped server-side to 100 by findAll's
  // `Math.min(query.limit || 10, 100)`). Without this, the backend instead
  // defaults to 10 per page ordered by created_at desc, so the dropdown
  // silently only ever shows the 10 most-recently-created calculators — an
  // auto-selected (or any older) calculator has no matching <SelectItem> to
  // render a label for (it still works — fields populate via the direct
  // by-id useCalculator fetch below — but LOOKS unselected in the UI).
  const { data: calculatorsData, isLoading: isLoadingCalculators, error: calculatorsError } = useCalculators({ limit: 100 });
  const { data: selectedCalculator } = useCalculator(selectedCalculatorId, { enabled: !!selectedCalculatorId });
  const executeCalculator = useExecuteCalculator();

  // The calculated field holding the effective cycle time is NOT named the
  // same across every manufacturing calculator: laser cutting and every
  // machining op (facing, turning, drilling, milling, tapping, ...) name it
  // 'Total Time', but the sheet-metal PROCESS calculators (Bending, TPP,
  // Stamping, Drawing/Forming — backend/migrations/calculators/009/008/010/012)
  // name it 'Cycle Time' instead — confirmed directly from those migrations'
  // own field_name inserts, not assumed. Checking only 'Total Time' silently
  // produced an empty Results panel and no "Computed Cycle Time"/"Use as
  // Cycle Time" section for all four of those, even though their formulas
  // evaluated fine server-side. Everything else on a calculator (Setup Time,
  // per-sub-step times like Cutting/Piercing Time) feeds INTO whichever of
  // these two fields exists, but isn't itself the cycle time. Deriving
  // "Computed Cycle Time" from that one field (rather than re-deriving it
  // here) means this summary can never drift from whatever formula the
  // calculator actually used.
  const CYCLE_TIME_FIELD_NAMES = ['Total Time', 'Cycle Time'];
  const computedCycleTime = useMemo(() => {
    if (!calculatorResults || !selectedCalculator?.fields) return null;
    const totalTimeField = selectedCalculator.fields.find((f: any) => CYCLE_TIME_FIELD_NAMES.includes(f.fieldName));
    if (!totalTimeField) return null;
    const raw = calculatorResults[totalTimeField.fieldName];
    const hasError = raw && typeof raw === 'object' && 'error' in raw;
    if (hasError) return null;
    const value = raw?.value !== undefined ? raw.value : raw;
    if (typeof value !== 'number' || !isFinite(value)) return null;

    // Unit is always seconds for this field ('sec' or 's' across every
    // calculator that defines it) — normalise to both sec and min.
    const totalTimeSec = value;
    const totalTimeMin = totalTimeSec / 60;
    const currentCycleTimeSec = parseFloat(cycleTime as string) || 0;
    const matchesCurrent = currentCycleTimeSec > 0 && Math.abs(totalTimeSec - currentCycleTimeSec) < 0.05;

    return {
      totalTimeSec,
      totalTimeMin,
      formula: totalTimeField.defaultValue || null,
      matchesCurrent,
      currentCycleTimeSec,
    };
  }, [calculatorResults, selectedCalculator?.fields, cycleTime]);

  // sourceField -> the extra fields the two-pass sm_lookup mechanism ABOVE
  // (see the lookupField/toolSetupField block) reads directly in JS to build
  // its lookup params — real dependencies of a lookup-populated field
  // (Time Per Stroke, Tool Loading Time) that formula-token parsing alone
  // can never see, since these fields carry no {…} formula themselves.
  // 'Selected Tonnage' is listed alongside 'Total Tonnage' because
  // handleExecuteCalculator's tonnage lookup now prefers it (the real
  // selected machine's rated capacity) over 'Total Tonnage' (this bend's own
  // theoretical minimum required force) — see that function's own doc
  // comment. Omitting it here was the reason 'Selected Tonnage' never
  // rendered in this popup at all: relevantFieldNames only shows a field
  // once something resolves it as a real dependency, so with no way to see
  // or fill it in, the tonnage lookup was always forced onto the (usually
  // sub-10T, never-matches-a-real-machine) theoretical estimate.
  const SM_LOOKUP_PARAM_DEPS: Record<string, string[]> = {
    manual_stroke: ['Thickness', 'Total Tonnage', 'Selected Tonnage', 'Complexity'],
    tool_setup: ['Total Tonnage', 'Selected Tonnage'],
  };

  // Same idea as SM_LOOKUP_PARAM_DEPS above, but keyed by fieldName instead
  // of sourceField — for auto-fill logic that reads sm_lookup_laser_cut/
  // sm_lookup_waterjet_cut directly in JS (below, ~line 1189) without the
  // field ever being marked dataSource='sheet_metal_lookup' in the DB (see
  // migration 378's own comment: Cutting Speed/Piercing Time Per Start are
  // plain 'number' fields — "the one remaining gap... is resolved entirely
  // on the frontend"). Without this, 'Laser Machine Power' — the ONLY
  // field the Cutting Speed/Piercing Time lookup reads to build its query —
  // was never a resolve()-visited dependency, so relevantFieldNames hid it
  // from this popup exactly like 'Selected Tonnage' was hidden before: no
  // way to see or fill it in, so with no verified machine capability
  // the lookup could never run and Cutting Speed/Piercing Time Per Start
  // stayed permanently blank.
  const FIELD_NAME_EXTRA_DEPS: Record<string, string[]> = {
    'Cutting Speed': ['Laser Machine Power'],
    'Piercing Time Per Start': ['Laser Machine Power'],
  };

  // When this popup was opened for a specific result (currently only Cycle
  // Time), show only the input fields that actually feed it — not every
  // field this same calculator also carries for tonnage/setup/labour math
  // unrelated to the requested value. Resolved by walking {Field Name}
  // formula references back from CYCLE_TIME_FIELD_NAMES' own field, plus the
  // sm_lookup param dependencies above for lookup-populated fields — never a
  // hardcoded per-calculator field list, so it degrades to "show everything"
  // for any calculator/target this can't confidently resolve.
  const relevantFieldNames = useMemo(() => {
    if (!selectedCalculator?.fields || calculatorTarget !== 'cycleTime') return null;
    const fields = selectedCalculator.fields as any[];
    const byName = new Map(fields.map((f) => [f.fieldName, f]));
    const targetField = fields.find((f) => CYCLE_TIME_FIELD_NAMES.includes(f.fieldName));
    if (!targetField) return null;

    const visited = new Set<string>();
    const resolve = (fieldName: string) => {
      if (visited.has(fieldName)) return;
      visited.add(fieldName);
      const f = byName.get(fieldName);
      if (!f) return;
      const formula = typeof f.defaultValue === 'string' ? f.defaultValue : '';
      for (const ref of formula.match(/\{([^}]+)\}/g) ?? []) resolve(ref.slice(1, -1));
      if (f.dataSource === SM_LOOKUP_DATA_SOURCE && f.sourceField) {
        for (const dep of SM_LOOKUP_PARAM_DEPS[f.sourceField] ?? []) resolve(dep);
      }
      for (const dep of FIELD_NAME_EXTRA_DEPS[fieldName] ?? []) resolve(dep);
    };
    resolve(targetField.fieldName);
    return visited;
  }, [selectedCalculator, calculatorTarget]);

  // Check for errors
  const hasErrors = mhrError || catalogError || calculatorsError;

  const getSuggestedOpNbr = () => {
    if (!existingProcesses || existingProcesses.length === 0) return 10;
    const maxOpNbr = Math.max(...existingProcesses.map(p => p.opNbr || 0));
    return maxOpNbr + 10;
  };


  // A saved value that HR Rates no longer lists must still be SHOWN.
  //
  // Both lists are the real HR Rates values plus, when the record being edited
  // carries a Process or Category that mhr_records no longer has, that value
  // appended and flagged. A machine retired from HR Rates is the known case,
  // along with every line created through the retired Group/Route/Operation
  // cascade whose Process was never an HR Rates process group at all
  // ("Packing & Delivery").
  //
  // Appending the unmatched value keeps the control usable AND keeps the saved
  // value visible. The alternative this dialog used to take -- hiding the
  // pickers behind a read-only "Saved process" panel -- traded one for the
  // other, leaving an engineer unable to see the real choices without first
  // clearing the selection.
  const withSaved = (list: string[], saved: string): string[] =>
    saved && !list.includes(saved) ? [...list, saved] : list;
  const groupOptions = useMemo(() => withSaved(processGroups, selectedGroup), [processGroups, selectedGroup]);
  const categoryOptions = useMemo(() => withSaved(categories, selectedCategory), [categories, selectedCategory]);
  /** True when this saved value is not in the live HR Rates list — shown on the option. */
  const notInCatalog = (list: string[], v: string) => !!v && !list.includes(v);


  // ─── filteredMHR ─────────────────────────────────────────────────────────────
  // Priority: 1) user's own mhr_records (location+group exact match)
  //           2) user's own mhr_records (location only)
  //           3) mhr_benchmark_rates DB table — location + category
  //           4) mhr_benchmark_rates DB table — location only (pre-selection)
  // Never falls back to hardcoded constants, and never widens across location.
  // True once the engineer has chosen both halves of the real selection.
  const processFullySelected = !!(selectedGroup && selectedCategory);

  // Legacy, non-machine lines. Raw Material intake, Packing & Delivery
  // logistics and the General/General placeholder are legitimately machineless
  // (backend migration 369's chk_machine_class_required exempts exactly these),
  // and each has its own dedicated dialog now — Raw Materials, Packaging &
  // Logistics. They can no longer be CREATED here, because HR Rates lists no
  // machine category for them, but an existing one must still open and re-save
  // without the dialog demanding a machine it was never supposed to have.
  const isNonMachineOperation = !!(
    savedProcessRoute === 'Raw Material' ||
    selectedGroup === 'Packing & Delivery' ||
    (savedProcessRoute === 'General' && savedOperation === 'General')
  );

  // The real machine_class values the chosen Category resolves to, taken from
  // the real records that ARE in that category — never assumed from the name.
  // A category can legitimately span more than one class, and one class spans
  // several categories (migration 569 maps both "3D Laser Cutting Machine" and
  // "Fiber Laser Cutting Machine" onto fiber_laser), so this is read in the one
  // direction that is unambiguous: from a row to its own class.
  // Both delegate to the shared HR Rates selection module, which is also what
  // the HR Rates page groups its own table with -- so a category offered here
  // and the machines shown under it cannot disagree with each other or with
  // that page.
  const matchesSelection = useCallback(
    (r: any): boolean => matchesProcessAndCategory(r, selectedGroup, selectedCategory),
    [selectedGroup, selectedCategory],
  );

  const categoryMachineClasses = useMemo(
    () => categoryMachineClassesOf(mhrRecords as any[], selectedGroup, selectedCategory),
    [mhrRecords, selectedGroup, selectedCategory],
  );

  const filteredMHR = useMemo(() => {
    // No machine ever applies to a Raw Material / Packing & Delivery / General-General
    // line — return no machines at all, including any previously-saved one, rather
    // than let it leak through via the "nothing to validate against" branch below.
    if (isNonMachineOperation) return [];
    const base = mhrRecords as any[];
    const bm   = benchmarkMHR ?? [];
    const locLower = location.toLowerCase();

    const byLoc = (arr: any[]) =>
      !location ? arr : arr.filter(r => (r.location ?? '').toLowerCase() === locLower);

    const byCategory = (arr: any[]) => {
      if (!processFullySelected) return arr;
      return arr.filter(matchesSelection);
    };

    // mhr_benchmark_rates rows have NO benchmark_source_key — only machine_class
    // — so mhrCategoryOf would humanise the slug ("Roll Bending 3") and never
    // match a real category name ("3 Roll Bender"), silently hiding every
    // benchmark machine. They are matched on the real classes the chosen
    // category actually resolves to instead: the same join by a different key,
    // not a looser one.
    const byBmCategory = (arr: any[]) => {
      if (!processFullySelected) return arr;
      return arr.filter(r => benchmarkMatchesCategory(r, categoryMachineClasses));
    };

    const withSavedMachines = (list: any[]) => {
      let result = list as any[];
      if (savedMHRRecord && !result.some((r: any) => String(r.id) === String(savedMHRRecord.id))) {
        // Don't inject a saved machine that isn't in the chosen category
        if (!selectedCategory || matchesSelection(savedMHRRecord as any)) {
          result = [savedMHRRecord, ...result];
        }
      }
      // Same safety net for a saved benchmark (★) pick — a benchmark row saved
      // under a different/since-changed machine_class would otherwise have no
      // matching <SelectItem>, leaving the Select rendered as if nothing were
      // chosen even though selectedMHRId correctly holds its id.
      if (savedBenchmarkMHRRecord && !result.some((r: any) => String(r.id) === String(savedBenchmarkMHRRecord.id))) {
        result = [savedBenchmarkMHRRecord, ...result];
      }
      return result;
    };

    // 1 & 2 — user's own records, location-scoped
    const dbLoc   = byLoc(base);
    const dbMatch = byCategory(dbLoc);
    const dbResult = dbMatch.length > 0 ? dbMatch : (dbLoc.length > 0 && !processFullySelected ? dbLoc : null);
    if (dbResult && dbResult.length > 0) return withSavedMachines(dbResult);

    // 3 & 4 — DB benchmark table (mhr_benchmark_rates)
    const bmLoc   = byLoc(bm);
    const bmMatch = byBmCategory(bmLoc);
    // Widening across category (bmLoc, pre-selection) is fine, but never across
    // LOCATION — falling back to the raw, every-country `bm` here (as this used
    // to) is the same "all country" leak this filter exists to prevent: an
    // applied/selected location must always be respected, even before a Process
    // and Category are chosen.
    const bmResult = bmMatch.length > 0 ? bmMatch : (bmLoc.length > 0 && !processFullySelected ? bmLoc : []);
    if (bmResult.length > 0) return withSavedMachines(bmResult);

    // Deliberately NO cross-location fallback here. A Digital Factory is
    // always set on the costed item, so "no machine for this location/category"
    // must show as an empty dropdown (with the manual-entry escape hatch
    // below), never silently widen to every country's machines — that silent
    // widening is exactly how a China labour rate ended up auto-selected for
    // an India-costed part.
    return withSavedMachines([]);
  }, [mhrRecords, benchmarkMHR, location, selectedCategory, categoryMachineClasses, matchesSelection, savedMHRRecord, savedBenchmarkMHRRecord, processFullySelected, isNonMachineOperation]);

  // ─── The machine decides the class, the class decides the rest ────────────
  // machine_class is read from the SELECTED MACHINE's own row rather than from a
  // catalog mapping, so everything downstream of the class -- the calculator
  // join and the labour rate -- resolves from the machine the engineer picked.
  const selectedMHR = useMemo(() => {
    return filteredMHR.find((r: any) => String(r.id) === String(selectedMHRId));
  }, [filteredMHR, selectedMHRId]);

  // The real cost-engine key. Preferred source is the machine actually chosen —
  // its own mhr_records.machine_class, which is a fact about that machine
  // rather than a catalog row's opinion about an operation. Before a machine is
  // chosen it falls back to the category's class only when the category
  // resolves to exactly one, the only case where that is not a guess.
  // ─── Labour: always the selected machine's own rate ──────────────────────
  //
  // There is no independent labour picker. A machine's labour rate is a real
  // column on its own HR Rates row -- mhr_records.usd_lhr_total, which is
  // machine_library's labor_rate_usd_hr or this shop's own shop_override /
  // imported / LHR-resolved value -- and bom-items.service.ts's
  // resolveMHRRates() already treats that specific rate as authoritative over
  // a generic (location, process_group) wage-grade lookup. This makes the
  // dialog agree with the engine instead of offering a second opinion.
  //
  // The removed second list (lhr_records + lhr_benchmark_rates, filtered by
  // lhr_process_group) was a parallel source for the same number and drifted
  // from the machine in both directions: it offered an unrelated "Sheet Metal
  // Fabricator -- $46.67/hr" alongside a machine whose own rate is $43.21, and
  // its positional auto-select left the field rendering as "Select labour type"
  // while a real rate was already being applied underneath -- the worst of both,
  // since the number being charged was invisible.
  const machineLabour = useMemo(() => {
    const rate = Number((selectedMHR as any)?.usdLhrTotal);
    if (!selectedMHR || !(rate > 0)) return null;
    const source = (selectedMHR as any).laborRateSource as string | undefined;
    return {
      rate,
      // The real labour classification HR Rates assigns this machine (its
      // "Wage Grade" column, e.g. "4 - Metal") -- a fact on the row, not a
      // separate labour record chosen alongside it.
      wageGrade: ((selectedMHR as any).wageGrade as string | undefined) || null,
      machineName: (selectedMHR as any).machineName as string | undefined,
      // Same ★ convention as every other isBenchmark check here: marks "not
      // this shop's own confirmed value", set only when the machine's OWN rate
      // came from a benchmark/reference tier.
      isBenchmark: source === 'benchmark' || source === 'lhr_benchmark',
    };
  }, [selectedMHR]);

  // Real hours/day this machine runs, straight off its own HR Rates row.
  // undefined (not a default) when nothing is selected or the row has no shift
  // pattern on file — see the save payload for why a default would be a lie.
  const shiftPatternHoursPerDayFromMachine = useMemo(() => {
    const shifts = Number((selectedMHR as any)?.shiftsPerDay);
    const hours  = Number((selectedMHR as any)?.hoursPerShift);
    if (!(shifts > 0) || !(hours > 0)) return undefined;
    return shifts * hours;
  }, [selectedMHR]);

  const selectedMachineClass = useMemo(() => {
    const fromMachine = (selectedMHR as any)?.machineClass;
    if (fromMachine) return String(fromMachine);
    if (categoryMachineClasses.size === 1) return [...categoryMachineClasses][0]!;
    return '';
  }, [selectedMHR, categoryMachineClasses]);

  // The catalog rows for this machine's class — the ONE thing still read from
  // process_calculator_mappings, joined on machine_class (a real column on both
  // tables) rather than on a name. One class can map to several catalog rows
  // (press_brake covers both "Bend Brake" and "Progressive Die Press"), so a
  // single row is only treated as authoritative when exactly one matches; the
  // ambiguous case is surfaced to the engineer rather than silently resolved.
  const calculatorMappingsForClass = useMemo(
    () => calculatorMappingsForMachineClass((allMappingsData?.mappings ?? []) as any[], selectedMachineClass),
    [allMappingsData, selectedMachineClass],
  );

  const selectedMapping = useMemo(
    () => unambiguousMapping(calculatorMappingsForClass),
    [calculatorMappingsForClass],
  );


  // ─── Calculator resolution ────────────────────────────────────────────────
  // Placed after the machine-class join above, which it now depends on.
  //
  // The calculator used to be found by (process group + route + operation).
  // With route and operation gone there is exactly one real key left that
  // exists on both tables: machine_class. That is a genuine join, not a name
  // match — mhr_records.machine_class for the chosen machine against
  // process_calculator_mappings.machine_class.
  const availableCalculators = calculatorMappingsForClass;

  // Every calculator ID used ANYWHERE within the current process group — scopes
  // the "Select Calculator" dropdown to the current process the same way MHR
  // and LHR are scoped, instead of listing all ~45 calculators across every
  // process (Machining, Injection Molding, Sheet Metal...) mixed together.
  const calculatorIdsForGroup = useMemo(() => {
    if (!selectedGroup || !allMappingsData?.mappings || !calculatorsData?.calculators) return null;
    const ids = new Set<string>();
    for (const mapping of allMappingsData.mappings) {
      if (mapping.processGroup !== selectedGroup) continue;
      if (mapping.calculatorId) {
        ids.add(mapping.calculatorId);
      } else if (mapping.calculatorName) {
        const match = calculatorsData.calculators.find((c: any) => c.name === mapping.calculatorName);
        if (match) ids.add(match.id);
      }
    }
    return ids;
  }, [selectedGroup, allMappingsData, calculatorsData]);

  const calculatorsForDropdown = useMemo(() => {
    const all = calculatorsData?.calculators ?? [];
    if (!calculatorIdsForGroup || calculatorIdsForGroup.size === 0) return all;
    return all.filter((c: any) => calculatorIdsForGroup.has(c.id));
  }, [calculatorsData, calculatorIdsForGroup]);

  const resolveCalculatorId = useCallback((mapping: any): string | null => {
    if (!mapping) return null;
    if (mapping.calculatorId) return mapping.calculatorId;
    // calculator_id is null in most seeded mapping rows — resolve by name instead.
    if (mapping.calculatorName && calculatorsData?.calculators) {
      return calculatorsData.calculators.find((c: any) => c.name === mapping.calculatorName)?.id ?? null;
    }
    return null;
  }, [calculatorsData]);

  // Auto-selected ONLY when the machine class maps to exactly one catalog row,
  // which is the only case where the answer is a fact rather than a preference.
  //
  // machine_class is deliberately a many-operations-to-one-class cost-engine
  // grouping: press_brake covers both "Bend Brake" and "Progressive Die Press",
  // and those two are priced by genuinely different formulas. Silently taking
  // the first by display_order would let a press-brake part be costed with the
  // progressive-die calculator with nothing on screen saying so. When the class
  // is ambiguous this stays null and the candidates are listed for the engineer
  // to choose from (see ambiguousCalculatorChoices below).
  const defaultCalculatorForOperation = useMemo(
    () => resolveCalculatorId(selectedMapping),
    [selectedMapping, resolveCalculatorId],
  );

  // The real, named alternatives behind an ambiguous machine class, each paired
  // with the calculator it would apply — shown to the engineer instead of one
  // being picked for them. Empty whenever the class is unambiguous.
  const ambiguousCalculatorChoices = useMemo(() => {
    if (calculatorMappingsForClass.length < 2) return [] as { operation: string; calculatorId: string | null; calculatorName: string }[];
    return calculatorMappingsForClass.map((m: any) => ({
      operation: String(m.operation ?? '—'),
      calculatorId: resolveCalculatorId(m),
      calculatorName: String(m.calculatorName ?? ''),
    }));
  }, [calculatorMappingsForClass, resolveCalculatorId]);



  // Open an existing line with its Process and Category already filled in, even
  // when the record itself does not carry them.
  //
  // Neither is guaranteed to be stored: `category` only exists from migration
  // 719 onward, and `process_group` is genuinely empty on plenty of real rows
  // (it was never a required column on process_cost_records). Both are read off
  // the machine the line is ALREADY linked to instead — a fact recorded on that
  // line, resolved by the same two functions the pickers themselves use, so the
  // derived values are always real options rather than "saved, not in HR Rates"
  // strays.
  //
  // This is not cosmetic. Everything downstream keys off Process: the Category
  // list, the Machine list, the Labour list and the machine-class join all
  // narrow by it, so an empty Process opened a line showing an unrelated
  // process's machine and labour rate (confirmed live: a 3 Roll Bender line
  // offering "Mikron HSM 400 w Rotary Table" and "Skilled CNC").
  //
  // Runs at most once per open, tracked by a ref rather than by the fields
  // being empty: gating on emptiness would re-fill a field the engineer had
  // just deliberately cleared to re-pick.
  const backfilledFromMachineRef = useRef(false);
  useEffect(() => {
    if (!open) {
      backfilledFromMachineRef.current = false;
      return;
    }
    if (backfilledFromMachineRef.current) return;
    if (!editData || !editDataApplied || !savedMHRRecord) return;

    const derivedGroup = effectiveProcessGroupOf(savedMHRRecord as any);
    const derivedCategory = mhrCategoryOf(savedMHRRecord as any);
    let didBackfill = false;
    if (!selectedGroup && derivedGroup !== '-') {
      setSelectedGroup(derivedGroup);
      didBackfill = true;
    }
    if (!selectedCategory && derivedCategory !== '-') {
      setSelectedCategory(derivedCategory);
      didBackfill = true;
    }
    if (didBackfill || (selectedGroup && selectedCategory)) {
      backfilledFromMachineRef.current = true;
    }
  }, [open, editData, editDataApplied, savedMHRRecord, selectedGroup, selectedCategory]);

  // Auto-select the top MHR match. Re-fires when the Category changes, so the
  // machine always belongs to the category actually chosen. Clears a stale
  // selection if it is no longer in the filtered list.
  useEffect(() => {
    // Gated on the real selection (Process + Category) being complete, which
    // is exactly when filteredMHR is meaningful.
    //
    // It must NOT be gated on selectedMachineClass any more. That guard used to
    // be correct because filteredMHR was filtered BY the class, so acting before
    // the class resolved would auto-pick from a wrongly-filtered list and
    // overwrite a real saved machine (confirmed live: editing a saved Laser
    // Cutting row lost "Salvagnini L3-30 Fiber", leaving the calculator with no
    // machine to read Cutting Speed / Laser Power from). filteredMHR is filtered
    // by Category now, and the class is read off the machine THIS effect picks —
    // so waiting on the class would deadlock every category that spans more than
    // one class: no machine selected, so no class, so no machine ever selected.
    if (!processFullySelected || userOverrodeMHR) return;
    const currentValid = selectedMHRId && filteredMHR.some(r => String(r.id) === String(selectedMHRId));
    if (!currentValid && filteredMHR.length > 0) {
      setSelectedMHRId(String(filteredMHR[0].id));
    }
  }, [processFullySelected, filteredMHR, userOverrodeMHR, selectedMHRId]);


  // Reset the calculator override whenever the process identity changes, OR
  // whenever a different field's calculator is opened — userOverrodeCalculator
  // is one shared flag across every calculator popup in this dialog (Cycle
  // Time, Machine Value, ...), so without resetting on calculatorTarget too, a
  // manual pick (or even just re-picking the same value) made in ANY OTHER
  // field's calculator permanently blocks the Cycle Time popup's auto-select
  // for the rest of the editing session — it shows a blank "Choose a
  // calculator" forever even though the operation has a real mapped default,
  // since selectedCalculatorId itself was already cleared to '' on close.
  useEffect(() => {
    setUserOverrodeCalculator(false);
  }, [selectedGroup, selectedCategory, calculatorTarget]);

  // Auto-select the calculator mapped to this operation when opening the Cycle
  // Time calculator — skip only if the engineer explicitly picked a different one.
  useEffect(() => {
    if (!calculatorOpen || calculatorTarget !== 'cycleTime') return;
    if (userOverrodeCalculator) return;
    if (defaultCalculatorForOperation && selectedCalculatorId !== defaultCalculatorForOperation) {
      setSelectedCalculatorId(defaultCalculatorForOperation);
    }
  }, [calculatorOpen, calculatorTarget, userOverrodeCalculator, defaultCalculatorForOperation, selectedCalculatorId]);

  // The saved machine belongs to a different class than the one now in play —
  // which, since Category drives the list, means it is not in the chosen
  // Category. Clear it so auto-select can pick a machine that really is.
  useEffect(() => {
    if (!savedMHRRecord || !selectedMachineClass || userOverrodeMHR) return;
    const savedClass = (savedMHRRecord as any).machineClass;
    if (savedClass && savedClass !== selectedMachineClass) {
      setSelectedMHRId('');
    }
  }, [savedMHRRecord, selectedMachineClass, userOverrodeMHR]);

  // Calculator handlers
  // Values coming from a calculator's own "Use" button are raw formula results
  // (e.g. a division like Cutting Length / Cutting Speed) — full floating-point
  // precision (1.3796428571428572), not something meant for a form field. Round
  // to 2dp here, at the one place every "Use"/"Use as Cycle Time" click funnels
  // through, rather than relying on each input's own display formatting to hide it.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const handleCalculatorValue = (value: number | string) => {
    if (calculatorTarget === 'setupManning') setSetupManning(round2(Number(value)));
    else if (calculatorTarget === 'setupTime') setSetupTime(round2(Number(value)));
    else if (calculatorTarget === 'batchSize') setBatchSize(round2(Number(value)));
    else if (calculatorTarget === 'cycleTime') setCycleTime(round2(Number(value)));
    else if (calculatorTarget === 'partsPerCycle') setPartsPerCycle(round2(Number(value)));
    else if (calculatorTarget === 'heads') setHeads(round2(Number(value)));
    else if (calculatorTarget === 'scrap') setScrap(round2(Number(value)));
    else if (calculatorTarget === 'machineValue') setMachineValue(round2(Number(value)));
    // No 'operation' target any more: Operation is not a field on this form.
    // Process and Category are chosen from HR Rates and a calculator has no
    // business rewriting either of them.
    else if (calculatorTarget === 'processCalculator') {
      // For process calculator, the value is used automatically from calculator results
      // The calculator ID is already set, so we just close the panel
      // The actual values would be set from calculator results in handleExecuteCalculator
    }

    setCalculatorOpen(false);
    setCalculatorResults(null);
    setCalculatorError(null);
    setCalculatorInputs({});
    setCalculatorInputProvenance({});
    // Don't reset selectedCalculatorId for processCalculator as we want to keep it selected
    if (calculatorTarget !== 'processCalculator') {
      setSelectedCalculatorId('');
    }
    setCalculatorTarget(null);
  };

  const handleExecuteCalculator = async () => {
    if (!selectedCalculatorId) return;
    setCalculatorError(null);
    try {
      const result = await executeCalculator.mutateAsync({
        calculatorId: selectedCalculatorId,
        inputValues: calculatorInputs,
      });
      if (!result.success) {
        setCalculatorError('Calculation failed — the server did not return a result.');
        return;
      }

      // Some fields (e.g. Stroke Time Per Bend) depend on a value — Total
      // Tonnage — that only exists AFTER this first execute() pass computes it;
      // the generic mathjs engine can't call an external lookup mid-formula.
      // Resolve it now from the real sm_lookup_manual_stroke table and re-run
      // execute() so downstream formulas (Cycle Time) see the real number
      // instead of the "undefined variable" error this first pass left it with.
      // Scoped to sourceField === 'manual_stroke' specifically — other
      // sheet_metal_lookup fields (stroke_rate, laser_cut, etc.) need different
      // resolution params and aren't handled by this pass.
      const lookupField = selectedCalculator?.fields?.find(
        (f: any) => f.dataSource === SM_LOOKUP_DATA_SOURCE && f.sourceField === 'manual_stroke' && !calculatorInputs[f.fieldName]
      );

      // Same reasoning, for Stamping/Drawing-Forming's "Tool Loading Time":
      // Lookup Table 3A (press) is keyed by required tonnage, not known until
      // this same first execute() pass computes Total Tonnage. Bending's own
      // "Tool Loading Time" (Table 3B, keyed by tool/bend length) already
      // resolves upfront in autoPopulateFromBOM, so by the time this runs its
      // input is already filled and this correctly finds nothing to do there.
      const toolSetupField = selectedCalculator?.fields?.find(
        (f: any) => f.dataSource === SM_LOOKUP_DATA_SOURCE && f.sourceField === 'tool_setup' && !calculatorInputs[f.fieldName]
      );

      if (lookupField || toolSetupField) {
        const thickness = parseFloat(calculatorInputs['Thickness']);
        // sm_lookup_manual_stroke/tool_setup are keyed by a real MACHINE's
        // tonnage class, not by this bend's own theoretical minimum required
        // force ('Total Tonnage' — often well under 10T, which no real
        // commercial press brake is even rated for). Prefer 'Selected
        // Tonnage' (the currently selected machine's real rated capacity,
        // populated in autoPopulateFromBOM below) the same way
        // bom-items.service.ts's resolveStrokeLookupTonnage already does
        // server-side; fall back to the theoretical requirement only when no
        // machine is selected.
        const selectedTonnage = Number(calculatorInputs['Selected Tonnage']);
        const requiredTonnage = Number(result.results?.['Total Tonnage']);
        const tonnage = selectedTonnage > 0 ? selectedTonnage : requiredTonnage;
        const complexity = String(calculatorInputs['Complexity'] || 'Simple').toLowerCase();
        let updatedInputs = { ...calculatorInputs };
        let changed = false;

        if (lookupField && thickness > 0 && tonnage > 0) {
          const lookupTable = `sm_lookup_${lookupField.sourceField || 'manual_stroke'}`;
          const lookup = await calculatorsApi.sheetMetalLookup(
            lookupField.sourceField || 'manual_stroke',
            { thickness_mm: thickness, tonnage, complexity },
          );
          if (typeof lookup?.value === 'number') {
            updatedInputs[lookupField.fieldName] = lookup.value;
            changed = true;
            const rowCols = extractRowColumns((lookup as any).row);
            if (rowCols) setCalculatorMatchedRowKeys((prev) => ({ ...prev, [lookupField.fieldName]: rowCols }));
          } else {
            // Manufacturing Physics Calculator architecture: no seeded row for
            // these real inputs — report the gap plainly (table + the exact
            // inputs that missed + required action) instead of substituting a
            // guessed per-thickness constant or letting the formula fail with
            // an opaque "undefined symbol" error.
            setCalculatorError(
              `Cycle time unavailable — no seeded row in ${lookupTable} for thickness ${thickness}mm, ` +
              `tonnage ${tonnage}T, ${complexity} complexity. Add real data to this table to resolve.`,
            );
            return;
          }
        }

        if (toolSetupField && tonnage > 0) {
          const lookup = await calculatorsApi.sheetMetalLookup('tool_setup', { setup_type: 'press', key_value: tonnage });
          if (typeof lookup?.value === 'number') {
            updatedInputs[toolSetupField.fieldName] = lookup.value;
            changed = true;
            const rowCols = extractRowColumns((lookup as any).row);
            if (rowCols) setCalculatorMatchedRowKeys((prev) => ({ ...prev, [toolSetupField.fieldName]: rowCols }));
          } else {
            setCalculatorError(
              `Setup time unavailable — no seeded row in sm_lookup_tool_setup for tonnage ${tonnage}T. ` +
              `Add real data to this table to resolve.`,
            );
            return;
          }
        }

        if (changed) {
          setCalculatorInputs(updatedInputs);
          const finalResult = await executeCalculator.mutateAsync({
            calculatorId: selectedCalculatorId,
            inputValues: updatedInputs,
          });
          if (finalResult.success) setCalculatorResults(finalResult.results);
          return;
        }
      }

      setCalculatorResults(result.results);
    } catch (error: any) {
      // Surface request-level failures (network error, 400/500 from the
      // backend) instead of silently leaving every field showing "N/A" with
      // no indication anything went wrong.
      setCalculatorError(error?.message || 'Calculation request failed.');
    }
  };

  // Auto-populate calculator inputs from BOM data
  const autoPopulateFromBOM = async () => {
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
      // "Length" collides across calculators: on most it means the part's
      // overall length, but on Machining - Tapping it means the tap's
      // engagement depth (its own formula: Machining Time = f(Length + 4mm
      // lead-in)) -- excluded here and set correctly (to sheet thickness)
      // in the Tapping-specific block below instead.
      ...(selectedCalculatorId !== 'fe42139c-5675-4a82-94d5-7f2d440ae9bf'
        ? { 'Length': bomItemData.length || bomItemData.maxLength }
        : {}),
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

      // Sheet-metal CAD geometry mappings (real, per-part values — only mapped
      // where a corresponding calculator field exists and the concept is
      // unambiguous; flatPatternAreaMm2/holeCount are deliberately NOT mapped
      // here, see ProcessCostDialog plan notes).
      'Cutting Length': bomItemData.cutLengthMm,
      'Length Of Cut (mm)': bomItemData.cutLengthMm,
      'Length Of Cut': bomItemData.cutLengthMm,
      'No Of Starts': bomItemData.pierceCount,
      'No Of Bends': bomItemData.bendCount,
      'Thickness': bomItemData.sheetThicknessMm,
      'Thickness (mm)': bomItemData.sheetThicknessMm,
      // Longest flat-pattern edge as a bend-line proxy — the SAME conservative
      // approximation (real per-bend lengths aren't tracked in the feature
      // graph yet) already used server-side for press-brake tonnage/capability
      // checks (bom-items.service.ts's capabilityGeometry.bendLengthMm and its
      // machine-selection requirement), not a new/independent guess.
      ...(bomItemData.bendCount > 0 && (bomItemData.maxLength || bomItemData.maxWidth)
        ? {
            'Bending Line Length': Math.max(bomItemData.maxLength || 0, bomItemData.maxWidth || 0),
            'Bending Line Length (mm)': Math.max(bomItemData.maxLength || 0, bomItemData.maxWidth || 0),
          }
        : {}),
      // V-die shoulder/opening width = 8 × sheet thickness — the same industry
      // rule of thumb already used server-side for press-brake tonnage
      // estimation (default-rates.ts's estimateBendTonnage: "V-die opening V
      // = 8 × t"), not a new/independent guess.
      ...(bomItemData.sheetThicknessMm > 0
        ? {
            'Shoulder Width': 8 * bomItemData.sheetThicknessMm,
            'Shoulder Width (mm)': 8 * bomItemData.sheetThicknessMm,
          }
        : {}),
      // Real batch size already entered in this same dialog's main form — not a
      // second, independently-guessed lot size for the calculator.
      'Lot Size': batchSize,

      // MHR/LHR per Hour: the real effective rates resolved above in this
      // same dialog ($40.00/hr, $46.67/hr etc.) — not each calculator's own
      // generic seeded default (was a flat 91.6/96.14, silently wrong for
      // every currency/machine/labour combination that isn't whatever the
      // calculator was originally authored against).
      ...(effectiveMachineRate > 0 ? { 'MHR per Hour': effectiveMachineRate } : {}),
      ...(effectiveLaborRate > 0 ? { 'LHR per Hour': effectiveLaborRate } : {}),

      // "Sheet Metal - Inspection" calculator fields — sourced from the SAME
      // real, already-sampled feature counts and method-resolved per-feature
      // times shown in the Feature breakdown panel (threaded in via
      // editData.featureBreakdown by page.tsx's Calculator-button handler),
      // not re-derived or re-guessed here. Absent entirely for any other
      // process type, so this is a no-op everywhere else.
      ...(Array.isArray(editData?.featureBreakdown) ? (() => {
        const fb = editData.featureBreakdown as Array<{ name: string; timeSec: number; featureType: string; count: number }>;
        const byType = (t: string) => fb.find((f) => f.featureType === t);
        const methodEntry = fb.find((f) => f.featureType === 'inspection_method');
        const hole = byType('hole');
        const bend = byType('bend');
        const thread = byType('thread');
        const thickness = byType('thickness');
        const dimension = byType('dimension');
        const visualBase = byType('visual_base');
        return {
          'Method': methodEntry ? methodEntry.name.replace(/^Method:\s*/, '') : undefined,
          'Visual Pass Base': visualBase?.timeSec,
          'Holes to Inspect': hole?.count ?? 0,
          'Hole Check Time': hole?.timeSec ?? 0,
          'Bends to Inspect': bend?.count ?? 0,
          'Bend Check Time': bend?.timeSec ?? 0,
          'Threads to Inspect': thread?.count ?? 0,
          'Thread Gauge Time': thread?.timeSec ?? 0,
          'Has Thickness Check': thickness ? 1 : 0,
          'Thickness Check Time': thickness?.timeSec ?? 0,
          'Has Dimension Check': dimension ? 1 : 0,
          'Dimension Check Time': dimension?.timeSec ?? 0,
        };
      })() : {}),

      // "Sheet Metal - PEM Insertion" calculator fields — sourced from the real
      // sm_lookup_pem_hardware match(es) for this line's holes (threaded in via
      // editData.featureBreakdown's 'pem_insertion' rows — see
      // bom-items.service.ts's buildPemFeatureBreakdown), not the calculator
      // schema's blank/"1" placeholder. The calculator only has ONE Insertion
      // Cycle Time / No Of Insertions pair, so when a part matches more than one
      // distinct PEM hardware spec (different hole diameters), this collapses to
      // the total count and a weighted-average per-insertion time — their product
      // still reproduces the real total seconds; provenance says so explicitly
      // rather than implying a single uniform spec.
      ...(Array.isArray(editData?.featureBreakdown) ? (() => {
        const pemRows = (editData.featureBreakdown as Array<{ name: string; timeSec: number; featureType: string; count: number }>)
          .filter((f) => f.featureType === 'pem_insertion');
        if (pemRows.length === 0) return {};
        const totalCount = pemRows.reduce((s, r) => s + r.count, 0);
        const totalSec = pemRows.reduce((s, r) => s + r.timeSec, 0);
        if (totalCount === 0) return {};
        return {
          'Insertion Cycle Time': totalSec / totalCount,
          'No Of Insertions': totalCount,
        };
      })() : {}),
    };

    // Parallel human-readable source for each bomFieldMapping key above — shown
    // as a "Why:" caption under the field, same idea as the machine-recommendation
    // panel's own "Why: ..." reasoning line, so every auto-filled number is
    // traceable back to the part's CAD geometry instead of looking like a guess.
    const bomFieldProvenance: Record<string, string> = {
      'weight': 'CAD/BOM part weight', 'unitWeight': 'CAD/BOM part weight', 'Weight': 'CAD/BOM part weight', 'Weight(kg)': 'CAD/BOM part weight',
      'length': 'CAD/BOM part geometry — length', 'maxLength': 'CAD/BOM part geometry — max length', 'Length': 'CAD/BOM part geometry — length', 'Max Length': 'CAD/BOM part geometry — max length', 'Max Length(mm)': 'CAD/BOM part geometry — max length',
      'width': 'CAD/BOM part geometry — width', 'maxWidth': 'CAD/BOM part geometry — max width', 'Width': 'CAD/BOM part geometry — width', 'Max Width': 'CAD/BOM part geometry — max width', 'Max Width(mm)': 'CAD/BOM part geometry — max width',
      'height': 'CAD/BOM part geometry — height', 'maxHeight': 'CAD/BOM part geometry — max height', 'Height': 'CAD/BOM part geometry — height', 'Max Height': 'CAD/BOM part geometry — max height', 'Max Height(mm)': 'CAD/BOM part geometry — max height',
      'surfaceArea': 'CAD feature extraction — surface area', 'Surface Area': 'CAD feature extraction — surface area', 'Surface Area(mm²)': 'CAD feature extraction — surface area',
      'Cutting Length': 'CAD feature extraction — total cut path length', 'Length Of Cut (mm)': 'CAD feature extraction — total cut path length', 'Length Of Cut': 'CAD feature extraction — total cut path length',
      'No Of Starts': 'CAD feature extraction — pierce/start count', 'No Of Bends': 'CAD feature extraction — bend count',
      'Thickness': 'BOM sheet thickness', 'Thickness (mm)': 'BOM sheet thickness',
      'Bending Line Length': 'CAD/BOM part geometry — longest flat-pattern edge (bend-line proxy, same value machine selection already uses)',
      'Bending Line Length (mm)': 'CAD/BOM part geometry — longest flat-pattern edge (bend-line proxy, same value machine selection already uses)',
      'Shoulder Width': 'V-die opening = 8 × sheet thickness (same rule of thumb machine selection already uses)',
      'Shoulder Width (mm)': 'V-die opening = 8 × sheet thickness (same rule of thumb machine selection already uses)',
      'Lot Size': 'Batch Size entered above in this process cost form',
      // Mirrors the EXACT same fallback chain effectiveMachineRate/
      // effectiveLaborRate use (selectedMHR -> editData.machineName -> manual
      // entry -> unlinked), so when nothing is actively selected in the
      // Machine/Labour Type dropdowns (e.g. the saved machine isn't in the
      // current filtered list), this note names the SAME machine the applied
      // rate really came from, not a vague "selected machine" that doesn't
      // match what's actually being costed.
      'MHR per Hour': `Applied machine rate — ${
        selectedMHR ? selectedMHR.machineName
        : editData?.machineName ? editData.machineName
        : manualMhrRate ? 'Manual entry'
        : describeUnlinkedRateProvenance()
      }${
        selectedMHR?.location ? ` · ${selectedMHR.location}`
        : editData?.location ? ` · ${editData.location}`
        : location ? ` · ${location}`
        : ''
      } (Resources & Location above)`,
      'LHR per Hour': `Applied labour rate — ${
        machineLabour
          ? `${machineLabour.machineName ?? 'selected machine'}${machineLabour.wageGrade ? ` · wage grade ${machineLabour.wageGrade}` : ''}`
        : editData?.laborType ? editData.laborType
        : manualLhrRate ? 'Manual entry'
        : describeUnlinkedRateProvenance()
      }${
        selectedMHR?.location ? ` · ${selectedMHR.location}`
        : editData?.location ? ` · ${editData.location}`
        : location ? ` · ${location}`
        : ''
      } (Resources & Location above)`,
      'Method': 'Inspection Engine — method escalated from tolerance/GD&T (Feature breakdown panel)',
      'Visual Pass Base': 'Inspection Engine — Feature breakdown panel',
      'Holes to Inspect': 'Inspection Engine — sampled hole count (Feature breakdown panel)',
      'Hole Check Time': 'Inspection Engine — Feature breakdown panel',
      'Bends to Inspect': 'Inspection Engine — sampled bend count (Feature breakdown panel)',
      'Bend Check Time': 'Inspection Engine — Feature breakdown panel',
      'Threads to Inspect': 'Inspection Engine — sampled thread count (Feature breakdown panel)',
      'Thread Gauge Time': 'Inspection Engine — Feature breakdown panel',
      'Has Thickness Check': 'Inspection Engine — Feature breakdown panel',
      'Thickness Check Time': 'Inspection Engine — Feature breakdown panel',
      'Has Dimension Check': 'Inspection Engine — Feature breakdown panel',
      'Dimension Check Time': 'Inspection Engine — Feature breakdown panel',
      ...(() => {
        const pemRows = Array.isArray(editData?.featureBreakdown)
          ? (editData.featureBreakdown as Array<{ name: string; timeSec: number; featureType: string; count: number }>)
              .filter((f) => f.featureType === 'pem_insertion')
          : [];
        if (pemRows.length === 0) return {};
        const single = pemRows.length === 1 && pemRows[0]
          ? `sm_lookup_pem_hardware — ${pemRows[0].name}`
          : `sm_lookup_pem_hardware — weighted average across ${pemRows.length} matched hardware specs (${pemRows.map((r) => r.name).join('; ')})`;
        return {
          'Insertion Cycle Time': single,
          'No Of Insertions': 'CAD feature extraction — total matched PEM hole count (Feature breakdown panel)',
        };
      })(),
    };

    const newInputs: Record<string, any> = { ...calculatorInputsRef.current };
    const newProvenance: Record<string, string> = { ...calculatorInputProvenanceRef.current };

    selectedCalculator.fields
      ?.filter((field: any) => field.fieldType !== 'calculated')
      .forEach((field: any) => {
        const fieldName = field.fieldName;
        const displayName = field.displayLabel || field.displayName;

        // Try to match by field name or display name
        const bomValue = bomFieldMapping[fieldName] || bomFieldMapping[displayName];

        if (bomValue !== undefined && bomValue !== null && bomValue !== '') {
          newInputs[fieldName] = (field.fieldType === 'select' || field.fieldType === 'text')
            ? String(bomValue)
            : (typeof bomValue === 'number' ? bomValue : parseFloat(bomValue) || 0);
          newProvenance[fieldName] = bomFieldProvenance[fieldName] || bomFieldProvenance[displayName] || 'CAD/BOM part data';
        } else if (newInputs[fieldName] === undefined && field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
          // Surface the calculator's own real default (e.g. Complexity: "Simple",
          // Bending Coefficient: "1.33") in the UI instead of only applying it
          // silently server-side — the engineer sees and can change it.
          newInputs[fieldName] = (field.fieldType === 'select' || field.fieldType === 'text')
            ? field.defaultValue
            : (parseFloat(field.defaultValue) || 0);
          newProvenance[fieldName] = `Calculator's own default value`;
        }
      });

    setCalculatorInputs(newInputs);
    setCalculatorInputProvenance(newProvenance);

    // Cutting Speed (Laser Cutting Manufacturing): a real value from the
    // sm_lookup_laser_cut table (material x thickness x laser power), never a
    // manual guess. Unlike Bend's Stroke Time Per Bend, this has no dependency
    // on any calculated field, so it resolves in this single pass — no need
    // for a second execute() call.
    // calculatorInputs persists across calls (newInputs starts as a copy of it), so a
    // field left as '' from an earlier interaction — not undefined, but visually just
    // as blank — must count as "still needs a value" here, or it silently never gets
    // auto-filled even after a real lookup value becomes available.
    const isBlank = (v: any) => v === undefined || v === null || v === '';
    const cuttingSpeedField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Cutting Speed');
    const pierceTimeField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Piercing Time Per Start');
    const needsCuttingSpeed = cuttingSpeedField && isBlank(newInputs['Cutting Speed']);
    const needsPierceTime = pierceTimeField && isBlank(newInputs['Piercing Time Per Start']);
    if (needsCuttingSpeed || needsPierceTime) {
      const grade = bomItemData.materialGrade || bomItemData.material;
      const thickness = bomItemData.sheetThicknessMm;

      // 'Cutting Speed'/'Piercing Time Per Start' are shared field names
      // across BOTH the Laser Cutting and Waterjet Cutting Manufacturing
      // calculators — selectedMachineClass (already resolved from
      // process_calculator_mappings for the current operation, not a string
      // guess on the calculator's name) says which real lookup table this
      // operation's numbers actually come from.
      if (selectedMachineClass === 'waterjet') {
        if (grade && thickness > 0) {
          try {
            const lookup = await calculatorsApi.sheetMetalLookup('waterjet_cut', {
              material: normaliseLaserMaterial(grade),
              thickness_mm: thickness,
            });
            const pierceTimeSec = (lookup as any)?.row?.pierceTimeSec;
            const pierceTimeMin = typeof pierceTimeSec === 'number' ? pierceTimeSec / 60 : null;
            const matchedThickness = (lookup as any)?.row?.thicknessMm;
            const nearestNote = matchedThickness != null && Number(matchedThickness) !== thickness
              ? ` (nearest seeded row: ${matchedThickness}mm — table is stepped, not every thickness is seeded verbatim)`
              : '';
            const rowSourceNote = `sm_lookup_waterjet_cut — ${normaliseLaserMaterial(grade)}, ${thickness}mm sheet${nearestNote}`;
            setCalculatorInputs((prev) => ({
              ...prev,
              ...(needsCuttingSpeed && isBlank(prev['Cutting Speed']) && typeof lookup?.value === 'number' ? { 'Cutting Speed': lookup.value } : {}),
              ...(needsPierceTime && isBlank(prev['Piercing Time Per Start']) && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': pierceTimeMin } : {}),
            }));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              ...(needsCuttingSpeed && typeof lookup?.value === 'number' ? { 'Cutting Speed': rowSourceNote } : {}),
              ...(needsPierceTime && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': rowSourceNote } : {}),
            }));
            const rowCols = extractRowColumns((lookup as any)?.row);
            if (rowCols) {
              setCalculatorMatchedRowKeys((prev) => ({
                ...prev,
                ...(needsCuttingSpeed && typeof lookup?.value === 'number' ? { 'Cutting Speed': rowCols } : {}),
                ...(needsPierceTime && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': rowCols } : {}),
              }));
            }
          } catch {
            // No match / lookup failed — leave these fields blank for the
            // engineer to fill in manually rather than guessing a number.
          }
        }
      } else {
      // Read the real, verified capability (selectedMHR.powerKw) DIRECTLY —
      // never the calculator's own 'Laser Machine Power' *field* value.
      // This whole block and the field's own auto-fill (which sets
      // 'Laser Machine Power' from this exact same selectedMHR.powerKw) live
      // in the SAME single-pass autoPopulateFromBOM() function, and the
      // field's auto-fill runs LATER in that pass — reading the field here
      // would always see it still blank, on every run, forever (this
      // function's own useEffect only re-fires on
      // [selectedCalculator?.id, bomItemData?.id, calculatorTarget], never on
      // calculatorInputs changing, so there is no "next pass" to catch up).
      // Falls back to parsing the field's raw text only for the manual-entry
      // case (no selectedMHR at all — an engineer typed a wattage directly).
      const parseWattageField = (raw: unknown): number | null => {
        if (typeof raw === 'number' && raw > 0) return raw;
        if (typeof raw !== 'string') return null;
        const kw = raw.match(/(\d+(?:\.\d+)?)\s*k\s*w/i);
        if (kw?.[1]) return parseFloat(kw[1]) * 1000;
        const w = raw.match(/(\d+(?:\.\d+)?)/);
        return w?.[1] ? parseFloat(w[1]) : null;
      };
      const laserPowerW = (typeof (selectedMHR as any)?.powerKw === 'number' && (selectedMHR as any).powerKw > 0)
        ? (selectedMHR as any).powerKw * 1000
        : parseWattageField(newInputs['Laser Machine Power']);

      if (grade && thickness > 0 && laserPowerW) {
        try {
          // Same lookup call/row covers both fields — sm_lookup_laser_cut carries
          // cutting speed and pierce time together per material×thickness×power.
          const lookup = await calculatorsApi.sheetMetalLookup('laser_cut', {
            material: normaliseLaserMaterial(grade),
            thickness_mm: thickness,
            laser_power_w: laserPowerW,
            // Backend gates cutting speed/pierce time by technology
            // (migration 457) — a co2_laser machine (e.g. AMADA Quattro)
            // must never silently match fiber-sourced data at the nearest
            // power. selectedMachineClass is already tracked for the eye-
            // icon's own resolveAdHocLookupTableKey lookup above.
            machine_class: selectedMachineClass,
          });
          // Backend responses go through a global camelCase transform
          // interceptor — the DB column is pierce_time_min, but the row
          // this endpoint returns arrives as pierceTimeMin. Reading the
          // snake_case name here silently returned undefined forever,
          // which is why Cutting Speed (a top-level, single-word 'value'
          // key — unaffected by the casing transform) always populated
          // while this field never did.
          const pierceTimeMin = (lookup as any)?.row?.pierceTimeMin;
          const matchedThickness = (lookup as any)?.row?.thicknessMm;
          const matchedPowerW = (lookup as any)?.row?.laserPowerW;
          const nearestNote = (matchedThickness != null && Number(matchedThickness) !== thickness) || (matchedPowerW != null && Number(matchedPowerW) !== laserPowerW)
            ? ` (nearest seeded row: ${matchedThickness}mm @ ${matchedPowerW}W — table is stepped, not every thickness/power combo is seeded verbatim)`
            : '';
          const rowSourceNote = `sm_lookup_laser_cut — ${normaliseLaserMaterial(grade)}, ${thickness}mm sheet, ${selectedMHR?.machineName || 'selected machine'} (${laserPowerW}W)${nearestNote}`;
          // Re-check blankness against `prev` (not the pre-await snapshot) —
          // a concurrent invocation or a manual edit during this await could
          // have already filled the field; never stomp that.
          setCalculatorInputs((prev) => ({
            ...prev,
            ...(needsCuttingSpeed && isBlank(prev['Cutting Speed']) && typeof lookup?.value === 'number' ? { 'Cutting Speed': lookup.value } : {}),
            ...(needsPierceTime && isBlank(prev['Piercing Time Per Start']) && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': pierceTimeMin } : {}),
          }));
          setCalculatorInputProvenance((prev) => ({
            ...prev,
            ...(needsCuttingSpeed && typeof lookup?.value === 'number' ? { 'Cutting Speed': rowSourceNote } : {}),
            ...(needsPierceTime && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': rowSourceNote } : {}),
          }));
          const rowCols = extractRowColumns((lookup as any)?.row);
          if (rowCols) {
            setCalculatorMatchedRowKeys((prev) => ({
              ...prev,
              ...(needsCuttingSpeed && typeof lookup?.value === 'number' ? { 'Cutting Speed': rowCols } : {}),
              ...(needsPierceTime && typeof pierceTimeMin === 'number' ? { 'Piercing Time Per Start': rowCols } : {}),
            }));
          }
        } catch {
          // No match / lookup failed — leave these fields blank for the
          // engineer to fill in manually rather than guessing a number.
        }
      }
      }
    }

    // UTS (database_lookup, data_source: raw_materials) — this field type had
    // no resolution mechanism anywhere (frontend or backend): unlike Direct/
    // Skilled Labors' data_source='lhr' fields, which just fall back to their
    // configured default_value, UTS has default_value=NULL, so it silently
    // stayed blank forever. Look up the part's actual material by grade —
    // same /raw-materials search endpoint the Cost Guide panel already uses —
    // and read its real ultimate_tensile_strength (backfilled Aug 2026 into
    // uts_mpa too; both columns now agree wherever populated).
    const utsField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'UTS');
    if (utsField && isBlank(newInputs['UTS'])) {
      const grade = bomItemData.materialGrade || bomItemData.material;
      if (grade) {
        try {
          const res = await apiClient.get<{ items: any[] }>('/raw-materials', {
            params: { search: grade, limit: 5 },
          });
          const match = res?.items?.[0];
          const uts = match?.utsMpa ?? match?.ultimateTensileStrength;
          if (typeof uts === 'number' && uts > 0) {
            setCalculatorInputs((prev) => (isBlank(prev['UTS']) ? { ...prev, UTS: uts } : prev));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              UTS: `raw_materials — "${match.material}" ultimate tensile strength`,
            }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Shear Strength (Stamping/TPP) and Yield Strength (Drawing/Forming) —
    // same class of gap as UTS above: both are database_lookup/raw_materials
    // fields with no resolution mechanism anywhere. Field name varies by
    // calculator ("Shear Strength" on Stamping, "Shear Strength (Mpa)" on TPP).
    const shearField = selectedCalculator.fields?.find(
      (f: any) => f.fieldName === 'Shear Strength' || f.fieldName === 'Shear Strength (Mpa)'
    );
    if (shearField && isBlank(newInputs[shearField.fieldName])) {
      const grade = bomItemData.materialGrade || bomItemData.material;
      if (grade) {
        try {
          const res = await apiClient.get<{ items: any[] }>('/raw-materials', { params: { search: grade, limit: 5 } });
          const match = res?.items?.[0];
          const shear = match?.shearStrengthMpa ?? match?.shearingStrength;
          if (typeof shear === 'number' && shear > 0) {
            setCalculatorInputs((prev) => (isBlank(prev[shearField.fieldName]) ? { ...prev, [shearField.fieldName]: shear } : prev));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              [shearField.fieldName]: `raw_materials — "${match.material}" shear strength`,
            }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    const yieldField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Yield Strength');
    if (yieldField && isBlank(newInputs['Yield Strength'])) {
      const grade = bomItemData.materialGrade || bomItemData.material;
      if (grade) {
        try {
          const res = await apiClient.get<{ items: any[] }>('/raw-materials', { params: { search: grade, limit: 5 } });
          const match = res?.items?.[0];
          const yieldStrength = match?.yieldStrengthMpa ?? match?.yieldTensileStrength;
          if (typeof yieldStrength === 'number' && yieldStrength > 0) {
            setCalculatorInputs((prev) => (isBlank(prev['Yield Strength']) ? { ...prev, 'Yield Strength': yieldStrength } : prev));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              'Yield Strength': `raw_materials — "${match.material}" yield strength`,
            }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Roll Forming Line Speed / Setup Time (sm_lookup_roll_forming, migration
    // 442) — single real shop-floor line-speed + tooling-changeover row, the
    // same table SheetMetalLookupService/cost-engine.ts already resolve for
    // the automated estimate. Previously this calculator's fields had no
    // data_source tag at all (pure manual entry) despite the real table
    // existing and already being bridged for the eye icon.
    if (selectedMachineClass === 'roll_forming') {
      const lineSpeedField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Line Speed');
      const rollSetupField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Setup Time');
      if ((lineSpeedField && isBlank(newInputs['Line Speed'])) || (rollSetupField && isBlank(newInputs['Setup Time']))) {
        try {
          const lookup = await calculatorsApi.sheetMetalLookup('roll_forming', {});
          if (lineSpeedField && isBlank(newInputs['Line Speed']) && typeof lookup?.value === 'number') {
            setCalculatorInputs((prev) => (isBlank(prev['Line Speed']) ? { ...prev, 'Line Speed': lookup.value } : prev));
            setCalculatorInputProvenance((prev) => ({ ...prev, 'Line Speed': 'sm_lookup_roll_forming — achievable shop-floor line speed' }));
          }
          if (rollSetupField && isBlank(newInputs['Setup Time']) && typeof lookup?.setupTimeMin === 'number') {
            setCalculatorInputs((prev) => (isBlank(prev['Setup Time']) ? { ...prev, 'Setup Time': lookup.setupTimeMin } : prev));
            setCalculatorInputProvenance((prev) => ({ ...prev, 'Setup Time': 'sm_lookup_roll_forming — roll-tooling changeover time' }));
          }
        } catch {
          // No data / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Sheet/Coil Loading/Unloading Time (Table 2, sm_lookup_handling_time) —
    // real weight-based handling time, same table cost-engine.ts already uses
    // for the automated cost estimate. Never a manual guess when the part's
    // weight is known. Field name varies by calculator (Bending/Laser
    // Cutting/Drawing-Forming: "Sheet Loading Time"; Stamping: "Total Coil
    // Loading Time"; TPP: "Total Sheet Loading Unloading (min)").
    const sheetLoadingField = selectedCalculator.fields?.find(
      (f: any) => f.fieldName === 'Sheet Loading Time'
        || f.fieldName === 'Total Coil Loading Time'
        || f.fieldName === 'Total Sheet Loading Unloading (min)'
    );
    if (sheetLoadingField && isBlank(newInputs[sheetLoadingField.fieldName])) {
      const weightKg = Number(bomItemData.weight || 0);
      if (weightKg > 0) {
        try {
          const lookup = await calculatorsApi.sheetMetalLookup('handling_time', { weight_kg: weightKg });
          if (typeof lookup?.value === 'number') {
            setCalculatorInputs((prev) => isBlank(prev[sheetLoadingField.fieldName]) ? ({ ...prev, [sheetLoadingField.fieldName]: lookup.value }) : prev);
            setCalculatorInputProvenance((prev) => ({ ...prev, [sheetLoadingField.fieldName]: `sm_lookup_handling_time — part weight ${weightKg}kg` }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Sampling Rate (Lookup Table 6, sm_lookup_sampling_plan) — real batch-size
    // -based inspection sampling percentage, on every Cost Drivers calculator.
    // No part-complexity concept is exposed on these calculators to pick a
    // level, so this defaults to Level I (lowest/simplest) — the safe,
    // documented default rather than guessing Medium/High, same reasoning as
    // "Simple" for Time Per Stroke's complexity default above.
    const samplingField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Sampling Rate');
    if (samplingField && isBlank(newInputs['Sampling Rate'])) {
      const lotSize = Number(newInputs['Lot Size'] || batchSize || 0);
      if (lotSize > 0) {
        try {
          const lookup = await calculatorsApi.sheetMetalLookup('sampling_plan', { batch_size: lotSize, complexity_level: 1 });
          if (typeof lookup?.value === 'number') {
            setCalculatorInputs((prev) => (isBlank(prev['Sampling Rate']) ? { ...prev, 'Sampling Rate': lookup.value } : prev));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              'Sampling Rate': `sm_lookup_sampling_plan — lot size ${lotSize}, Level I (default, no complexity field on this calculator)`,
            }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Machining - Tapping specific fields — all three derivable from the same
    // real thread spec (drawingIntelligence.threads, real 2D-drawing-text
    // extraction) already used for "Potential tapping features" elsewhere on
    // this page, not a new/independent guess:
    //   Length (tap engagement depth) — sheet thickness, matching the
    //     feature breakdown's own "depth Xmm assumed" note, NOT the part's
    //     overall length (excluded from the generic mapping above).
    //   Tap Diameter — the thread's nominal major diameter (M3 -> 3mm).
    //   Feed per Rev — for rigid tapping, feed/rev IS the thread pitch by
    //     definition (0.5mm for M3x0.5).
    if (selectedCalculatorId === 'fe42139c-5675-4a82-94d5-7f2d440ae9bf') {
      const thread = ((bomItemData.drawingIntelligence as any)?.threads as Array<{ size: string; pitch: number; count?: number }> | undefined)?.[0];
      const nominalDia = thread?.size ? parseFloat(thread.size.replace(/[^0-9.]/g, '')) : null;

      const tapLengthField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Length');
      if (tapLengthField && isBlank(newInputs['Length']) && bomItemData.sheetThicknessMm > 0) {
        setCalculatorInputs((prev) => (isBlank(prev['Length']) ? { ...prev, Length: bomItemData.sheetThicknessMm } : prev));
        setCalculatorInputProvenance((prev) => ({ ...prev, Length: 'BOM sheet thickness (tap engagement depth)' }));
      }

      const tapDiaField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Tap Diameter');
      if (tapDiaField && isBlank(newInputs['Tap Diameter']) && nominalDia) {
        setCalculatorInputs((prev) => (isBlank(prev['Tap Diameter']) ? { ...prev, 'Tap Diameter': nominalDia } : prev));
        setCalculatorInputProvenance((prev) => ({ ...prev, 'Tap Diameter': `Nominal major diameter of "${thread!.size}" thread (drawing callout)` }));
      }

      const feedField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Feed per Rev');
      if (feedField && isBlank(newInputs['Feed per Rev']) && thread?.pitch) {
        setCalculatorInputs((prev) => (isBlank(prev['Feed per Rev']) ? { ...prev, 'Feed per Rev': thread.pitch } : prev));
        setCalculatorInputProvenance((prev) => ({
          ...prev,
          'Feed per Rev': `Thread pitch (drawing callout) — feed/rev = pitch for rigid tapping`,
        }));
      }

      // Cutting Speed — real HSS (M2) tapping surface speed by material family,
      // same TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL table default-rates.ts's
      // computeTapCycleSec() now uses, cross-verified from two independent
      // published tap-vendor references (Viking/Norseman Drill & Tool SFM
      // tables + Slugger Tools m/min chart, converted/averaged where they
      // overlap): mild/carbon steel ~10, stainless (300-series) ~4.5,
      // aluminum (wrought) ~25 m/min. Family classification mirrors this
      // file's own classifySubstrate-equivalent keyword taxonomy (see
      // page.tsx's classifySubstrate / backend's classifyMaterialFamily) —
      // keep the keyword lists in sync across all three.
      const cuttingSpeedField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Cutting Speed');
      if (cuttingSpeedField && isBlank(newInputs['Cutting Speed'])) {
        const gradeText = (bomItemData.materialGrade || bomItemData.material || '').toString().toUpperCase();
        let materialFamily: 'aluminum' | 'stainless' | 'carbon_steel' | 'unknown' = 'unknown';
        // T6 (ANSI H35.1 temper) is aluminum-exclusive; SECC/SPCC/SGCC/SPHC/SPCE
        // are JIS cold-rolled/galvanized mild-steel sheet codes — same families
        // page.tsx's classifySubstrate / backend's classifyMaterialFamily use.
        if (/ALUMIN|(^|[^A-Z0-9])(AA\s?\d{4}|AL)([^A-Z]|$)|6061|6063|5052|5754|7075|2024|\bT6\b/.test(gradeText)) {
          materialFamily = 'aluminum';
        } else if (/STAINLESS|(^|[^A-Z])SS([^A-Z]|$)|304|316|430|17-4/.test(gradeText)) {
          materialFamily = 'stainless';
        } else if (/MILD|EN\s?8|S235|S355|HR\b|CR[1-5]\b|CRCA|IS\s?2062|DC01|E250|E350|\bMS\b|SECC|SPCC|SGCC|SPHC|SPCE/.test(gradeText)) {
          materialFamily = 'carbon_steel';
        }
        const tapSpeedByFamily: Record<string, number> = { carbon_steel: 10, stainless: 4.5, aluminum: 25, unknown: 10 };
        const tapSpeedSourceByFamily: Record<string, string> = {
          carbon_steel: 'Mild/carbon steel HSS tapping reference (~10 m/min) — Viking/Norseman Drill & Tool + Slugger Tools tap-speed charts',
          stainless: 'Stainless (300-series) HSS tapping reference (~4.5 m/min) — Viking/Norseman Drill & Tool + Slugger Tools tap-speed charts',
          aluminum: 'Aluminum (wrought) HSS tapping reference (~25 m/min) — Viking/Norseman Drill & Tool + Slugger Tools tap-speed charts',
          unknown: 'Material not identified — defaulting to mild-steel HSS tapping reference (~10 m/min); same fallback the cost engine uses',
        };
        const speed = tapSpeedByFamily[materialFamily] ?? tapSpeedByFamily.unknown!;
        const speedSource = tapSpeedSourceByFamily[materialFamily] ?? tapSpeedSourceByFamily.unknown!;
        setCalculatorInputs((prev) => (isBlank(prev['Cutting Speed']) ? { ...prev, 'Cutting Speed': speed } : prev));
        setCalculatorInputProvenance((prev) => ({
          ...prev,
          'Cutting Speed': speedSource,
        }));
      }

      // No of Uses defaults to 1 (one tap) — override with the drawing's
      // actual tapped-hole count so Total Time reflects every hole, not just one.
      const noOfUsesField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'No of Uses');
      if (noOfUsesField && thread?.count && Number(newInputs['No of Uses']) === 1) {
        setCalculatorInputs((prev) => (Number(prev['No of Uses']) === 1 ? { ...prev, 'No of Uses': thread.count } : prev));
        setCalculatorInputProvenance((prev) => ({
          ...prev,
          'No of Uses': `Thread callout count (${thread!.count} × "${thread!.size}" holes on drawing)`,
        }));
      }
    }

    // Tool Loading Time (Lookup Table 3B, sm_lookup_tool_setup, setup_type='brake')
    // — keyed by tool/bend length, the same concept as this calculator's own
    // "Bending Line Length" field. Real table, real resolver case
    // (calculators.service.ts's 'tool_setup'); this field just never called it.
    // Scoped to the Bending calculator specifically: Table 3B ("brake") is
    // keyed by tool/bend length, known upfront. Stamping/Drawing-Forming use
    // Table 3A ("press", keyed by required tonnage) instead — tonnage is a
    // CALCULATED result, not known until after execute() runs once, so that
    // variant is resolved in handleExecuteCalculator's post-execute chain
    // (alongside Time Per Stroke) instead of here.
    const toolLoadingField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Tool Loading Time');
    if (
      toolLoadingField && isBlank(newInputs['Tool Loading Time']) && bomItemData.bendCount > 0 &&
      selectedCalculatorId === '102772ff-5422-45c1-b391-6d2d4a96ab1b'
    ) {
      const bendLengthMm = Math.max(bomItemData.maxLength || 0, bomItemData.maxWidth || 0);
      if (bendLengthMm > 0) {
        try {
          const lookup = await calculatorsApi.sheetMetalLookup('tool_setup', { setup_type: 'brake', key_value: bendLengthMm });
          if (typeof lookup?.value === 'number') {
            setCalculatorInputs((prev) => (isBlank(prev['Tool Loading Time']) ? { ...prev, 'Tool Loading Time': lookup.value } : prev));
            setCalculatorInputProvenance((prev) => ({
              ...prev,
              'Tool Loading Time': `sm_lookup_tool_setup (press brake) — tool/bend length ${bendLengthMm}mm`,
            }));
          }
        } catch {
          // No match / lookup failed — leave blank for manual entry.
        }
      }
    }

    // Machine name/power display fields — these carried literal hardcoded seed
    // values ("Trulaser", "6000 W") that never matched the actually selected
    // machine and don't feed any formula (purely informational). Show the real
    // selected machine instead of a generic placeholder.
    const machineNameField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Machine Name');
    if (machineNameField && isBlank(newInputs['Machine Name']) && selectedMHR?.machineName) {
      setCalculatorInputs((prev) => ({ ...prev, 'Machine Name': selectedMHR.machineName }));
      setCalculatorInputProvenance((prev) => ({ ...prev, 'Machine Name': 'Currently selected machine for this process (Resources & Location above)' }));
    }
    // Selected Tonnage — the currently selected press brake's own rated
    // capacity, the same figure machine-selection's capability check already
    // uses ("Bend X t ≤ Y t machine capacity"). Prefers the DB-recorded
    // mhr_records.max_tonnage when a machine has it; most seeded press
    // brakes don't (confirmed: only 10/48), so falls back to parsing the
    // capacity stated plainly in the machine's own name — the same fallback
    // machine-selection/selector.ts's own parseTonnageFromName already uses
    // server-side for this exact reason.
    const selectedTonnageField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Selected Tonnage');
    if (selectedTonnageField && isBlank(newInputs['Selected Tonnage'])) {
      const tonnage = selectedMHR?.maxTonnage ?? parseTonnageFromMachineName(selectedMHR?.machineName);
      if (tonnage) {
        setCalculatorInputs((prev) => ({ ...prev, 'Selected Tonnage': tonnage }));
        setCalculatorInputProvenance((prev) => ({
          ...prev,
          'Selected Tonnage': selectedMHR?.maxTonnage
            ? `Rated capacity of "${selectedMHR.machineName ?? 'selected machine'}" (Resources & Location above)`
            : `Parsed from selected machine name "${selectedMHR?.machineName}"`,
        }));
      }
    }

    // 'Laser Machine Power' — a real machine CAPABILITY (mhr_records.power_kw,
    // migration 324, verified OEM data only — migration 450's backfill), never
    // inferred from the machine's name string at calculation time. That regex
    // fallback (this field used to show a hardcoded '6000 W' placeholder, then
    // a name-parsed guess) is exactly the class of mock/inferred value this
    // architecture exists to remove — see bom-items.service.ts's identical
    // fix for the real cost engine's own laser-power resolution. A blank
    // field now correctly means "no verified capability on file — enter the
    // real value," never a guess dressed up as resolved data.
    const laserMachinePowerField = selectedCalculator.fields?.find((f: any) => f.fieldName === 'Laser Machine Power');
    if (laserMachinePowerField && isBlank(newInputs['Laser Machine Power'])) {
      const powerKw = (selectedMHR as any)?.powerKw;
      if (typeof powerKw === 'number' && powerKw > 0) {
        const powerW = powerKw * 1000;
        setCalculatorInputs((prev) => (isBlank(prev['Laser Machine Power']) ? { ...prev, 'Laser Machine Power': `${powerW} W` } : prev));
        setCalculatorInputProvenance((prev) => ({
          ...prev,
          'Laser Machine Power': `Verified machine capability: "${selectedMHR?.machineName ?? 'selected machine'}" (Resources & Location above)`,
        }));
      }
    }
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

  // Scroll to the highlighted "currently used" row as soon as the eye
  // viewer's table renders — with a stepped lookup table seeding dozens of
  // rows per material, the matching row is otherwise easy to lose among the
  // rest (the actual ask behind this whole feature).
  useEffect(() => {
    if (showLookupTable && matchedCurrentRowRef.current) {
      matchedCurrentRowRef.current.scrollIntoView({ block: 'center' });
    }
  }, [showLookupTable, lookupTableData]);

  // Handle viewing lookup table
  const handleViewLookupTable = async (field: any) => {
    setSelectedLookupField(field);

    try {
      const { processesApi } = await import('@/lib/api/processes');

      // Case 0: a real sm_lookup_* cost-engine table — the same live data
      // SheetMetalLookupService queries for this exact field's value (Time
      // Per Stroke, Stroke Time, Tool Loading Time, Cutting Speed, Piercing
      // Time Per Start, ...), not the separate process_reference_tables
      // system Cases 1/2 below read from.
      // DB-tagged fields (sourceField) store a bare suffix ('manual_stroke',
      // 'tool_setup') — the ad-hoc resolver above returns the real, FULL
      // table name directly instead (needed for inspection_operation_defaults/
      // surface_treatment_rates, which don't follow the sm_lookup_ convention).
      const isAdHoc = !(field.dataSource === SM_LOOKUP_DATA_SOURCE && field.sourceField);
      const smLookupTableName = isAdHoc
        ? resolveAdHocLookupTableKey(field.fieldName, selectedMachineClass)
        : `sm_lookup_${field.sourceField}`;
      if (smLookupTableName) {
        const table = await processesApi.getSmLookupTableByName(smLookupTableName);
        if (table) {
          const processedRows = table.rows?.map((row: any) =>
            row.rowData ? row.rowData : row
          ) || [];
          // Ad-hoc fields compute their own highlight client-side from the
          // field's current value (see computeAdHocMatchedRow's own doc
          // comment) — the pre-computed calculatorMatchedRowKeys snapshot
          // only exists for the original auto-fill-wired fields (Cutting
          // Speed, Piercing Time Per Start, Time Per Stroke, ...).
          const adHocMatch = isAdHoc
            ? computeAdHocMatchedRow(smLookupTableName, field.fieldName, processedRows, calculatorInputs[field.fieldName], location)
            : null;
          setLookupTableData({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: table.tableName,
            tableId: table.id,
            column_definitions: table.columnDefinitions || [],
            rows: processedRows,
            matchedRowKeys: adHocMatch ?? calculatorMatchedRowKeys[field.fieldName] ?? null,
          });
          setShowLookupTable(true);
          return;
        }
      }

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
      setCalculatorInputProvenance({});
      setCalculatorResults(null);
      setCalculatorError(null);
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
    if (!open) { setEditDataApplied(false); return; }

    if (editData && open && !isLoadingCatalog && !isLoadingMHR && !editDataApplied) {
      setEditDataApplied(true);
      // Reset per-record override flags whenever a (new or different) record's
      // data loads. Without this, once the user manually picks a machine/labour
      // type on ANY record, both flags stay true for the rest of the dialog's
      // lifetime — silently disabling the auto-select-correction effect for
      // every other record opened afterward, even ones that have never been
      // touched. That's exactly why a freshly-corrected default (e.g. after a
      // data backfill) never got auto-picked here: the flag from an earlier,
      // unrelated record's manual edit was still blocking it.
      setUserOverrodeMHR(false);
      setOpNbr(editData.opNbr || 0);
      // location is always the CURRENT Digital Factory (see the `location`
      // derivation above) — otherwise reopening a process saved under a
      // different factory would silently re-resolve machines/rates for the
      // wrong location. The live Cost Summary engine always treats location
      // as current-request-authoritative; this editor matches it exactly,
      // with no per-row override.
      setSelectedGroup(editData.processGroup || '');
      setSelectedCategory(editData.category || '');
      // Preserved verbatim, never edited — written back unchanged on save so
      // re-saving a line created through the retired Group/Route/Operation
      // cascade does not blank the identity it was created with (migration 719
      // leaves both columns alone for exactly this reason).
      setSavedProcessRoute(editData.processRoute || '');
      setSavedOperation(editData.operation || '');
      setSelectedProcessCalculatorId(editData.processCalculatorId || '');
      
      // Use the actual field names from the process data. Fall back to the
      // benchmark id when there's no real mhr_id/lhr_id — a saved record from
      // a benchmark (★) pick has mhr_id/lhr_id NULL by design (it's not a real
      // mhr_records/lhr_records row), so without this the Select shows blank
      // even though a real benchmark rate was actually chosen and applied.
      // benchmarkMhrId/benchmarkLhrId already carry the bm-mhr-/bm-lhr-
      // prefix (mhr.service.ts/lhr.service.ts's getBenchmarkRates()), matching
      // filteredMHR's benchmark rows directly — no re-fetch needed.
      const mhrId = editData.mhrId || editData.machineId || editData.benchmarkMhrId || '';
      setSelectedMHRId(mhrId);
      
      setSetupManning(editData.setupManning || 1);
      setSetupTime(editData.setupTime || 0);
      setBatchSize(editData.batchSize || 1);
      setHeads(editData.heads || 1);
      setCycleTime(editData.cycleTime || 0);
      setPartsPerCycle(editData.partsPerCycle || 1);
      setScrap(editData.scrap || 0);
      // Never coerce an unresolved/never-set value to 0 — that's indistinguishable
      // from a genuinely saved zero rate. Keep it blank (renders the placeholder)
      // exactly like manualMhrRate/manualLhrRate below already correctly do.
      setMachineValue(editData.machineValue ?? '');
      setManualMhrRate(editData.machineRate || '');
      setManualLhrRate(editData.laborRate  || '');
      setFacilityId(editData.facilityId);
      setFacilityRateId(editData.facilityRateId);
      if (autoOpenCalculator) {
        setCalculatorTarget('cycleTime');
        setCalculatorOpen(true);
      }
    } else if (!editData && open) {
      setEditDataApplied(false);
      // Reset for new entry - suggest next operation number but user can change it
      setOpNbr(getSuggestedOpNbr()); // Suggest next operation number but user can enter any number
      setSelectedGroup('');
      setSelectedCategory('');
      setSavedProcessRoute('');
      setSavedOperation('');
      setSelectedProcessCalculatorId('');
      setSelectedMHRId('');
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
    }
  }, [editData, open, isLoadingCatalog, isLoadingMHR, mhrData, existingProcesses, autoOpenCalculator]);

  // Effective rates: dropdown selection → manual input → editData stored fallback.
  // Non-machine operations (Raw Material / Packing & Delivery / General-General) never
  // have a real machine cost, so no stale saved/manual value is allowed to surface here.
  const effectiveMachineRate = isNonMachineOperation
    ? 0
    : selectedMHR
      // calculations.totalMachineHourRate is the rate AS STORED, in whatever
      // currency that machine's location uses (e.g. raw INR for an India
      // record) — resolveMhrUsdRate prefers the real USD-normalised field so
      // a non-USA machine's local-currency number is never fed into this
      // USD-denominated cost preview/save as if it already were dollars.
      ? resolveMhrUsdRate(selectedMHR)
      : savedMHRRecord
        // selectedMHR can be unset even though this row's saved machine DID
        // resolve (e.g. a transient class-mismatch reset, or a cross-location
        // saved pick not yet reflected in filteredMHR) — prefer the real,
        // live-fetched record over a static/possibly-stale editData.machineRate
        // snapshot. Falling through to that stale snapshot (often genuinely 0
        // on older rows) is exactly what produced "MHR = $0.00/hr" for a
        // machine that actually has a valid rate on file.
        ? resolveMhrUsdRate(savedMHRRecord)
        : (typeof manualMhrRate === 'number' && manualMhrRate > 0 ? manualMhrRate : (Number(editData?.machineRate) || 0));
  // For benchmark records lhr is already in USD (= lhrUsdEffective). For user records
  // lhrUsdEffective is the correct USD value; fall back to lhr when it is missing.
  // The selected machine's own rate, else a manual entry, else whatever this
  // line was last saved with. No labour-record tier in between any more.
  const effectiveLaborRate = machineLabour
    ? machineLabour.rate
    : (typeof manualLhrRate === 'number' && manualLhrRate > 0 ? manualLhrRate : (Number(editData?.laborRate) || 0));

  // Cost preview: calls the exact same eMithranTerms()-based engine that computes the
  // saved record server-side (POST /process-costs/calculate → ProcessCostCalculationEngine),
  // instead of a second, independently-maintained formula here — the preview can never
  // show a number that diverges from what actually gets charged on save. Debounced so
  // live typing doesn't fire a request per keystroke.
  const calculateProcessCost = useCalculateProcessCost();
  const [totalCost, setTotalCost] = useState(0);
  // Why Total Cost is not a number, when it is not a number.
  const [costPreviewError, setCostPreviewError] = useState<string | null>(null);

  const costPreviewInput = useMemo(() => {
    const cycleTimeNum     = parseFloat(cycleTime     as string) || 0;
    const batchSizeNum     = parseFloat(batchSize     as string) || 0;
    const partsPerCycleNum = parseFloat(partsPerCycle as string) || 0;
    const setupManningNum  = parseFloat(setupManning  as string) || 0;
    const setupTimeNum     = parseFloat(setupTime     as string) || 0;
    const headsNum         = parseFloat(heads         as string) || 0;
    const scrapNum         = parseFloat(scrap         as string) || 0;

    if (cycleTimeNum <= 0 || batchSizeNum <= 0 || partsPerCycleNum <= 0) return null;

    return {
      directRate: effectiveLaborRate,
      machineRate: effectiveMachineRate,
      setupManning: setupManningNum,
      setupTime: setupTimeNum,
      batchSize: batchSizeNum,
      heads: headsNum,
      cycleTime: cycleTimeNum,
      partsPerCycle: partsPerCycleNum,
      scrap: scrapNum,
    };
  }, [effectiveMachineRate, effectiveLaborRate, setupManning, setupTime, batchSize, heads, cycleTime, partsPerCycle, scrap]);

  const { debouncedValue: debouncedCostPreviewInput } = useDebounce(costPreviewInput, 300);

  useEffect(() => {
    if (!debouncedCostPreviewInput) {
      setTotalCost(0);
      return;
    }
    let cancelled = false;
    calculateProcessCost.mutateAsync(debouncedCostPreviewInput).then((result) => {
      if (cancelled) return;
      setTotalCost(result?.totalCostPerPart ?? 0);
      setCostPreviewError(null);
    }).catch((err: unknown) => {
      // The last known-good total stays on screen rather than being zeroed by a
      // transient error -- but the failure is NAMED. Swallowing it entirely (as
      // this did) rendered every failure as a confident "$0.00": indistinguishable
      // from a genuinely free operation, and with nothing anywhere to say the
      // number was never computed at all.
      if (cancelled) return;
      setCostPreviewError(err instanceof Error ? err.message : 'Cost preview request failed');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedCostPreviewInput]);

  // Benchmark LHR/MHR records use synthetic IDs (e.g. "bm-USA-Sheet Metal") that are not
  // UUIDs. The backend DTO validates @IsUUID() when the field is non-empty, so we must strip
  // non-UUID IDs before submitting. The actual rates (machineRate/laborRate) are already
  // included in the payload, so the row stays correct — it just won't have an FK reference.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const toUUID = (id: string) => (id && UUID_RE.test(id) ? id : undefined);

  // Applied-rate provenance label for a record with no resolved machine/labour
  // identity (no selectedMHR/LHR, no editData.machineName/laborType, no manual
  // override). This used to unconditionally say "Stored (AI route)" — a
  // fabricated guess, not a fact, and wrong framing besides: the auto-fill path
  // it referred to (bom-items.controller.ts's auto-fill-processes/apply-route)
  // is a deterministic geometry calculation — cut length, pierce count, bend
  // count feeding the same cut-length/feed-rate (L/F) cycle-time formula this
  // system uses everywhere else — not an AI/ML step. Read the real provenance
  // marker the backend already writes (notes = 'auto_fill_from_cad' or
  // 'auto_fill_from_route:<id>') and describe it for what it actually is.
  const describeUnlinkedRateProvenance = (): string => {
    const notes = String(editData?.notes ?? '');
    if (notes === 'auto_fill_from_cad' || notes.startsWith('auto_fill_from_route:')) {
      return 'Calculated from part geometry';
    }
    return 'Manual rate — not linked';
  };

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
      category: selectedCategory,
      // Written back exactly as loaded. These two columns belong to the
      // retired Group/Route/Operation cascade; nothing on this form edits
      // them, and blanking them would destroy the only identity a pre-719
      // line has. Empty strings on anything created from here on, which is
      // the honest value: this form never chose a route or an operation.
      processRoute: savedProcessRoute,
      operation: savedOperation,
      processCalculatorId: selectedProcessCalculatorId,
      mhrId: toUUID(selectedMHRId),
      // Benchmark (★) machine rows live in mhr_benchmark_rates, not mhr_records —
      // their id is a plain bigint, never a UUID, so it can never be sent as mhrId
      // (mhr_records FK). Send it separately so the backend can still resolve the
      // real machine_name/machine_class from mhr_benchmark_rates instead of the
      // record silently ending up "not linked to a machine".
      // Explicit null (not undefined) when NOT a benchmark pick — mhrId/benchmarkMhrId
      // must be mutually exclusive on the saved record. undefined gets dropped by
      // JSON serialization, so an update switching FROM a benchmark machine TO a
      // real one would otherwise leave the old benchmark_mhr_id stale on the row
      // (the backend only clears/updates a field when its key is actually present).
      benchmarkMhrId: (selectedMHR as any)?.isBenchmark ? selectedMHR?.id : null,
      // Explicit null, not omitted: the labour rate now always comes from the
      // selected machine's own row, so no lhr_records / lhr_benchmark_rates row
      // was chosen. Sending null clears a stale FK left by a line that was
      // originally saved through the removed labour picker (the backend only
      // updates a field whose key is actually present).
      lhrId: null,
      // Same reasoning as benchmarkMhrId above — a benchmark (★) labour rate
      // lives in lhr_benchmark_rates, its id is never a UUID, so it can't be
      // sent as lhrId. Without this, the record's labor_type ends up null even
      // though a specific, real (benchmark) labour rate was chosen.
      benchmarkLhrId: null,
      machineName: selectedMHR?.machineName || '',
      // Real hours/day for the SELECTED machine, from its own mhr_records row
      // (shifts_per_day x hours_per_shift -- the same product HR Rates uses to
      // derive annual available hours). This used to be sent as a flat 8 for
      // every line, which was a fabricated constant: no field on this form sets
      // it, so `data.shiftPatternHoursPerDay || 8` always took the 8.
      //
      // Left undefined when no machine is selected rather than defaulted. The
      // column is disclosure only -- ProcessCostCalculationEngine declares
      // shiftPatternHoursPerDay on its input interface but no calculation reads
      // it -- and an honest empty beats a number that looks measured.
      shiftPatternHoursPerDay: shiftPatternHoursPerDayFromMachine,
      // Display name for this line. Category is what identifies it now, with
      // a pre-719 line falling back to the operation it was created with.
      operationName: selectedCategory || savedOperation || '',
      processRouteName: savedProcessRoute || '',
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
              {!hasErrors && (isLoadingMHR || isLoadingCatalog || isLoadingCalculators) && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Loading data...</span>
                </div>
              )}

              {!hasErrors && !isLoadingMHR && !isLoadingCatalog && !isLoadingCalculators && (
                <>
                  {/* PROCESS SELECTION — Process + Category, both from mhr_records */}
                  <Card className="border-primary/50 bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-md">Process Selection</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Both fields come from your HR Rates database.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Loading state — editData present but effect hasn't fired yet */}
                      {editData && !editDataApplied && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading process data…
                        </div>
                      )}

                      {/* Always rendered, for new entries and for edits alike, preselected
                          to whatever is saved. A saved value HR Rates no longer lists is
                          appended to its own list and labelled, so it stays visible and
                          selectable rather than blanking the control. */}
                      <>
                      {/* 1. Process — mhr_records.process_group */}
                      <div className="space-y-2">
                        <Label className="font-semibold">1. Process</Label>
                        <Select
                          value={selectedGroup}
                          onValueChange={(value) => {
                            setSelectedGroup(value);
                            setSelectedCategory('');
                            setSelectedProcessCalculatorId('');
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select process" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLoadingMHR ? (
                              <SelectItem key="loading" value="loading" disabled>
                                Loading processes...
                              </SelectItem>
                            ) : groupOptions.length > 0 ? (
                              groupOptions.map((group) => (
                                <SelectItem key={group} value={group}>
                                  {group}{notInCatalog(processGroups, group) ? ' — saved, not in HR Rates' : ''}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem key="no-groups" value="none" disabled>
                                No processes available
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* 2. Category — the real machine category HR Rates groups its rows by */}
                      <div className="space-y-2">
                        <Label className="font-semibold">
                          2. Category
                          {!selectedGroup && <span className="text-muted-foreground text-xs ml-2">(Select Process first)</span>}
                        </Label>
                        <Select
                          value={selectedCategory}
                          onValueChange={(value) => {
                            setSelectedCategory(value);
                            setSelectedProcessCalculatorId('');
                          }}
                          disabled={!selectedGroup}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {isLoadingCategories ? (
                              <SelectItem key="loading" value="loading" disabled>
                                Loading categories...
                              </SelectItem>
                            ) : categoryOptions.length > 0 ? (
                              categoryOptions.map((cat: string) => (
                                <SelectItem key={cat} value={cat}>
                                  {cat}{notInCatalog(categories, cat) ? ' — saved, not in HR Rates' : ''}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem key="no-categories" value="none" disabled>
                                No categories for {selectedGroup}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {catalogError && (
                          <p className="text-xs text-red-600 dark:text-red-400">
                            Error loading HR Rates: {(catalogError as Error).message || 'Unknown error'}
                          </p>
                        )}
                        {selectedGroup && !isLoadingCategories && !catalogError && categories.length === 0 && (
                          <p className="text-xs text-amber-600 dark:text-amber-500">
                            No machine categories on file for &quot;{selectedGroup}&quot;. Add machines for it in HR Rates first.
                          </p>
                        )}
                        {/* Both fields, and the Machine list below them, come from the same
                            mhr_records rows — so what is shown here is what this shop
                            actually has, not a catalog description of it. machine_class is
                            the cost-engine key the chosen machine carries; it is displayed
                            because it is what a calculator is resolved by further down. */}
                        {selectedCategory && (
                          <p className="text-xs text-muted-foreground">
                            Process and Category both read from HR Rates
                            {selectedMachineClass ? (
                              <>
                                {' '}— this machine bills as class{' '}
                                <span className="font-medium">{selectedMachineClass}</span>
                              </>
                            ) : null}
                            .
                          </p>
                        )}
                        {/* A pre-719 line still carries the Route/Operation it was created
                            with. Shown read-only, because it is real saved data that is
                            written back unchanged — hiding it would make a re-save look
                            like it had silently dropped something. */}
                        {(savedProcessRoute || savedOperation) && (
                          <p className="text-xs text-muted-foreground">
                            Originally configured as
                            {savedProcessRoute ? <> route <span className="font-medium">{savedProcessRoute}</span></> : null}
                            {savedProcessRoute && savedOperation ? ' /' : null}
                            {savedOperation ? <> operation <span className="font-medium">{savedOperation}</span></> : null}
                            {' '}— preserved on save, not editable here.
                          </p>
                        )}
                      </div>
                        </>
                    </CardContent>
                  </Card>

                  {/* RESOURCES SECTION */}
                  <Card className="border-secondary/50">
                    <CardHeader>
                      <CardTitle className="text-md">Resources & Location</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Location — locked to the Digital Factory (Scenario tab). No
                          per-row override: MHR/LHR must always resolve against the
                          same location, or a labour rate can silently come from a
                          different country than the machine rate. */}
                      <div className="space-y-2">
                        <Label>Location</Label>
                        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                          <span>{location || 'No Digital Factory location set'}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Set on the Scenario tab — change it there, not per process.
                        </p>
                      </div>

                      {/* Machine Hour Rate override */}
                      <div className="space-y-2">
                        <Label>Machine Hour Rate (MHR)</Label>
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
                                  {mhr.machineName} - ${resolveMhrUsdRate(mhr).toFixed(2)}/hr
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
                          {/* This machine's own record is from a different location than the
                              current Digital Factory — a deliberate cross-location selection
                              REMAINS possible, but must never look like the local resource
                              (see selector.ts's identical warning for a class mismatch). */}
                          {selectedMHR?.location && location && selectedMHR.location.toLowerCase() !== location.toLowerCase() && (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                              ⚠ Cross-location manual selection — this machine is from {selectedMHR.location}, not the current Digital Factory ({location}).
                            </p>
                          )}
                          {/* A machine is listed but the rate that actually reaches the cost
                              math is still zero — machine time contributes nothing and the
                              total is silently understated. Lives on the field that owns the
                              rate rather than in a separate summary card, so the warning sits
                              where the fix is. */}
                          {effectiveMachineRate <= 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                              ⚠ No machine rate applied — cost cannot be calculated from machine time.
                            </p>
                          )}
                          {mhrTruncated && (
                            <p className="text-xs text-amber-600 dark:text-amber-500">
                              ⚠ Showing the first {MHR_FETCH_LIMIT} of {mhrData?.total} HR Rates machines — this
                              list may be incomplete. Narrow it down in HR Rates, or search there for the machine
                              you need.
                            </p>
                          )}
                          </>
                        ) : isNonMachineOperation ? (
                          <p className="text-xs text-muted-foreground">
                            No machine hour rate applies — this is a raw-material / logistics step, not a
                            machine operation.
                          </p>
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
                            {processFullySelected ? (
                              <p className="text-xs text-destructive">
                                No machines on file for &quot;{selectedCategory}&quot;{location ? ` in ${location}` : ''} —
                                add one in HR Rates, or enter a rate manually above. No machines from other
                                categories are shown, to avoid pricing this against the wrong resource.
                              </p>
                            ) : (
                              <p className="text-xs text-amber-600 dark:text-amber-400">
                                No MHR records{location ? ` for ${location}` : ''}. Enter rate manually or add in HR Rates.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Labour rate — derived, not chosen. It is the selected machine's
                          own HR Rates labour rate, so there is nothing here to pick and
                          nothing that can drift from the machine above. */}
                      <div className="space-y-2">
                        <Label>Labour Rate</Label>
                        {machineLabour ? (
                          <>
                            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                              <span>
                                {machineLabour.machineName ?? 'Selected machine'}
                                {machineLabour.wageGrade ? ` · wage grade ${machineLabour.wageGrade}` : ''}
                                {machineLabour.isBenchmark ? ' ★' : ''}
                              </span>
                              <span className="font-semibold">${machineLabour.rate.toFixed(2)}/hr</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              This machine&apos;s own labour rate from HR Rates
                              {machineLabour.isBenchmark
                                ? ' — ★ a benchmark value; enter this shop&rsquo;s real rate against the machine in HR Rates to override'
                                : ''}
                              .
                            </p>
                          </>
                        ) : isNonMachineOperation ? (
                          <p className="text-xs text-muted-foreground">
                            No labour rate applies — this is a raw-material / logistics step, not a machine
                            operation.
                          </p>
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
                            {selectedMHR ? (
                              <p className="text-xs text-amber-600 dark:text-amber-500">
                                {selectedMHR.machineName} has no labour rate on file in HR Rates — enter one here,
                                or set it against the machine so every line using it picks it up.
                              </p>
                            ) : (
                              <p className="text-xs text-amber-600 dark:text-amber-400">
                                Select a machine above to use its labour rate, or enter one manually.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Operators Required</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={setupManning}
                        onChange={(e) => {
                          setSetupManning(e.target.value);
                        }}
                        placeholder="Enter operators required"
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
                      <Label>Number of Heads</Label>
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

              {/* Total Cost Display — 2dp rounds a genuinely real, non-zero
                  cost to "$0.00" for very cheap machine+labour combinations
                  at a large batch size (confirmed live: Hole Extrusion
                  (Burring) at $0.28/hr machine + $1.73/hr labour, 2.1s cycle,
                  batch 250 — a real ~$0.0019/part, not a calculation bug).
                  Show more precision instead of hiding it whenever 2dp would
                  misrepresent a real cost as exactly zero. */}
              <Card className="bg-primary/10 border border-primary/20">
                <CardContent className="pt-6">
                  <Label className="block mb-2">Total Cost</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-primary">
                      {currencySymbol}{(() => {
                        const displayTotal = totalCost * conversionRate;
                        return displayTotal > 0 && displayTotal < 0.01 ? displayTotal.toFixed(4) : displayTotal.toFixed(2);
                      })()}
                    </span>
                  </div>
                  {/* Why the number above is not a real total, when it is not. A
                      zero here has three genuinely different causes and they must
                      not all read as "this operation is free": the inputs are
                      incomplete, no rate resolved, or the request itself failed. */}
                  {costPreviewError ? (
                    <p className="text-xs text-destructive mt-1">
                      ⚠ Not calculated — {costPreviewError}
                    </p>
                  ) : !costPreviewInput ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                      Enter Cycle Time, Batch Size and Parts/Cycle (all greater than zero) to calculate.
                    </p>
                  ) : effectiveMachineRate <= 0 && effectiveLaborRate <= 0 ? (
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                      No machine or labour rate resolved — select a Machine and Labour Type above, or enter
                      rates manually.
                    </p>
                  ) : null}
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
              <Select
                value={selectedCalculatorId}
                onValueChange={(v) => { setSelectedCalculatorId(v); setUserOverrodeCalculator(true); }}
              >
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
                  ) : calculatorsForDropdown.length > 0 ? (
                    calculatorsForDropdown.map((calc: any) => (
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
              {/* The machine class maps to more than one real operation, each with
                  its own formula, so nothing is auto-selected: press_brake covers
                  both "Bend Brake" and "Progressive Die Press", and silently taking
                  the first would cost a bent part with a stamping formula. The real
                  alternatives are named here so the choice is the engineer's and is
                  visible. */}
              {ambiguousCalculatorChoices.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 space-y-1">
                  <p className="text-xs text-amber-700 dark:text-amber-500">
                    Machine class <span className="font-medium">{selectedMachineClass}</span> is used by{' '}
                    {ambiguousCalculatorChoices.length} different operations, which are priced by different
                    formulas — pick the one this line represents rather than letting the first be assumed:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ambiguousCalculatorChoices.map((choice) => (
                      <Button
                        key={`${choice.operation}-${choice.calculatorId ?? 'none'}`}
                        type="button"
                        size="sm"
                        variant={choice.calculatorId && choice.calculatorId === selectedCalculatorId ? 'default' : 'outline'}
                        disabled={!choice.calculatorId}
                        onClick={() => {
                          if (!choice.calculatorId) return;
                          setSelectedCalculatorId(choice.calculatorId);
                          setUserOverrodeCalculator(true);
                        }}
                        title={choice.calculatorId ? choice.calculatorName || undefined : 'No calculator mapped to this operation'}
                      >
                        {choice.operation}
                        {!choice.calculatorId ? ' (no calculator)' : ''}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {calculatorTarget === 'processCalculator' && availableCalculators && availableCalculators.length === 0 && (
                <p className="text-xs text-amber-600">
                  No calculator is mapped to machine class{' '}
                  <span className="font-medium">{selectedMachineClass || '(not resolved yet)'}</span>.
                  You can still use general calculators.
                </p>
              )}
              {calculatorTarget === 'processCalculator' && selectedCalculatorId && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedProcessCalculatorId(selectedCalculatorId);
                    setCalculatorOpen(false);
                    setCalculatorResults(null);
                    setCalculatorError(null);
                    setCalculatorInputs({});
                    setCalculatorInputProvenance({});
                    setCalculatorTarget(null);
                  }}
                  className="w-full"
                >
                  Use This Calculator
                </Button>
              )}
            </div>

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
                      // MHR per Hour / LHR per Hour are already set above in this
                      // same dialog's Resources & Location section (machine +
                      // labour type + location) — showing them again here
                      // as a second editable box duplicates that, and risks the two
                      // silently drifting apart. Still auto-populated into
                      // calculatorInputs from those same applied rates (see
                      // autoPopulateFromBOM's bomFieldMapping) so formulas that
                      // reference {MHR per Hour}/{LHR per Hour} keep working —
                      // just not rendered as a separate input here.
                      .filter((field: any) => field.fieldName !== 'MHR per Hour' && field.fieldName !== 'LHR per Hour')
                      // Opened specifically for Cycle Time: hide inputs that don't
                      // feed it (Machine Name, Lot Size, labour counts, ...) — see
                      // relevantFieldNames' own comment. No-ops (shows everything)
                      // when that couldn't be confidently resolved.
                      .filter((field: any) => !relevantFieldNames || relevantFieldNames.has(field.fieldName))
                      .map((field: any) => {
                        // Only show eye button for fields that have actual lookup tables configured
                        const isLookupTableField =
                          // Only show for explicitly configured database lookup fields
                          (field.fieldType === 'database_lookup' && field.dataSource === 'processes') ||
                          // Only show for fields with sourceField starting with 'from_' (linked to reference tables)
                          (field.sourceField && field.sourceField.startsWith('from_')) ||
                          // Real sm_lookup_* cost-engine tables — every field this session's
                          // whole Manufacturing Physics Calculator work has been wiring up
                          // (Time Per Stroke, Stroke Time, Tool Loading Time, Cutting Speed,
                          // Piercing Time Per Start, ...). Covers both DB-marked lookup
                          // fields (dataSource='sheet_metal_lookup') and the handful resolved
                          // via ad-hoc frontend JS instead (resolveAdHocLookupTableKey).
                          (field.dataSource === SM_LOOKUP_DATA_SOURCE && !!field.sourceField) ||
                          !!resolveAdHocLookupTableKey(field.fieldName, selectedMachineClass);





                        const selectOptions = SELECT_FIELD_OPTIONS[field.fieldName];

                        // A field is "real" (not a manual guess or the calculator
                        // schema's blank placeholder) when its Why: caption names
                        // an actual source — every non-manual provenance string in
                        // this dialog is either a real source name or the one
                        // literal fallback "Calculator's own default value" (see
                        // bom-items.service.ts's calculation-trace builder, same
                        // string). Highlighting on that single check works
                        // generically for every field, not just PEM's.
                        const provenance = calculatorInputProvenance[field.fieldName];
                        const isRealSourcedValue = !!provenance && provenance !== "Calculator's own default value";
                        const realValueClassName = isRealSourcedValue
                          ? 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200'
                          : '';

                        return (
                          <div key={field.id} className="space-y-2">
                            <Label htmlFor={field.fieldName}>
                              {field.displayLabel || field.fieldName}
                              {field.unit && <span className="text-muted-foreground ml-1">({field.unit})</span>}
                            </Label>

                            {field.fieldType === 'select' && selectOptions ? (
                              <Select
                                value={calculatorInputs[field.fieldName] ?? ''}
                                onValueChange={(v) => setCalculatorInputs({ ...calculatorInputs, [field.fieldName]: v })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={`Choose ${field.displayLabel || field.fieldName}`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {selectOptions.map((opt) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : field.fieldType === 'select' || field.fieldType === 'text' ? (
                              <Input
                                id={field.fieldName}
                                type="text"
                                value={calculatorInputs[field.fieldName] ?? ''}
                                onChange={(e) =>
                                  setCalculatorInputs({ ...calculatorInputs, [field.fieldName]: e.target.value })
                                }
                                placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                              />
                            ) : isLookupTableField ? (
                              // Input field WITH eye icon for lookup table fields
                              <div className="flex gap-2">
                                <Input
                                  id={field.fieldName}
                                  type="number"
                                  step="0.01"
                                  value={calculatorInputs[field.fieldName] ?? ''}
                                  onChange={(e) =>
                                    setCalculatorInputs({
                                      ...calculatorInputs,
                                      [field.fieldName]: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                                  className={`flex-1 ${realValueClassName}`}
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
                                value={calculatorInputs[field.fieldName] ?? ''}
                                onChange={(e) =>
                                  setCalculatorInputs({
                                    ...calculatorInputs,
                                    [field.fieldName]: parseFloat(e.target.value) || 0,
                                  })
                                }
                                placeholder={`Enter ${field.displayLabel || field.fieldName}`}
                                className={realValueClassName}
                              />
                            )}

                            {calculatorInputProvenance[field.fieldName] && (
                              <div className="text-xs text-muted-foreground">
                                Why: {calculatorInputProvenance[field.fieldName]}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {/* Machine Capability — only for calculators that price
                        laser power (Laser Cutting today). Shows the REAL,
                        verified mhr_records.power_kw this calculation used,
                        or plainly discloses why none is available, instead
                        of leaving that fact implicit in a "Why:" line. */}
                    {selectedCalculator.fields?.some((f: any) => f.fieldName === 'Laser Machine Power') && (() => {
                      const capabilityPowerKw = (selectedMHR as any)?.powerKw;
                      const hasPower = typeof capabilityPowerKw === 'number' && capabilityPowerKw > 0;
                      // 'seed' = real, sourced, but NOT this unit's own verified
                      // nameplate reading (e.g. Salvagnini L3-30, migration 459's
                      // disclosed estimate from documented model specs) — must
                      // never render as "Verified" just because a number exists.
                      // Same distinction machine-selection/selector.ts already
                      // renders server-side ("Capability from model seed data —
                      // verify against machine plate").
                      const isEstimated = (selectedMHR as any)?.capabilitySource === 'seed';
                      return (
                        <div className="rounded-md border border-border p-3 space-y-1 text-xs">
                          <div className="font-semibold text-sm mb-1">Machine Capability</div>
                          {hasPower ? (
                            <>
                              <div>Machine: {selectedMHR?.machineName ?? 'Unknown'}</div>
                              <div>Laser Power: {(capabilityPowerKw * 1000).toLocaleString()} W</div>
                              <div>Source: {isEstimated ? 'disclosed estimate from documented model specs' : 'machine capability record'}</div>
                              {isEstimated ? (
                                <>
                                  <div className="text-amber-600 dark:text-amber-400 font-medium">Status: Estimated (not verified)</div>
                                  <div>Action: verify against this unit's nameplate/PO before finalizing</div>
                                </>
                              ) : (
                                <div className="text-primary font-medium">Status: Verified</div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="text-destructive font-medium">Laser Power: Unavailable</div>
                              <div>Reason: {selectedMHR
                                ? `power_kw not defined for "${selectedMHR.machineName}"`
                                : 'no machine selected'}</div>
                              <div>Action: Add verified machine capability</div>
                            </>
                          )}
                        </div>
                      );
                    })()}

                    <Button
                      onClick={handleExecuteCalculator}
                      disabled={executeCalculator.isPending}
                      className="w-full"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {executeCalculator.isPending ? 'Calculating...' : 'Calculate'}
                    </Button>
                    {calculatorError && (
                      <p className="text-xs text-destructive mt-2">{calculatorError}</p>
                    )}
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
                        // This calculator is being used only to derive a Cycle
                        // Time value for the main form (calculatorTarget ===
                        // 'cycleTime') — the cost breakdown (Machine/Labour/
                        // Process/Setup/Total Process Cost) duplicates what the
                        // main Edit Process Cost form already computes itself
                        // from its own MHR/LHR/Cycle Time inputs, so show only
                        // the one result that matters here: whichever of
                        // 'Total Time'/'Cycle Time' this calculator actually
                        // defines (see CYCLE_TIME_FIELD_NAMES above) — the
                        // same field computedCycleTime/"Use as Cycle Time"
                        // below already keys off.
                        .filter((field: any) => calculatorTarget !== 'cycleTime' || CYCLE_TIME_FIELD_NAMES.includes(field.fieldName))
                        .map((field: any) => {
                          const result = calculatorResults[field.fieldName];
                          const hasError = result && typeof result === 'object' && 'error' in result;
                          const value = hasError ? undefined : (result?.value !== undefined ? result.value : result);

                          return (
                            <div
                              key={field.id}
                              className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg"
                            >
                              <div>
                                <div className="font-medium">{field.displayName || field.fieldName}</div>
                                {field.unit && !hasError && (
                                  <div className="text-xs text-muted-foreground">{field.unit}</div>
                                )}
                                {field.defaultValue && (
                                  <div className="text-xs text-muted-foreground font-mono">
                                    Why: {field.displayLabel || field.fieldName} = {field.defaultValue}
                                  </div>
                                )}
                                {hasError && (
                                  <div className="text-xs text-destructive" title={result.error}>
                                    {result.error}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                {!hasError && (
                                  <div className="text-lg font-bold text-primary">
                                    {typeof value === 'number' ? value.toFixed(2) : value || 'N/A'}
                                  </div>
                                )}
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

                {/* Computed Cycle Time — derived from the calculator's own
                    'Total Time'/'Cycle Time' field (see CYCLE_TIME_FIELD_NAMES),
                    not re-derived here, so it can't disagree with the
                    Results above or the calculator's formula definition. */}
                {computedCycleTime && (
                  <Card className="border-primary bg-primary/5">
                    <CardHeader>
                      <CardTitle className="text-lg">Computed Cycle Time</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-2xl font-bold text-primary">
                            {computedCycleTime.totalTimeMin.toFixed(2)} min
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {computedCycleTime.totalTimeSec.toFixed(1)} sec — from this calculator's "Total Time" result
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleCalculatorValue(computedCycleTime.totalTimeSec)}
                        >
                          Use as Cycle Time
                        </Button>
                      </div>

                      {computedCycleTime.formula && (
                        <div className="text-xs text-muted-foreground bg-secondary/50 rounded p-2 font-mono">
                          Total Time (sec) = {computedCycleTime.formula}
                        </div>
                      )}

                      <div className="text-xs">
                        {computedCycleTime.matchesCurrent ? (
                          <span className="text-green-600 dark:text-green-500 font-medium">
                            ✓ Matches the Cycle Time currently set on this process ({computedCycleTime.currentCycleTimeSec.toFixed(1)} sec) — this is the value Direct Process Costs will use.
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-500 font-medium">
                            This process's saved Cycle Time is currently {computedCycleTime.currentCycleTimeSec.toFixed(1)} sec — click "Use as Cycle Time" so Direct Process Costs matches this calculator.
                          </span>
                        )}
                      </div>
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
            {lookupTableData.matchedRowKeys && (
              <span className="text-primary font-medium ml-1">The row outlined below is the one currently in use.</span>
            )}
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
                    // This row IS the exact one the lookup already resolved
                    // for the field the "eye" button was clicked on — every
                    // key in matchedRowKeys (the snapshot taken at
                    // resolution time) must match this row's own value.
                    // Numeric comparison tolerates string-vs-number typing
                    // differences between the two API responses; real
                    // lookup values never differ by a meaningful amount.
                    const matchedRowKeys = lookupTableData.matchedRowKeys;
                    const isCurrentMatch = !!matchedRowKeys && Object.entries(matchedRowKeys).every(([key, expected]) => {
                      const actual = row[key];
                      if (actual === undefined) return true; // column not present on this row shape — don't fail the match over it
                      if (typeof expected === 'number' || typeof actual === 'number') {
                        return Math.abs(Number(actual) - Number(expected)) < 1e-6;
                      }
                      return String(actual) === String(expected);
                    });
                    return (
                      <tr
                        key={rowIndex}
                        ref={isCurrentMatch ? matchedCurrentRowRef : undefined}
                        className={`hover:bg-primary/10 cursor-pointer transition-colors${isCurrentMatch ? ' ring-2 ring-inset ring-primary bg-primary/10' : ''}`}
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
                        title={isCurrentMatch
                          ? `Currently used for ${lookupTableData.fieldLabel}`
                          : (outputCol ? `Click to use: ${outputCol.label} = ${outputValue}` : `Click to select`)}
                      >
                        <td className={`border border-border text-center text-xs py-1 px-1 font-mono ${isCurrentMatch ? 'text-primary bg-primary/20' : 'text-muted-foreground bg-muted/20'}`}>
                          {isCurrentMatch ? '★' : rowIndex + 1}
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
