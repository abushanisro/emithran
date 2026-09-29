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
  materialCategory: string | null;
  materialGrade: string;
  materialId: string | null;
  density: number | null;
  /** The CAD family's real process_taxonomy group (e.g. "Machining"), or null. */
  processType: string | null;
  /** Real catalog machine for machining parts (e.g. "3 Axis Mill"), else null. */
  suggestedMachine: string | null;
  familyClassification: string | null;     // detected part family (sheet_metal, milled, etc.)
  familyConfidence: number | null;         // 0–1 confidence from CAD engine
}

export class AutoFillResponseDto {
  fileName: string;
  geometry: AutoFillGeometryDto;
  suggestions: AutoFillSuggestionsDto;
  featureGraph: object;
}
