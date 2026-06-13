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
}

export interface BriefContext {
  organizationLocation: string;
  currency: 'INR';
  language: 'en';
}

import type { DrawingBrief } from './drawing-brief.dto';

export interface EngineeringBrief {
  bomItem: BriefBomItem;
  dfm: BriefDfm;
  drawing: DrawingBrief;
  context: BriefContext;
  scope: PartFamilyDecision;
}
