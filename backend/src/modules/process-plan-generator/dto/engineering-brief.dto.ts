/**
 * EngineeringBrief — Stage 1 output, fed to the LLM in Stage 2.
 *
 * Pure data structure (no class-validator decorators) because it's never
 * accepted as HTTP input — it's assembled server-side from existing tables.
 */

export type PartFamily =
  | 'cnc_turned'
  | 'cnc_milled'
  | 'sheet_metal'
  | 'injection_molded'
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

export interface BriefContext {
  organizationLocation: string;
  currency: 'INR';
  language: 'en';
  exchangeRateSnapshot?: Record<string, number>; // e.g. { USD: 83.5, EUR: 89.0 }
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
