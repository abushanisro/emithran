import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type {
  FeatureProcessMapping,
  MachineCapability,
  ProcessRoutingRule,
  PartFamilyRoutingTemplate,
  MachineProcessMapping,
  ProcessPlanFeedback,
  CreateFeatureProcessMappingDto,
  CreateMachineCapabilityDto,
  CreateProcessRoutingRuleDto,
  SubmitFeedbackDto,
} from './dto/kb.dto';

@Injectable()
export class ManufacturingKnowledgeService {
  private readonly logger = new Logger(ManufacturingKnowledgeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getFeatureProcessMapping(token: string, featureType?: string): Promise<FeatureProcessMapping[]> {
    let q = this.supabase.getClient(token).from('feature_process_mapping').select('*').order('feature_type');
    if (featureType) q = q.eq('feature_type', featureType);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(`feature_process_mapping: ${error.message}`);
    return data ?? [];
  }

  async getMachineCapabilities(token: string, machineType?: string): Promise<MachineCapability[]> {
    let q = this.supabase.getClient(token).from('machine_capabilities').select('*').order('machine_type');
    if (machineType) q = q.eq('machine_type', machineType);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(`machine_capabilities: ${error.message}`);
    return data ?? [];
  }

  async getRoutingRules(token: string, partFamily?: string): Promise<ProcessRoutingRule[]> {
    const { data, error } = await this.supabase.getClient(token).from('process_routing_rules').select('*').order('severity').order('rule_name');
    if (error) throw new InternalServerErrorException(`process_routing_rules: ${error.message}`);
    const rows = (data ?? []) as ProcessRoutingRule[];
    if (!partFamily) return rows;
    return rows.filter((r) => !r.applies_to_families || r.applies_to_families.length === 0 || r.applies_to_families.includes(partFamily));
  }

  async getTemplate(token: string, partFamily: string, complexity?: string): Promise<PartFamilyRoutingTemplate | null> {
    let q = this.supabase.getClient(token).from('part_family_routing_templates').select('*').eq('part_family', partFamily);
    if (complexity) q = q.eq('complexity_level', complexity);
    else q = q.eq('complexity_level', 'standard');
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) {
      this.logger.warn(`template lookup: ${error.message}`);
      return null;
    }
    return data as PartFamilyRoutingTemplate | null;
  }

  async getAllTemplates(token: string): Promise<PartFamilyRoutingTemplate[]> {
    const { data, error } = await this.supabase.getClient(token)
      .from('part_family_routing_templates')
      .select('*')
      .order('part_family');
    if (error) {
      this.logger.warn(`getAllTemplates: ${error.message}`);
      return [];
    }
    return (data ?? []) as PartFamilyRoutingTemplate[];
  }

  async getAlternativeTemplates(token: string, partFamily: string): Promise<PartFamilyRoutingTemplate[]> {
    const { data, error } = await this.supabase.getClient(token)
      .from('part_family_routing_templates')
      .select('*')
      .eq('part_family', partFamily)
      .order('complexity_level');
    if (error) {
      this.logger.warn(`getAlternativeTemplates: ${error.message}`);
      return [];
    }
    return (data ?? []) as PartFamilyRoutingTemplate[];
  }

  async getMachineProcessMapping(token: string, featureType?: string, partFamily?: string): Promise<MachineProcessMapping[]> {
    let q = this.supabase.getClient(token).from('machine_process_mapping').select('*').order('priority');
    if (featureType) q = q.eq('feature_type', featureType);
    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(`machine_process_mapping: ${error.message}`);
    const rows = (data ?? []) as MachineProcessMapping[];
    if (!partFamily) return rows;
    return rows.filter((r) => !r.applies_to_family || r.applies_to_family === partFamily);
  }

  async submitFeedback(token: string, dto: SubmitFeedbackDto, userId: string): Promise<ProcessPlanFeedback> {
    const { data, error } = await this.supabase.getClient(token)
      .from('process_plan_feedback')
      .insert({
        bom_item_id: dto.bomItemId,
        owner_id: userId,
        ai_process_sequence: dto.aiProcessSequence,
        ai_machines: dto.aiMachines ?? null,
        engineer_sequence: dto.engineerSequence,
        engineer_machines: dto.engineerMachines ?? null,
        correction_reason: dto.correctionReason ?? null,
        part_family: dto.partFamily ?? null,
        material: dto.material ?? null,
      })
      .select()
      .single();
    if (error || !data) throw new InternalServerErrorException(`submitFeedback: ${error?.message}`);
    return data as ProcessPlanFeedback;
  }

  async getFeedbackForBomItem(token: string, bomItemId: string): Promise<ProcessPlanFeedback[]> {
    const { data, error } = await this.supabase.getClient(token).from('process_plan_feedback').select('*').eq('bom_item_id', bomItemId).order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(`getFeedback: ${error.message}`);
    return (data ?? []) as ProcessPlanFeedback[];
  }

  async createFeatureProcessMapping(token: string, dto: CreateFeatureProcessMappingDto, userId: string): Promise<FeatureProcessMapping> {
    const { data, error } = await this.supabase.getClient(token)
      .from('feature_process_mapping')
      .insert({
        feature_type: dto.featureType,
        primary_process: dto.primaryProcess,
        secondary_processes: dto.secondaryProcesses ?? null,
        prerequisite_process: dto.prerequisiteProcess ?? null,
        typical_tool_type: dto.typicalToolType ?? null,
        typical_machine_type: dto.typicalMachineType ?? null,
        applies_to_families: dto.appliesToFamilies ?? null,
        notes: dto.notes ?? null,
        is_system: false,
        owner_id: userId,
      })
      .select()
      .single();
    if (error || !data) throw new InternalServerErrorException(`createFPM: ${error?.message}`);
    return data as FeatureProcessMapping;
  }

  async createMachineCapability(token: string, dto: CreateMachineCapabilityDto, userId: string): Promise<MachineCapability> {
    const { data, error } = await this.supabase.getClient(token)
      .from('machine_capabilities')
      .insert({
        machine_name: dto.machineName,
        machine_type: dto.machineType,
        supported_processes: dto.supportedProcesses,
        min_tolerance_mm: dto.minToleranceMm ?? null,
        max_part_length_mm: dto.maxPartLengthMm ?? null,
        max_part_diameter_mm: dto.maxPartDiameterMm ?? null,
        max_spindle_rpm: dto.maxSpindleRpm ?? null,
        supported_materials: dto.supportedMaterials ?? null,
        mhr_id: dto.mhrId ?? null,
        is_system: false,
        owner_id: userId,
      })
      .select()
      .single();
    if (error || !data) throw new InternalServerErrorException(`createMC: ${error?.message}`);
    return data as MachineCapability;
  }

  async createRoutingRule(token: string, dto: CreateProcessRoutingRuleDto, userId: string): Promise<ProcessRoutingRule> {
    const { data, error } = await this.supabase.getClient(token)
      .from('process_routing_rules')
      .insert({
        rule_name: dto.ruleName,
        rule_type: dto.ruleType,
        first_process: dto.firstProcess,
        second_process: dto.secondProcess,
        constraint_type: dto.constraintType,
        applies_to_families: dto.appliesToFamilies ?? null,
        severity: dto.severity,
        message: dto.message,
        suggested_fix: dto.suggestedFix ?? null,
        is_system: false,
        owner_id: userId,
      })
      .select()
      .single();
    if (error || !data) throw new InternalServerErrorException(`createRule: ${error?.message}`);
    return data as ProcessRoutingRule;
  }
}
