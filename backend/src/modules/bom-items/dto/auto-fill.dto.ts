export class AutoFillGeometryDto {
  volume: number;
  surfaceArea: number;
  boundingBox: { length: number; width: number; height: number };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
  weight: number;
  bendCount: number;
  cutLengthMm: number;
  sheetThicknessMm: number;
  pierceCount: number;
  flatPatternAreaMm2: number;
  holeDiameters: number[];
  bendRadii: number[];
}

export class AutoFillSuggestionsDto {
  name: string;
  partNumber: string;
  materialCategory: string;
  materialGrade: string;
  materialId: string | null;
  density: number | null;
  processType: string;
  familyClassification: string | null;     // detected part family (sheet_metal, cnc_milled, etc.)
  familyConfidence: number | null;         // 0–1 confidence from CAD engine
  makeBuy: 'make' | 'buy';
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
}

export class AutoFillCostsDto {
  materialCostPerKg: number | null;
  mhrRate: number | null;
  lhrRate: number | null;
  estimatedCycleTimeMin: number;
  calculatorId: string | null;
  estimatedUnitCost: number | null;
}

export class AutoFillConfidenceDto {
  overall: number;
  geometry: number;
  material: number;
  process: number;
  cost: number;
}

export class AutoFillResponseDto {
  fileName: string;
  geometry: AutoFillGeometryDto;
  suggestions: AutoFillSuggestionsDto;
  costs: AutoFillCostsDto;
  confidence: AutoFillConfidenceDto;
  cadEngineAvailable: boolean;
  featureGraph: object;
}
