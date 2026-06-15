
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class QueryScrapRatesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Machining' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: 'Steel' })
  @IsOptional()
  @IsString()
  materialCategory?: string;
}

export class QueryCountryFactorsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Asia' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @IsString()
  countryCode?: string;
}

export class QueryMachineUtilizationDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: 'VMC' })
  @IsOptional()
  @IsString()
  machineType?: string;
}

export class QueryToolLifeDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Carbide Insert' })
  @IsOptional()
  @IsString()
  toolType?: string;

  @ApiPropertyOptional({ example: 'Steel' })
  @IsOptional()
  @IsString()
  workMaterial?: string;
}

export class QueryOverheadProfilesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Automotive' })
  @IsOptional()
  @IsString()
  industrySector?: string;

  @ApiPropertyOptional({ example: 'Asia' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Medium' })
  @IsOptional()
  @IsString()
  companySize?: string;
}

export class QueryMaterialDensityDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Steel' })
  @IsOptional()
  @IsString()
  materialCategory?: string;

  @ApiPropertyOptional({ example: 'SS304' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class QueryMachinesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'CNC' })
  @IsOptional()
  @IsString()
  machineCategory?: string;

  @ApiPropertyOptional({ example: 'VMC' })
  @IsOptional()
  @IsString()
  machineSubcategory?: string;
}

export class QuerySurfaceFinishCostsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Grinding' })
  @IsOptional()
  @IsString()
  processName?: string;
}

export class QueryInspectionCostsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'AQL Level 1' })
  @IsOptional()
  @IsString()
  inspectionLevel?: string;
}

export class QueryFreightRatesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Air' })
  @IsOptional()
  @IsString()
  modeOfTransport?: string;

  @ApiPropertyOptional({ example: 'Asia' })
  @IsOptional()
  @IsString()
  originRegion?: string;

  @ApiPropertyOptional({ example: 'Europe' })
  @IsOptional()
  @IsString()
  destinationRegion?: string;
}

export class QueryMaterialPricesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Bar / Rod' })
  @IsOptional()
  @IsString()
  materialForm?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Steel' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class QueryCycleTimesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Injection Moulding' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: 'Plastic' })
  @IsOptional()
  @IsString()
  materialCategory?: string;
}

export class QueryLaborContentDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processCategory?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Semi-Skilled' })
  @IsOptional()
  @IsString()
  skillLevel?: string;
}

export class QuerySupplierCapabilitiesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processCategory?: string;
}

export class QuerySustainabilityDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Material' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'Aluminium' })
  @IsOptional()
  @IsString()
  search?: string;
}
