interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CostEngineeringService } from './cost-engineering.service';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import {
  QueryScrapRatesDto,
  QueryCountryFactorsDto,
  QueryMachineUtilizationDto,
  QueryToolLifeDto,
  QueryOverheadProfilesDto,
  QueryMaterialDensityDto,
  QueryMachinesDto,
  QuerySurfaceFinishCostsDto,
  QueryInspectionCostsDto,
  QueryFreightRatesDto,
  QueryMaterialPricesDto,
  QueryCycleTimesDto,
  QueryLaborContentDto,
  QuerySupplierCapabilitiesDto,
  QuerySustainabilityDto,
} from './dto/cost-engineering.dto';

@ApiTags('Cost Engineering')
@ApiBearerAuth()
@Controller({ path: 'api/cost-engineering', version: '1' })
export class CostEngineeringController {
  constructor(private readonly service: CostEngineeringService) {}

  @Get('scrap-rates')
  @ApiOperation({ summary: 'Process scrap rates by category and material' })
  @ApiResponse({ status: 200, description: 'List of scrap rate benchmarks' })
  getScrapRates(@Query() query: QueryScrapRatesDto, @AccessToken() token: string) {
    return this.service.getScrapRates(query, token);
  }

  @Get('country-factors')
  @ApiOperation({ summary: 'Country cost index factors for global sourcing comparison' })
  @ApiResponse({ status: 200, description: 'Country cost factor data (China=1.00 baseline)' })
  getCountryFactors(@Query() query: QueryCountryFactorsDto, @AccessToken() token: string) {
    return this.service.getCountryFactors(query, token);
  }

  @Get('machine-utilization')
  @ApiOperation({ summary: 'Machine effective utilization benchmarks by process and type' })
  @ApiResponse({ status: 200, description: 'Machine utilization factor data' })
  getMachineUtilization(@Query() query: QueryMachineUtilizationDto, @AccessToken() token: string) {
    return this.service.getMachineUtilization(query, token);
  }

  @Get('tool-life')
  @ApiOperation({ summary: 'Tool life reference data: cutting speed, feed, life, and cost per piece' })
  @ApiResponse({ status: 200, description: 'Tool life reference data' })
  getToolLife(@Query() query: QueryToolLifeDto, @AccessToken() token: string) {
    return this.service.getToolLife(query, token);
  }

  @Get('overhead-profiles')
  @ApiOperation({ summary: 'Overhead profiles by industry sector, region, and company size' })
  @ApiResponse({ status: 200, description: 'Overhead profile data' })
  getOverheadProfiles(@Query() query: QueryOverheadProfilesDto, @AccessToken() token: string) {
    return this.service.getOverheadProfiles(query, token);
  }

  @Get('material-density')
  @ApiOperation({ summary: 'Material density library for volume-to-weight cost calculations' })
  @ApiResponse({ status: 200, description: 'Material density data (kg/m³)' })
  getMaterialDensity(@Query() query: QueryMaterialDensityDto, @AccessToken() token: string) {
    return this.service.getMaterialDensity(query, token);
  }

  @Get('machines')
  @ApiOperation({ summary: 'Machine master with hourly rate low/mid/high bands' })
  @ApiResponse({ status: 200, description: 'Machine master data' })
  getMachines(@Query() query: QueryMachinesDto, @AccessToken() token: string) {
    return this.service.getMachines(query, token);
  }

  @Get('surface-finish-costs')
  @ApiOperation({ summary: 'Surface finish achievability and relative cost index by process' })
  @ApiResponse({ status: 200, description: 'Surface finish cost factor data' })
  getSurfaceFinishCosts(@Query() query: QuerySurfaceFinishCostsDto, @AccessToken() token: string) {
    return this.service.getSurfaceFinishCosts(query, token);
  }

  @Get('inspection-costs')
  @ApiOperation({ summary: 'Inspection level cost multipliers and AQL sample sizes' })
  @ApiResponse({ status: 200, description: 'Inspection cost factor data' })
  getInspectionCosts(@Query() query: QueryInspectionCostsDto, @AccessToken() token: string) {
    return this.service.getInspectionCosts(query, token);
  }

  @Get('freight-rates')
  @ApiOperation({ summary: 'Freight rates by mode, origin, and destination region' })
  @ApiResponse({ status: 200, description: 'Freight rate data (USD/kg)' })
  getFreightRates(@Query() query: QueryFreightRatesDto, @AccessToken() token: string) {
    return this.service.getFreightRates(query, token);
  }

  @Get('material-prices')
  @ApiOperation({ summary: 'Material price library by form, grade, and region (USD/kg)' })
  @ApiResponse({ status: 200, description: 'Material price data' })
  getMaterialPrices(@Query() query: QueryMaterialPricesDto, @AccessToken() token: string) {
    return this.service.getMaterialPrices(query, token);
  }

  @Get('cycle-times')
  @ApiOperation({ summary: 'Process cycle time library: MRR, shot cycle, laser speed, weld speed' })
  @ApiResponse({ status: 200, description: 'Cycle time reference data' })
  getCycleTimes(@Query() query: QueryCycleTimesDto, @AccessToken() token: string) {
    return this.service.getCycleTimes(query, token);
  }

  @Get('labor-content')
  @ApiOperation({ summary: 'Labor content library: operation time in minutes by region and skill level' })
  @ApiResponse({ status: 200, description: 'Labor content data' })
  getLaborContent(@Query() query: QueryLaborContentDto, @AccessToken() token: string) {
    return this.service.getLaborContent(query, token);
  }

  @Get('supplier-capabilities')
  @ApiOperation({ summary: 'Supplier capability benchmarks: world-class vs typical by process' })
  @ApiResponse({ status: 200, description: 'Supplier capability benchmark data' })
  getSupplierCapabilities(@Query() query: QuerySupplierCapabilitiesDto, @AccessToken() token: string) {
    return this.service.getSupplierCapabilities(query, token);
  }

  @Get('sustainability')
  @ApiOperation({ summary: 'Sustainability emission factors: kgCO2e/unit for materials, processes, and transport' })
  @ApiResponse({ status: 200, description: 'Sustainability factor data' })
  getSustainability(@Query() query: QuerySustainabilityDto, @AccessToken() token: string) {
    return this.service.getSustainability(query, token);
  }
}
