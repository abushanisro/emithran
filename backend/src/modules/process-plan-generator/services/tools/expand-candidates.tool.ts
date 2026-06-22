import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../../common/supabase/supabase.service';
import type { CandidateSet, MaterialCandidate, MachineCandidate, LabourCandidate, ProcessCandidate, CalculatorCandidate } from '../../dto/candidate-set.dto';
import type { PartFamily } from '../../dto/engineering-brief.dto';

import { rankMaterials } from '../../ranking/material-ranker';
import { rankMachines } from '../../ranking/machine-ranker';
import { rankLabour } from '../../ranking/labour-ranker';
import { rankProcesses } from '../../ranking/process-ranker';
import { rankCalculators } from '../../ranking/calculator-ranker';

/**
 * Handler for the LLM tool `expand_candidates`.
 *
 * Runs a broader keyword search on the requested kind, ranks the result
 * with the same scorer used in Stage 1, and returns up to 5 NEW candidates
 * (ones not already present in the current CandidateSet) with fresh
 * symbolic IDs (rm-9, mc-7, etc.) so existing references stay stable.
 *
 * The input `query` is parameterised (passed through .ilike() with %), so
 * it's safe against SQL injection — but we still strip wildcards and
 * percent signs as a defence-in-depth.
 */
@Injectable()
export class ExpandCandidatesTool {
  private readonly logger = new Logger(ExpandCandidatesTool.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async execute(args: {
    kind: 'rawMaterial' | 'machine' | 'labour' | 'process' | 'calculator';
    query: string;
    userId: string;
    accessToken: string | null;
    family: Exclude<PartFamily, 'out_of_scope'>;
    orgLocation: string;
    currentCandidates: CandidateSet;
    dfm: { holeCount: number; pocketCount: number; thinWallCount: number; undercutCount: number; volumeMm3: number; surfaceAreaMm2: number; boundingBox: { lengthMm: number; widthMm: number; heightMm: number } };
  }): Promise<{ added: any[]; kind: string; nextStartId: number }> {
    const safeQuery = String(args.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
    if (!safeQuery) {
      return { added: [], kind: args.kind, nextStartId: 0 };
    }
    const client = this.supabaseService.getClient(args.accessToken ?? undefined);

    switch (args.kind) {
      case 'rawMaterial': return this.expandMaterials(client, safeQuery, args);
      case 'machine':     return this.expandMachines(client, safeQuery, args);
      case 'labour':      return this.expandLabour(client, safeQuery, args);
      case 'process':     return this.expandProcesses(client, safeQuery, args);
      case 'calculator':  return this.expandCalculators(client, safeQuery, args);
    }
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  private async expandMaterials(client: any, q: string, args: any) {
    const { data, error } = await client
      .from('raw_materials')
      .select('id, material_group, material, material_grade, density_kg_m3, cost, location, user_id')
      .or(`material.ilike.%${q}%,material_grade.ilike.%${q}%,material_group.ilike.%${q}%`)
      .limit(40);
    if (error) {
      this.logger.warn(`expand materials failed: ${error.message}`);
      return { added: [], kind: 'rawMaterial', nextStartId: 0 };
    }
    const seen = new Set(args.currentCandidates.rawMaterials.map((c: MaterialCandidate) => c.dbId));
    const fresh = (data ?? []).filter((r: any) => !seen.has(r.id));
    const ranked = rankMaterials(fresh, args.family, q, args.orgLocation, 5);
    const startIdx = args.currentCandidates.rawMaterials.length + 1;
    const renumbered = ranked.map((c, i) => ({ ...c, candidateId: `rm-${startIdx + i}` }));
    return { added: renumbered, kind: 'rawMaterial', nextStartId: startIdx };
  }

  // ── Machines ──────────────────────────────────────────────────────────────
  private async expandMachines(client: any, q: string, args: any) {
    const { data, error } = await client
      .from('mhr_records')
      .select('id, machine_name, machine_description, commodity_code, total_machine_hour_rate, location')
      .or(`machine_name.ilike.%${q}%,machine_description.ilike.%${q}%,commodity_code.ilike.%${q}%`)
      .not('total_machine_hour_rate', 'is', null)
      .limit(40);
    if (error) {
      this.logger.warn(`expand machines failed: ${error.message}`);
      return { added: [], kind: 'machine', nextStartId: 0 };
    }
    const seen = new Set(args.currentCandidates.machines.map((c: MachineCandidate) => c.dbId));
    const fresh = (data ?? []).filter((r: any) => !seen.has(r.id));
    const ranked = rankMachines(fresh, args.family, args.orgLocation, 5);
    const startIdx = args.currentCandidates.machines.length + 1;
    const renumbered = ranked.map((c, i) => ({ ...c, candidateId: `mc-${startIdx + i}` }));
    return { added: renumbered, kind: 'machine', nextStartId: startIdx };
  }

  // ── Labour ────────────────────────────────────────────────────────────────
  private async expandLabour(client: any, q: string, args: any) {
    const { data, error } = await client
      .from('lsr_records')
      .select('id, labour_type, labour_code, lhr, location')
      .or(`labour_type.ilike.%${q}%,labour_code.ilike.%${q}%`)
      .not('lhr', 'is', null)
      .limit(20);
    if (error) {
      this.logger.warn(`expand labour failed: ${error.message}`);
      return { added: [], kind: 'labour', nextStartId: 0 };
    }
    const seen = new Set(args.currentCandidates.labour.map((c: LabourCandidate) => c.dbId));
    const fresh = (data ?? []).filter((r: any) => !seen.has(r.id));
    const ranked = rankLabour(fresh, args.orgLocation, 5);
    const startIdx = args.currentCandidates.labour.length + 1;
    const renumbered = ranked.map((c, i) => ({ ...c, candidateId: `lb-${startIdx + i}` }));
    return { added: renumbered, kind: 'labour', nextStartId: startIdx };
  }

  // ── Processes ─────────────────────────────────────────────────────────────
  private async expandProcesses(client: any, q: string, args: any) {
    const { data, error } = await client
      .from('process_calculator_mappings')
      .select('id, process_group, process_route, operation, calculator_id')
      .or(`process_group.ilike.%${q}%,process_route.ilike.%${q}%,operation.ilike.%${q}%`)
      .eq('is_active', true)
      .limit(40);
    if (error) {
      this.logger.warn(`expand processes failed: ${error.message}`);
      return { added: [], kind: 'process', nextStartId: 0 };
    }
    const seen = new Set(args.currentCandidates.processes.map((c: ProcessCandidate) => c.dbId));
    const fresh = (data ?? []).filter((r: any) => !seen.has(r.id));
    const ranked = rankProcesses(fresh, args.family, args.dfm, 5);
    const startIdx = args.currentCandidates.processes.length + 1;
    const renumbered = ranked.map((c, i) => ({ ...c, candidateId: `op-${startIdx + i}` }));
    return { added: renumbered, kind: 'process', nextStartId: startIdx };
  }

  // ── Calculators ───────────────────────────────────────────────────────────
  private async expandCalculators(client: any, q: string, args: any) {
    const { data, error } = await client
      .from('calculators')
      .select('id, name, calc_category, description')
      .or(`name.ilike.%${q}%,calc_category.ilike.%${q}%`)
      .limit(20);
    if (error) {
      this.logger.warn(`expand calculators failed: ${error.message}`);
      return { added: [], kind: 'calculator', nextStartId: 0 };
    }
    const seen = new Set(args.currentCandidates.calculators.map((c: CalculatorCandidate) => c.dbId));
    const fresh = (data ?? []).filter((r: any) => !seen.has(r.id));
    const ranked = rankCalculators(fresh, args.family, 5);
    const startIdx = args.currentCandidates.calculators.length + 1;
    const renumbered = ranked.map((c, i) => ({ ...c, candidateId: `cl-${startIdx + i}` }));
    return { added: renumbered, kind: 'calculator', nextStartId: startIdx };
  }
}
