import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateLSRDto {
  @IsString()
  labourCode: string;

  @IsString()
  labourType: string;

  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  minimumWagePerDay: number;

  @IsNumber()
  @Min(0)
  minimumWagePerMonth: number;

  @IsNumber()
  @Min(0)
  dearnessAllowance: number;

  @IsNumber()
  @Min(0)
  perksPercentage: number;

  @IsNumber()
  @Min(0)
  lhr: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  location?: string;

  // India 2026 extended fields
  @IsOptional() @IsString() processGroup?: string;
  @IsOptional() @IsString() machineName?: string;
  @IsOptional() @IsString() machineDescription?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() manufacturerCountry?: string;
  @IsOptional() @IsString() wageGrade?: string;
  @IsOptional() @IsNumber() @Min(1) operators?: number;
  @IsOptional() @IsNumber() @Min(0) shiftsPerDay?: number;
  @IsOptional() @IsNumber() @Min(0) hoursPerShift?: number;
  @IsOptional() @IsNumber() @Min(0) workingDaysPerYear?: number;
  @IsOptional() @IsNumber() @Min(0) totalHrsPerYear?: number;
  @IsOptional() @IsNumber() @Min(0) usdLaborRatePerHr?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrBase?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrBurden?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrTotal?: number;
  @IsOptional() @IsNumber() @Min(0) lhrUsdEffective?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() currencySymbol?: string;
}

export class UpdateLSRDto {
  @IsOptional() @IsString() labourCode?: string;
  @IsOptional() @IsString() labourType?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Min(0) minimumWagePerDay?: number;
  @IsOptional() @IsNumber() @Min(0) minimumWagePerMonth?: number;
  @IsOptional() @IsNumber() @Min(0) dearnessAllowance?: number;
  @IsOptional() @IsNumber() @Min(0) perksPercentage?: number;
  @IsOptional() @IsNumber() @Min(0) lhr?: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() location?: string;
  // India 2026 extended fields
  @IsOptional() @IsString() processGroup?: string;
  @IsOptional() @IsString() machineName?: string;
  @IsOptional() @IsString() machineDescription?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() manufacturerCountry?: string;
  @IsOptional() @IsString() wageGrade?: string;
  @IsOptional() @IsNumber() @Min(1) operators?: number;
  @IsOptional() @IsNumber() @Min(0) shiftsPerDay?: number;
  @IsOptional() @IsNumber() @Min(0) hoursPerShift?: number;
  @IsOptional() @IsNumber() @Min(0) workingDaysPerYear?: number;
  @IsOptional() @IsNumber() @Min(0) totalHrsPerYear?: number;
  @IsOptional() @IsNumber() @Min(0) usdLaborRatePerHr?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrBase?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrBurden?: number;
  @IsOptional() @IsNumber() @Min(0) usdLhrTotal?: number;
  @IsOptional() @IsNumber() @Min(0) lhrUsdEffective?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() currencySymbol?: string;
}
