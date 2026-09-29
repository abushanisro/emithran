// Chemical milling (Mask Cure, Scribe, Etch Cell, DeMask), costed only from the
// memory/Machining reference data and the part's own CAD pockets.
//
// Applies when the drawing carries a chemical-milling callout
// (drawing_intelligence.chemical_milling, cad-engine drawing analyzer). Every
// CAD pocket is then etched rather than milled (product decision 2026-09-29):
// etch area = length x width, outline = 2 x (length + width), depth = pocket
// depth (the pocket's own bounding-box dimensions).
//
// Reference (machining_reference_data, source_version 2026-03):
//   tblMaskingMaterials             cure time by heated / unheated cure
//   tblChemicalMilling              peel rate by component (part surface) area
//   tblChemicalMillingEtchingRates  etch rate by material type
//   variables  defaultChemMillRinsingTime, defaultChemMillDryingTime,
//              defaultChemMillDesmutTime, defaultChemMillDesmutRinseTime (min),
//              defaultEdgeDressingRate (mm/s), demaskPeelTimeUpperCap (min)
// Machines (migration 738, envelope and specs migration 838): the etch tank and
// cure oven sizes fit parts per load (the load's time is shared across them,
// capped at the batch size); the oven's heated_cure picks the cure time; the
// scribe's own feed rate and programming time price scribing.
//
// The catalog's Etch Cell "Depth Inspecting" step has no time in the reference
// and is reported as not priced. tblChemicalMilling's manual clean rate belongs
// to no listed operation and is not used.

import {
  costed, notCosted, envelopeCapable, maxPartsInBox, num, pickMachine, sorted,
  type SecondaryMachine, type SecondaryPartFacts, type SecondaryProcessResult,
  type SecondaryReference, type SecondaryTraceStep,
} from '../secondary/secondary-process-engine';
import type { MaterialClass } from '../machining/process/cost-machining-engine';

export const CHEMICAL_MILLING_SOURCE_VERSION = '2026-03';

export const CHEMICAL_MILLING_PROCESSES: ReadonlyArray<{ process: string; machineClass: string }> = [
  { process: 'Mask Cure', machineClass: 'mask_cure' },
  { process: 'Scribe', machineClass: 'scribe' },
  { process: 'Etch Cell', machineClass: 'etch_cell' },
  { process: 'DeMask', machineClass: 'demask' },
];

export const CHEMICAL_MILLING_TABLES = ['tblMaskingMaterials', 'tblChemicalMilling', 'tblChemicalMillingEtchingRates'] as const;
export const CHEMICAL_MILLING_VARIABLES = [
  'defaultChemMillRinsingTime', 'defaultChemMillDryingTime', 'defaultChemMillDesmutTime',
  'defaultChemMillDesmutRinseTime', 'defaultEdgeDressingRate', 'demaskPeelTimeUpperCap',
] as const;

/** One CAD pocket group (machining_features PocketV2). */
export interface ChemMillPocket {
  id: string;
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  count: number;
}

export interface ChemMillPartFacts extends SecondaryPartFacts {
  materialClass: MaterialClass;
  pockets: ChemMillPocket[];
}

// Material class -> tblChemicalMillingEtchingRates material type. Tool steel is
// a steel; plastics are not chemically milled (no row).
const ETCH_MATERIAL_TYPE: Partial<Record<MaterialClass, string>> = {
  aluminum: 'Aluminum', copper_alloy: 'Copper', stainless: 'Stainless Steel',
  mild_steel: 'Steel', tool_steel: 'Steel', titanium: 'Titanium',
};

const SRC_VAR = 'memory/Machining/variables.csv';
const SRC = (t: string) => `memory/Machining/lookup (${t})`;
const minutesVar = (ref: SecondaryReference, key: string) => num(ref.variables.get(key));

const pocketArea = (p: ChemMillPocket) => p.lengthMm * p.widthMm * p.count;
const pocketOutline = (p: ChemMillPocket) => 2 * (p.lengthMm + p.widthMm) * p.count;

/** Parts of this bounding box per load in the machine's envelope, capped at the batch. */
function partsPerLoad(part: ChemMillPartFacts, m: SecondaryMachine): number | null {
  if (!part.bboxMm || m.maxXmm == null || m.maxYmm == null || m.maxZmm == null) return null;
  const n = maxPartsInBox(sorted(part.bboxMm), [m.maxXmm, m.maxYmm, m.maxZmm].sort((a, b) => b - a) as [number, number, number]);
  if (n < 1) return null;
  return part.batchSize != null && part.batchSize > 0 ? Math.min(n, part.batchSize) : n;
}

function loadTrace(trace: SecondaryTraceStep[], m: SecondaryMachine, n: number, part: ChemMillPartFacts) {
  trace.push({ label: 'Parts per load', value: n, source: `part box ${part.bboxMm!.length} x ${part.bboxMm!.width} x ${part.bboxMm!.height} mm in ${m.name} (${m.maxXmm} x ${m.maxYmm} x ${m.maxZmm} mm)${part.batchSize != null ? `, capped at batch ${part.batchSize}` : ''}` });
}

/** The tblChemicalMilling row for this part's surface area (smallest bracket covering it). */
function peelRow(ref: SecondaryReference, areaMm2: number): Record<string, unknown> | null {
  const rows = [...(ref.lookups.get('tblChemicalMilling') ?? [])]
    .filter((r) => num(r['component_area_mm2']) != null)
    .sort((a, b) => num(a['component_area_mm2'])! - num(b['component_area_mm2'])!);
  return rows.find((r) => areaMm2 <= num(r['component_area_mm2'])!) ?? null;
}

function maskCure(base: { process: string; machineClass: string }, part: ChemMillPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const m = pickMachine(base.process, envelopeCapable(pool, part).filter((x) => typeof x.specs['heated_cure'] === 'boolean'), ref);
  if (!m) return notCosted(base, 'gap', 'No cure oven on file takes the part (or none has heated_cure, migration 838).');
  const heated = m.specs['heated_cure'] as boolean;
  const row = (ref.lookups.get('tblMaskingMaterials') ?? []).find((r) => r['Heated Cure'] === heated);
  const cureHr = row ? num(row['Cure Time (hr)']) : null;
  if (cureHr == null) return notCosted(base, 'gap', `tblMaskingMaterials has no ${heated ? 'heated' : 'unheated'} cure time.`);
  const n = partsPerLoad(part, m);
  if (n == null) return notCosted(base, 'gap', `The part's size or ${m.name}'s oven size is not on file.`);
  const trace: SecondaryTraceStep[] = [
    { label: 'Maskant cure time', value: cureHr, unit: 'hr', source: `${SRC('tblMaskingMaterials')}: ${row!['Maskant']}, ${heated ? 'heated' : 'unheated'} cure (${m.name})` },
  ];
  loadTrace(trace, m, n, part);
  return costed(base, m, { perPartSec: (cureHr * 3600) / n, trace, highlight: 'whole_part' }, ref, part.batchSize);
}

function scribe(base: { process: string; machineClass: string }, part: ChemMillPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const m = pickMachine(base.process, envelopeCapable(pool, part).filter((x) => num(x.specs['feed_rate_mm_per_min']) != null), ref);
  if (!m) return notCosted(base, 'gap', 'No scribe on file takes the part (or none has a feed rate, migration 838).');
  const feed = num(m.specs['feed_rate_mm_per_min'])!;
  const outline = part.pockets.reduce((s, p) => s + pocketOutline(p), 0);
  const progHr = num(m.specs['programming_time_hr']) ?? 0;
  const trace: SecondaryTraceStep[] = [
    { label: 'Scribed outline', value: Number(outline.toFixed(1)), unit: 'mm', source: 'CAD pockets: 2 x (length + width) each' },
    { label: 'Scribe feed rate', value: feed, unit: 'mm/min', source: `machine ${m.name}` },
    { label: 'Programming', value: progHr, unit: 'hr/batch', source: `machine ${m.name}` },
  ];
  return costed(base, m, { perPartSec: (outline / feed) * 60, batchExtraSec: progHr * 3600, trace, highlight: 'features', featureIds: part.pockets.map((p) => p.id) }, ref, part.batchSize);
}

function etchCell(base: { process: string; machineClass: string }, part: ChemMillPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const type = ETCH_MATERIAL_TYPE[part.materialClass];
  const rateRow = type ? (ref.lookups.get('tblChemicalMillingEtchingRates') ?? []).find((r) => r['material_type'] === type) : undefined;
  const etchRate = rateRow ? num(rateRow['etch_rate_mm_min']) : null;
  if (etchRate == null || etchRate <= 0) return notCosted(base, 'gap', `tblChemicalMillingEtchingRates has no etch rate for ${part.materialClass}.`);
  const steps = (['defaultChemMillRinsingTime', 'defaultChemMillDryingTime', 'defaultChemMillDesmutTime', 'defaultChemMillDesmutRinseTime'] as const)
    .map((k) => ({ k, v: minutesVar(ref, k) }));
  const missingStep = steps.find((s) => s.v == null);
  if (missingStep) return notCosted(base, 'gap', `variables ${missingStep.k} is not staged.`);
  if (part.surfaceAreaMm2 == null) return notCosted(base, 'gap', 'The part surface area is not on file (picks the tblChemicalMilling peel rate).');
  const peel = peelRow(ref, part.surfaceAreaMm2);
  const peelRate = peel ? num(peel['peel_rate_mm2_s']) : null;
  if (peelRate == null || peelRate <= 0) return notCosted(base, 'gap', `tblChemicalMilling has no peel rate for a ${Math.round(part.surfaceAreaMm2)} mm² part.`);
  const m = pickMachine(base.process, envelopeCapable(pool, part).filter((x) => x.maxXmm != null), ref);
  if (!m) return notCosted(base, 'gap', 'No etch tank on file takes the part.');
  const n = partsPerLoad(part, m);
  if (n == null) return notCosted(base, 'gap', `The part's size or ${m.name}'s tank size is not on file.`);

  const depth = Math.max(...part.pockets.map((p) => p.depthMm));
  const etchMin = depth / etchRate;
  const tankMin = etchMin + steps.reduce((s, x) => s + x.v!, 0);
  const area = part.pockets.reduce((s, p) => s + pocketArea(p), 0);
  const peelSec = area / peelRate;
  const trace: SecondaryTraceStep[] = [
    { label: 'Etch depth (deepest pocket)', value: depth, unit: 'mm', source: 'CAD pockets' },
    { label: 'Etch rate', value: etchRate, unit: 'mm/min', source: `${SRC('tblChemicalMillingEtchingRates')}: ${type}` },
    { label: 'Pocket etching', value: Number(etchMin.toFixed(2)), unit: 'min/load', source: 'depth / etch rate' },
    ...steps.map((s) => ({ label: s.k.replace('defaultChemMill', '').replace('Time', ''), value: s.v!, unit: 'min/load', source: `${SRC_VAR} (${s.k})` })),
  ];
  loadTrace(trace, m, n, part);
  trace.push({ label: 'Pocket peeling', value: Number(peelSec.toFixed(1)), unit: 's/part',
    source: `CAD pocket area ${Math.round(area)} mm² / ${SRC('tblChemicalMilling')} peel rate ${peelRate} mm²/s (part area up to ${num(peel!['component_area_mm2'])} mm²)` });
  return costed(base, m, {
    perPartSec: (tankMin * 60) / n + peelSec,
    trace,
    warnings: ['Etch Cell "Depth Inspecting" has no time in the reference data; not priced.'],
    highlight: 'features', featureIds: part.pockets.map((p) => p.id),
  }, ref, part.batchSize);
}

function deMask(base: { process: string; machineClass: string }, part: ChemMillPartFacts, ref: SecondaryReference, pool: SecondaryMachine[]): SecondaryProcessResult {
  const m = pickMachine(base.process, envelopeCapable(pool, part), ref);
  if (!m) return notCosted(base, 'gap', 'No demask cell on file.');
  const cap = minutesVar(ref, 'demaskPeelTimeUpperCap');
  const dressRate = minutesVar(ref, 'defaultEdgeDressingRate');
  if (cap == null || dressRate == null || dressRate <= 0) return notCosted(base, 'gap', 'variables demaskPeelTimeUpperCap / defaultEdgeDressingRate are not staged.');
  if (part.surfaceAreaMm2 == null) return notCosted(base, 'gap', 'The part surface area is not on file.');
  const peel = peelRow(ref, part.surfaceAreaMm2);
  const peelRate = peel ? num(peel['peel_rate_mm2_s']) : null;
  if (peelRate == null || peelRate <= 0) return notCosted(base, 'gap', `tblChemicalMilling has no peel rate for a ${Math.round(part.surfaceAreaMm2)} mm² part.`);
  const peelSec = Math.min(part.surfaceAreaMm2 / peelRate, cap * 60);
  const outline = part.pockets.reduce((s, p) => s + pocketOutline(p), 0);
  const dressSec = outline / dressRate;
  const trace: SecondaryTraceStep[] = [
    { label: 'Peeling residual maskant', value: Number(peelSec.toFixed(1)), unit: 's',
      source: `part area ${Math.round(part.surfaceAreaMm2)} mm² / peel rate ${peelRate} mm²/s (${SRC('tblChemicalMilling')}), capped at ${cap} min (${SRC_VAR} demaskPeelTimeUpperCap)` },
    { label: 'Dressing edges', value: Number(dressSec.toFixed(1)), unit: 's',
      source: `pocket outline ${Math.round(outline)} mm / ${dressRate} mm/s (${SRC_VAR} defaultEdgeDressingRate)` },
  ];
  return costed(base, m, { perPartSec: peelSec + dressSec, trace, highlight: 'features', featureIds: part.pockets.map((p) => p.id) }, ref, part.batchSize);
}

const MODELS: Record<string, (b: { process: string; machineClass: string }, p: ChemMillPartFacts, r: SecondaryReference, pool: SecondaryMachine[]) => SecondaryProcessResult> = {
  'Mask Cure': maskCure, Scribe: scribe, 'Etch Cell': etchCell, DeMask: deMask,
};

/**
 * The four chemical-milling lines for a part whose drawing calls for it.
 * `callout` null = no chemical-milling callout: every line is not applicable.
 */
export function computeChemicalMilling(
  part: ChemMillPartFacts,
  callout: string | null,
  ref: SecondaryReference,
  machines: SecondaryMachine[],
): SecondaryProcessResult[] {
  return CHEMICAL_MILLING_PROCESSES.map((base) => {
    if (!callout) return notCosted(base, 'not_applicable', 'The drawing has no chemical milling callout.');
    if (part.pockets.length === 0) return notCosted(base, 'gap', `The drawing calls for chemical milling ("${callout}") but CAD found no pockets to etch.`);
    return MODELS[base.process]!(base, part, ref, machines.filter((m) => m.machineClass === base.machineClass));
  });
}

/** The drawing's chemical-milling callout, or null ("None" / absent). */
export function chemicalMillingCallout(drawingIntelligence: any): string | null {
  const v = drawingIntelligence?.chemical_milling;
  return typeof v === 'string' && v.trim() !== '' && v.trim().toLowerCase() !== 'none' ? v.trim() : null;
}

/**
 * On a chemically milled part every CAD pocket is etched, not milled: pulled
 * out of the machining operation sequence (same pre-filter pattern as the
 * keyway / Wire EDM splits) so it is not priced twice. No callout = no change.
 */
export function splitChemicallyMilledPockets<T>(
  features: T[],
  callout: string | null,
): { filteredFeatures: T[]; etchedPocketGroups: number } {
  if (!callout) return { filteredFeatures: features, etchedPocketGroups: 0 };
  const filteredFeatures = features.filter((f) => (f as { feature_type?: string } | null)?.feature_type !== 'PocketV2');
  return { filteredFeatures, etchedPocketGroups: features.length - filteredFeatures.length };
}
