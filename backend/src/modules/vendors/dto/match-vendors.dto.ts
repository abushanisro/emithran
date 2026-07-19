import { IsArray, IsString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class MatchVendorsDto {
  @IsArray()
  @IsString({ each: true })
  processes: string[];

  @IsOptional()
  @IsString()
  material?: string;

  @IsOptional()
  @IsString()
  toleranceClass?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  batchSize?: number;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface VendorScoreBreakdown {
  capability: number;     // 0–35
  quality: number;        // 0–20
  delivery: number;       // 0–15
  cost: number;           // 0–15
  certifications: number; // 0–10
  proximity: number;      // 0–5
  bonusPoints: number;    // 0–28
}

export interface RankedVendor {
  id: string;
  name: string;
  supplierCode: string;
  city: string;
  country: string;
  overallScore: number;
  scoreBreakdown: VendorScoreBreakdown;
  confidenceScore: number;
  whyBest: string[];
  qualityRating: number | null;
  deliveryRating: number | null;
  costRating: number | null;
  certifications: string[];
  email: string | null;
  classification: string;
  processTermsMatched: string[];
  materialMatch: boolean;
  /** How many of this part's required operation categories this vendor can cover */
  coveredCategoriesCount: number;
}

export interface RankedProcessGroup {
  processName: string;
  categoryLabel: string;
  /** All operation names from the route that were merged into this category group */
  mergedProcessNames: string[];
  vendors: RankedVendor[];
  totalFound: number;
}
