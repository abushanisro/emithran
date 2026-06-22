import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ManufacturingKnowledgeService } from './manufacturing-knowledge.service';
import { ProcessValidationService } from './services/process-validation.service';
import type {
  CreateFeatureProcessMappingDto,
  CreateMachineCapabilityDto,
  CreateProcessRoutingRuleDto,
  SubmitFeedbackDto,
  ValidateRouteDto,
} from './dto/kb.dto';

@Controller('api/manufacturing-knowledge')
export class ManufacturingKnowledgeController {
  constructor(
    private readonly kb: ManufacturingKnowledgeService,
    private readonly validation: ProcessValidationService,
  ) {}

  @Get('feature-process-mapping')
  getFeatureProcessMapping(@Request() req: any, @Query('featureType') featureType?: string) {
    return this.kb.getFeatureProcessMapping(req.token, featureType);
  }

  @Post('feature-process-mapping')
  createFeatureProcessMapping(@Request() req: any, @Body() dto: CreateFeatureProcessMappingDto) {
    return this.kb.createFeatureProcessMapping(req.token, dto, req.user.id);
  }

  @Get('machine-capabilities')
  getMachineCapabilities(@Request() req: any, @Query('machineType') machineType?: string) {
    return this.kb.getMachineCapabilities(req.token, machineType);
  }

  @Post('machine-capabilities')
  createMachineCapability(@Request() req: any, @Body() dto: CreateMachineCapabilityDto) {
    return this.kb.createMachineCapability(req.token, dto, req.user.id);
  }

  @Get('routing-rules')
  getRoutingRules(@Request() req: any, @Query('partFamily') partFamily?: string) {
    return this.kb.getRoutingRules(req.token, partFamily);
  }

  @Post('routing-rules')
  createRoutingRule(@Request() req: any, @Body() dto: CreateProcessRoutingRuleDto) {
    return this.kb.createRoutingRule(req.token, dto, req.user.id);
  }

  @Get('templates')
  getTemplates(@Request() req: any, @Query('partFamily') partFamily?: string, @Query('complexity') complexity?: string) {
    if (partFamily) return this.kb.getTemplate(req.token, partFamily, complexity);
    return this.kb.getAllTemplates(req.token);
  }

  @Get('templates/:partFamily')
  getTemplate(@Request() req: any, @Param('partFamily') partFamily: string, @Query('complexity') complexity?: string) {
    return this.kb.getTemplate(req.token, partFamily, complexity);
  }

  @Get('machine-process-mapping')
  getMachineProcessMapping(@Request() req: any, @Query('featureType') featureType?: string, @Query('partFamily') partFamily?: string) {
    return this.kb.getMachineProcessMapping(req.token, featureType, partFamily);
  }

  @Post('feedback')
  submitFeedback(@Request() req: any, @Body() dto: SubmitFeedbackDto) {
    return this.kb.submitFeedback(req.token, dto, req.user.id);
  }

  @Get('feedback/:bomItemId')
  getFeedback(@Request() req: any, @Param('bomItemId') bomItemId: string) {
    return this.kb.getFeedbackForBomItem(req.token, bomItemId);
  }

  @Post('validate-route')
  async validateRoute(@Request() req: any, @Body() dto: ValidateRouteDto) {
    const [rules, capabilities] = await Promise.all([
      this.kb.getRoutingRules(req.token, dto.partFamily),
      this.kb.getMachineCapabilities(req.token),
    ]);
    const routeIssues = this.validation.validateRoute(dto.processSequence, dto.partFamily, rules);
    const machineIssues = dto.machineAssignments
      ? this.validation.validateMachines(dto.processSequence, dto.machineAssignments, capabilities)
      : [];
    return [...routeIssues, ...machineIssues];
  }
}
