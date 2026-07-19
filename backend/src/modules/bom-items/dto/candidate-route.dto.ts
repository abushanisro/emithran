import type { BlankSpecDto } from './blank-spec.dto';
import type { ProcessLineCost } from './cost-breakdown.dto';

export interface CandidateRouteDto {
  candidateId: string;
  blankSpec: BlankSpecDto;
  routeLabel: string;
  routeId: string | null;
  processLines: ProcessLineCost[];
  totalCost: number;
  materialCost: number;
  totalProcessCost: number;
  cycleTimes: { totalMin: number };
  isFeasible: boolean;
  feasibilityNotes: string[];
  isPrimary: boolean;
  badges: { lowestCost: boolean; fastest: boolean; lowestWaste: boolean };
}

export interface CandidateRouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  location: string;
  currency?: string;
  currencySymbol?: string;
  candidates: CandidateRouteDto[];
}
