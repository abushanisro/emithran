/**
 * EngineeringBrief — Stage 1 output, fed to the LLM in Stage 2.
 *
 * Pure data structure (no class-validator decorators) because it's never
 * accepted as HTTP input — it's assembled server-side from existing tables.
 */

export type PartFamily =
  | 'turned'
  | 'milled'
  | 'sheet_metal'
  | 'plastic_molded'
  | 'out_of_scope';

export interface PartFamilyDecision {
  family: PartFamily;
  inScope: boolean;
  reason: string;
  confidence: number;
}

export interface BriefBomItem {
  id: string;
  partNumber: string;
  partName: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  unit: string;
  annualVolume: number;
  unitWeightKg: number;
  dimensions: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };
  tolerance: string | null;
  surfaceFinishRa: string | null;
  heatTreatment: string | null;
  hardnessHrc: number | null;
  materialHint: string | null;
  /** Resolved from raw_materials.material_family via DB lookup before scope classification.
   *  Values: polymer_thermoplastic | polymer_thermoset | elastomer | ferrous_mild_steel |
   *          ferrous_alloy_steel | ferrous_stainless | ferrous_cast_iron |
   *          non_ferrous_aluminum | non_ferrous_copper | non_ferrous_titanium | superalloy
   *  Null/undefined when materialHint had no match in raw_materials. */
  materialFamily?: string | null;
  coating: string | null;             // from bom_items.coating (drawing-confirmed)
  tightestToleranceMm: number | null; // from bom_items.tightest_tolerance_mm
}

export interface BriefDfm {
  volumeMm3: number;
  surfaceAreaMm2: number;
  boundingBox: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
  undercutCount: number;
  fromCadEngine: boolean;
  // From Python manufacturing_intelligence (sheet_metal family)
  bendCount: number;
  slotCount: number;
  cutLengthMm: number;
  sheetThicknessMm: number;
  // CAD engine's own family decision — strong override signal for scope classifier
  cadDetectedFamily?: string;
}

/**
 * The process-plan generator's single working currency: retrieval converts
 * every candidate rate into it (queryMhr/queryLhr/queryRawMaterials), so the
 * draft's amounts and the rows persisted from it are in this currency.
 */
export const PLAN_WORKING_CURRENCY = 'INR' as const;

interface BriefContext {
  /** Digital Factory location the plan is for; null when neither the item nor its organization names one (see warnings). */
  organizationLocation: string | null;
  /** Where organizationLocation came from. */
  locationSource?: 'scenario_override' | 'organization' | 'unknown';
  // The generator's working currency: every candidate rate is converted INTO
  // INR during retrieval (queryMhr/queryLhr/queryRawMaterials), so persisted
  // amounts are INR and are labelled INR — a label, not an assumed location.
  currency: 'INR';
  language: 'en';
  exchangeRateSnapshot?: Record<string, number>; // e.g. { USD: 83.5, EUR: 89.0 }
  /** Assumptions made while assembling the brief (unknown location, assumed density, ...). */
  warnings?: string[];
}

import type { DrawingBrief } from './drawing-brief.dto';
import type { ManufacturingFeatureGraph, MandatoryOp } from './manufacturing-feature.dto';
import type { PartFamilyRoutingTemplate } from '../../../modules/manufacturing-knowledge/dto/kb.dto';

export interface EngineeringBrief {
  bomItem: BriefBomItem;
  dfm: BriefDfm;
  drawing: DrawingBrief;
  featureGraph: ManufacturingFeatureGraph;
  mandatoryOps: MandatoryOp[];
  context: BriefContext;
  scope: PartFamilyDecision;
  routingTemplate?: PartFamilyRoutingTemplate | null;
}
