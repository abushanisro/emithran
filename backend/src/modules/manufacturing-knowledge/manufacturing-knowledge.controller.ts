import { Controller, Get, Post, Body, Query, Request } from '@nestjs/common';
import { ManufacturingKnowledgeService } from './manufacturing-knowledge.service';
import { ProcessValidationService } from './services/process-validation.service';
import type {
  CreateFeatureProcessMappingDto,
  CreateMachineCapabilityDto,
  CreateProcessRoutingRuleDto,
} from './dto/kb.dto';
import { OrgRole } from '../../common/authz/authz-policy';

@OrgRole('member')
@Controller('api')
export class ManufacturingKnowledgeController {
  constructor(
    private readonly kb: ManufacturingKnowledgeService,
    private readonly validation: ProcessValidationService,
  ) {}

  @OrgRole('viewer')
  @Get('feature-process-mappings')
  getFeatureProcessMapping(@Request() req: any, @Query('featureType') featureType?: string) {
    return this.kb.getFeatureProcessMapping(req.token, featureType);
  }

  @Post('feature-process-mappings')
  createFeatureProcessMapping(@Request() req: any, @Body() dto: CreateFeatureProcessMappingDto) {
    return this.kb.createFeatureProcessMapping(req.token, dto, req.user.id);
  }

  @OrgRole('viewer')
  @Get('machine-capabilities')
  getMachineCapabilities(@Request() req: any, @Query('machineType') machineType?: string) {
    return this.kb.getMachineCapabilities(req.token, machineType);
  }

  @Post('machine-capabilities')
  createMachineCapability(@Request() req: any, @Body() dto: CreateMachineCapabilityDto) {
    return this.kb.createMachineCapability(req.token, dto, req.user.id);
  }

  @OrgRole('viewer')
  @Get('routing-rules')
  getRoutingRules(@Request() req: any, @Query('partFamily') partFamily?: string) {
    return this.kb.getRoutingRules(req.token, partFamily);
  }

  @Post('routing-rules')
  createRoutingRule(@Request() req: any, @Body() dto: CreateProcessRoutingRuleDto) {
    return this.kb.createRoutingRule(req.token, dto, req.user.id);
  }

  @OrgRole('viewer')
  @Get('routing-templates')
  getTemplates(@Request() req: any, @Query('partFamily') partFamily?: string, @Query('complexity') complexity?: string) {
    if (partFamily) return this.kb.getTemplate(req.token, partFamily, complexity);
    return this.kb.getAllTemplates(req.token);
  }





}
