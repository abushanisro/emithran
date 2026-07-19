import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { Subject, Observable, takeUntil, timer } from 'rxjs';
import { createHash } from 'crypto';

import { SupabaseService } from '../../../common/supabase/supabase.service';

import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { GenerationResponse, ToolCallLogEntry } from '../dto/generation-response.dto';
import { deriveImplications } from '../dto/manufacturing-implication.dto';

import { RetrievalService } from './retrieval.service';
import { ReasoningService, REASONING_MODEL } from './reasoning.service';
import { ResolverService } from './resolver.service';
import { DeterministicPlannerService } from './deterministic-planner.service';
import { AlternativeRoutePlannerService } from './alternative-route-planner.service';
import { ManufacturingKnowledgeService } from '../../manufacturing-knowledge/manufacturing-knowledge.service';
import { ProcessValidationService } from '../../manufacturing-knowledge/services/process-validation.service';

interface GenerateArgs {
  bomItemId: string;
  userId: string;
  accessToken: string | null;
  forceRefresh: boolean;
  notes?: string;
}

interface InternalEvent {
  type: 'retrieval.done' | 'scope_decided' | 'reasoning.started' | 'reasoning.tool_call' | 'resolver.done' | 'draft_ready' | 'failed' | 'out_of_scope';
  data: Record<string, unknown>;
}

const STREAM_KEEPALIVE_MS = 15_000;
const STREAM_MAX_DURATION_MS = 90_000;

/**
 * Top-level orchestrator. Ties Stages 1–3 together, persists the generation
 * row, emits SSE events for live UI progress, and provides idempotency.
 *
 * Stage 4 (apply) is in PersistenceService — invoked from the controller's
 * separate /apply endpoint, NOT from this method.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  // SSE bus: one Subject per (bomItemId, userId) so multiple users on the
  // same BOM item don't cross-leak events. Auto-cleaned on completion.
  private readonly streams = new Map<string, Subject<InternalEvent>>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly retrieval: RetrievalService,
    private readonly reasoning: ReasoningService,
    private readonly resolver: ResolverService,
    private readonly deterministicPlanner: DeterministicPlannerService,
    private readonly alternativeRoutePlanner: AlternativeRoutePlannerService,
    private readonly kb: ManufacturingKnowledgeService,
    private readonly processValidation: ProcessValidationService,
  ) {}

  async generate(args: GenerateArgs): Promise<GenerationResponse> {
    const { bomItemId, userId, accessToken } = args;
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const stream = this.streamKey(bomItemId, userId);

    // ── Stage 1 — retrieval + scope gate ──────────────────────────────────
    const { brief, candidates } = await this.retrieval.assemble(bomItemId, userId, accessToken);
    this.emit(stream, {
      type: 'scope_decided',
      data: { family: brief.scope.family, inScope: brief.scope.inScope, reason: brief.scope.reason },
    });
    this.emit(stream, {
      type: 'retrieval.done',
      data: {
        candidateCounts: {
          rawMaterials: candidates.rawMaterials.length,
          machines: candidates.machines.length,
          labour: candidates.labour.length,
          processes: candidates.processes.length,
          calculators: candidates.calculators.length,
        },
      },
    });

    // ── Load KB routing rules for post-plan validation ───────────────────
    // kbContext (LLM prompt string) is no longer needed — LLM is off for routing.
    // We still load routingRules to run ProcessValidationService after the plan.
    const partFamily = brief.scope.family !== 'out_of_scope' ? brief.scope.family : undefined;
    let kbRules: any[] = [];
    let kbTemplate: any = null;
    let kbAllTemplates: any[] = [];
    if (partFamily && accessToken) {
      try {
        const [routingRules, template, allTemplates] = await Promise.all([
          this.kb.getRoutingRules(accessToken, partFamily),
          this.kb.getTemplate(accessToken, partFamily),
          this.kb.getAlternativeTemplates(accessToken, partFamily),
        ]);
        kbRules = routingRules;
        kbTemplate = template;
        kbAllTemplates = allTemplates;
      } catch (err: any) {
        this.logger.warn(`KB rules load failed (non-fatal): ${err?.message}`);
      }
    }

    // Idempotency: stable hash of (bomItemId + brief). A second click within
    // a short window returns the existing draft.
    const idempotencyKey = sha256(`${bomItemId}::${canonicalize(brief)}`);

    if (!args.forceRefresh) {
      const existing = await this.findRecentByIdempotencyKey(client, userId, idempotencyKey);
      if (existing) {
        this.logger.log(`Idempotent replay for ${bomItemId} → generation ${existing.id} (status=${existing.status})`);
        return existing;
      }
    }

    // No reusable draft → clean up any stale row blocking the unique constraint.
    // With forceRefresh we also clear draft_ready so a new insert can proceed.
    await this.clearStaleByIdempotencyKey(client, userId, idempotencyKey, args.forceRefresh);

    // ── Out-of-scope fast path ────────────────────────────────────────────
    if (!brief.scope.inScope) {
      const row = await this.insertGenerationRow(client, {
        bomItemId,
        userId,
        idempotencyKey,
        status: 'out_of_scope',
        model: REASONING_MODEL,
        scopeDecision: brief.scope,
        brief,
        candidates,
        toolCalls: [],
        abstractPlan: null,
        draftLines: null,
        proposedMasters: null,
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        errorMessage: null,
        errorStage: null,
        completed: true,
      });
      this.emit(stream, { type: 'out_of_scope', data: { reason: brief.scope.reason } });
      this.closeStream(stream);
      return this.rowToResponse(row);
    }

    // ── No routing template → engineering review required ─────────────────
    // The system does not invent routes. If no manufacturing KB template exists
    // for this part family, a human engineer must define the routing first.
    if (!brief.routingTemplate) {
      const reviewRow = await this.insertGenerationRow(client, {
        bomItemId,
        userId,
        idempotencyKey,
        status: 'engineering_review_required',
        model: 'deterministic',
        scopeDecision: brief.scope,
        brief,
        candidates,
        toolCalls: [],
        abstractPlan: null,
        draftLines: null,
        proposedMasters: null,
        tokensIn: 0,
        tokensOut: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        errorMessage: `No routing template found for family "${brief.scope.family}". Add a routing template in the Manufacturing KB before generating a process plan.`,
        errorStage: 'routing_template',
        completed: true,
      });
      this.emit(stream, {
        type: 'out_of_scope',
        data: {
          reason: `No routing template for "${brief.scope.family}" — add one in Manufacturing KB`,
          status: 'engineering_review_required',
        },
      });
      this.closeStream(stream);
      return this.rowToResponse(reviewRow);
    }

    // ── Insert running row ────────────────────────────────────────────────
    const row = await this.insertGenerationRow(client, {
      bomItemId,
      userId,
      idempotencyKey,
      status: 'running',
      model: 'deterministic',
      scopeDecision: brief.scope,
      brief,
      candidates,
      toolCalls: [],
      abstractPlan: null,
      draftLines: null,
      proposedMasters: null,
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      errorMessage: null,
      errorStage: null,
      completed: false,
    });
    const generationId = row.id as string;

    // ── Stage 2 — deterministic planner ──────────────────────────────────
    // Routing template drives the plan. No LLM. No invented operations.
    this.emit(stream, { type: 'reasoning.started', data: { model: 'deterministic' } });

    let abstractPlan: import('../dto/abstract-plan.dto').AbstractPlan;
    const candidatesAfterExpansion = candidates;
    const toolCalls: ToolCallLogEntry[] = [];
    const tokensIn = 0, tokensOut = 0, cacheReadTokens = 0, cacheCreationTokens = 0;

    try {
      abstractPlan = this.deterministicPlanner.plan(brief, candidates);
      this.logger.log(`[orchestrator] Deterministic plan built for ${bomItemId} via "${brief.routingTemplate.template_name}"`);
    } catch (planErr: any) {
      // Planner throws when master data (MHR/LHR) is missing — not a routing problem.
      await client
        .from('process_plan_generations')
        .update({
          status: 'failed',
          error_message: planErr.message.slice(0, 500),
          error_stage: 'deterministic_planner',
          completed_at: new Date().toISOString(),
        })
        .eq('id', generationId);
      this.emit(stream, { type: 'failed', data: { stage: 'deterministic_planner', error: planErr.message } });
      this.closeStream(stream);
      return this.rowToResponse(await this.loadById(client, generationId, userId));
    }

    // ── Stage 3 — resolver ────────────────────────────────────────────────
    const rawDraftPackage = this.resolver.resolve(abstractPlan, candidatesAfterExpansion, brief);
    // Upgrade ai_hint cycle times with physics-based values from ManufacturingRulesService
    const draftPackage = await this.resolver.patchWithRulesEngine(rawDraftPackage, brief);

    // ── Route validation against KB rules ────────────────────────────────
    let kbCapabilities: any[] = [];
    if (kbRules.length > 0 && partFamily) {
      const processSequence = draftPackage.draftLines
        .filter((l) => l.kind === 'process')
        .sort((a, b) => ((a.data as any).opNbr ?? a.index) - ((b.data as any).opNbr ?? b.index))
        .map((l) => (l.data as any).operation ?? (l.data as any).processRoute ?? '');
      const machineAssignments: Record<string, string> = {};
      for (const l of draftPackage.draftLines.filter((l) => l.kind === 'process')) {
        const op = (l.data as any).operation;
        const machine = (l.data as any).processRoute;
        if (op && machine) machineAssignments[op] = machine;
      }
      try {
        kbCapabilities = accessToken ? await this.kb.getMachineCapabilities(accessToken) : [];
        const routeIssues = this.processValidation.validateRoute(processSequence, partFamily, kbRules);
        const machineIssues = this.processValidation.validateMachines(processSequence, machineAssignments, kbCapabilities);
        const allIssues = [...routeIssues, ...machineIssues];
        draftPackage.routeValidationIssues = allIssues;
        draftPackage.hasValidationErrors = allIssues.some((i) => i.severity === 'error');
        draftPackage.partFamily = partFamily;
        draftPackage.templateUsed = kbTemplate?.template_name ?? null;
      } catch (err: any) {
        this.logger.warn(`Route validation failed (non-fatal): ${err?.message}`);
      }
    }

    // ── Alternative routes ─────────────────────────────────────────────────
    // Only runs when ≥2 templates exist for this part family. Non-fatal.
    if (partFamily && kbAllTemplates.length > 1) {
      try {
        const alternatives = this.alternativeRoutePlanner.planAll(
          brief,
          candidatesAfterExpansion,
          kbAllTemplates,
          kbRules,
          kbCapabilities,
        );
        if (alternatives.length > 0) {
          draftPackage.alternatives = alternatives;
          draftPackage.selectedRouteId = alternatives[0]?.routeId ?? null;
        }
      } catch (err: any) {
        this.logger.warn(`Alternative routes generation failed (non-fatal): ${err?.message}`);
      }
    }

    // ── Manufacturing implications from drawing intelligence ──────────────
    draftPackage.implications = deriveImplications({
      tightestToleranceMm: brief.bomItem.tightestToleranceMm,
      coating: brief.bomItem.coating,
      sheetThicknessMm: brief.dfm.sheetThicknessMm,
      drawingMaterial: (brief.bomItem as any).drawingIntelligence?.material ?? null,
      partName: brief.bomItem.partName,
      drawingIntelligence: {
        threads: (brief.bomItem as any).drawingIntelligence?.threads,
        gdt_callouts: (brief.bomItem as any).drawingIntelligence?.gdt_callouts,
        drawing_notes: (brief.bomItem as any).drawingIntelligence?.drawing_notes,
      },
    });

    this.emit(stream, {
      type: 'resolver.done',
      data: {
        lineCounts: countLines(draftPackage.draftLines),
        proposedMasters: draftPackage.proposedMasters.length,
        costPreview: draftPackage.costPreview,
        validationErrors: draftPackage.validationErrors,
        hasValidationErrors: draftPackage.hasValidationErrors ?? false,
      },
    });

    // ── Persist draft + mark draft_ready ──────────────────────────────────
    await client
      .from('process_plan_generations')
      .update({
        status: 'draft_ready',
        abstract_plan: abstractPlan,
        draft_lines: draftPackage,
        proposed_masters: draftPackage.proposedMasters,
        candidates: candidatesAfterExpansion,
        tool_calls: toolCalls,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cache_read_tokens: cacheReadTokens,
        cache_creation_tokens: cacheCreationTokens,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generationId);

    this.emit(stream, {
      type: 'draft_ready',
      data: {
        generationId,
        lineCounts: countLines(draftPackage.draftLines),
        costPreview: draftPackage.costPreview,
      },
    });
    this.closeStream(stream);

    const final = await this.loadById(client, generationId, userId);
    return this.rowToResponse(final);
  }

  async getGeneration(id: string, userId: string, accessToken: string | null): Promise<GenerationResponse | null> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const row = await this.loadById(client, id, userId).catch(() => null);
    return row ? this.rowToResponse(row) : null;
  }

  async getLatestDraft(bomItemId: string, userId: string, accessToken: string | null): Promise<GenerationResponse | null> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('bom_item_id', bomItemId)
      .eq('user_id', userId)
      .in('status', ['draft_ready', 'applied'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return this.rowToResponse(data);
  }

  async discard(id: string, userId: string, accessToken: string | null): Promise<void> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { data: row, error } = await client
      .from('process_plan_generations')
      .select('id, user_id, status')
      .eq('id', id)
      .single();
    if (error || !row) throw new NotFoundException(`Generation ${id} not found`);
    if (row.user_id !== userId) throw new ForbiddenException();
    if (row.status === 'applied') throw new BadRequestException('Cannot discard an already-applied generation');

    await client
      .from('process_plan_generations')
      .update({ status: 'discarded', completed_at: new Date().toISOString() })
      .eq('id', id);
  }

  streamFor(bomItemId: string, userId: string): Observable<MessageEvent> {
    const key = this.streamKey(bomItemId, userId);
    const subj = this.getOrCreateStream(key);
    const stop$ = timer(STREAM_MAX_DURATION_MS);
    return new Observable<MessageEvent>((sub) => {
      const sub1 = subj.pipe(takeUntil(stop$)).subscribe({
        next: (ev) => sub.next({ type: ev.type, data: JSON.stringify(ev.data) } as MessageEvent),
        complete: () => sub.complete(),
        error: (e) => sub.error(e),
      });
      // Keepalive
      const keep = setInterval(() => {
        sub.next({ type: 'ping', data: JSON.stringify({ t: Date.now() }) } as MessageEvent);
      }, STREAM_KEEPALIVE_MS);
      return () => {
        sub1.unsubscribe();
        clearInterval(keep);
      };
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private streamKey(bomItemId: string, userId: string): string {
    return `${userId}:${bomItemId}`;
  }

  private getOrCreateStream(key: string): Subject<InternalEvent> {
    let s = this.streams.get(key);
    if (!s) {
      s = new Subject<InternalEvent>();
      this.streams.set(key, s);
    }
    return s;
  }

  private emit(key: string, ev: InternalEvent) {
    this.getOrCreateStream(key).next(ev);
  }

  private closeStream(key: string) {
    const s = this.streams.get(key);
    if (s) {
      // Defer close to next tick so the last event has a chance to flush
      setTimeout(() => {
        s.complete();
        this.streams.delete(key);
      }, 100);
    }
  }

  private async findRecentByIdempotencyKey(client: any, userId: string, key: string): Promise<GenerationResponse | null> {
    // draft_ready: return indefinitely — the user must apply or discard before
    // a re-generate is allowed. out_of_scope: 30-min window (brief may change).
    const { data: draft, error: draftErr } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .eq('status', 'draft_ready')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!draftErr && draft) return this.rowToResponse(draft);

    // out_of_scope and engineering_review_required: 30-min window (brief may change if user fixes data)
    const { data: oos, error: oosErr } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .in('status', ['out_of_scope', 'engineering_review_required'])
      .gte('started_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!oosErr && oos) return this.rowToResponse(oos);

    return null;
  }

  /**
   * Garbage-collect stale rows that would block a fresh INSERT on the same
   * idempotency key. 'running', 'failed', 'discarded' are always cleared.
   * When forceRefresh=true, also clears 'draft_ready' and 'out_of_scope' so
   * a brand-new generation can be inserted without hitting the UNIQUE constraint.
   */
  private async clearStaleByIdempotencyKey(client: any, userId: string, key: string, forceRefresh = false): Promise<void> {
    const statuses = ['running', 'failed', 'discarded'];
    if (forceRefresh) statuses.push('draft_ready', 'out_of_scope', 'engineering_review_required', 'applied');
    const { error } = await client
      .from('process_plan_generations')
      .delete()
      .eq('user_id', userId)
      .eq('idempotency_key', key)
      .in('status', statuses);
    if (error) {
      this.logger.warn(`Failed to clear stale generation rows for key ${key.slice(0, 8)}…: ${error.message}`);
    }
  }

  private async insertGenerationRow(client: any, args: {
    bomItemId: string;
    userId: string;
    idempotencyKey: string;
    status: string;
    model: string;
    scopeDecision: EngineeringBrief['scope'];
    brief: EngineeringBrief;
    candidates: CandidateSet;
    toolCalls: ToolCallLogEntry[];
    abstractPlan: unknown;
    draftLines: unknown;
    proposedMasters: unknown;
    tokensIn: number;
    tokensOut: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    errorMessage: string | null;
    errorStage: string | null;
    completed: boolean;
  }): Promise<any> {
    const payload = {
      bom_item_id: args.bomItemId,
      user_id: args.userId,
      idempotency_key: args.idempotencyKey,
      status: args.status,
      model: args.model,
      scope_decision: args.scopeDecision,
      brief: args.brief,
      candidates: args.candidates,
      tool_calls: args.toolCalls,
      abstract_plan: args.abstractPlan ?? null,
      draft_lines: args.draftLines ?? null,
      proposed_masters: args.proposedMasters ?? null,
      tokens_in: args.tokensIn,
      tokens_out: args.tokensOut,
      cache_read_tokens: args.cacheReadTokens,
      cache_creation_tokens: args.cacheCreationTokens,
      error_message: args.errorMessage,
      error_stage: args.errorStage,
      completed_at: args.completed ? new Date().toISOString() : null,
    };
    const { data, error } = await client
      .from('process_plan_generations')
      .insert(payload)
      .select('*')
      .single();
    if (error) {
      throw new BadRequestException(`Failed to insert generation row: ${error.message}`);
    }
    return data;
  }

  private async loadById(client: any, id: string, userId: string): Promise<any> {
    const { data, error } = await client
      .from('process_plan_generations')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException(`Generation ${id} not found`);
    if (data.user_id !== userId) throw new ForbiddenException();
    return data;
  }

  private rowToResponse(row: any): GenerationResponse {
    const draft = row.draft_lines;
    return {
      id: row.id,
      bomItemId: row.bom_item_id,
      status: row.status,
      model: row.model,
      scopeDecision: row.scope_decision,
      brief: row.brief,
      candidates: row.candidates,
      abstractPlan: row.abstract_plan,
      draft,
      toolCalls: row.tool_calls ?? [],
      tokensIn: row.tokens_in ?? 0,
      tokensOut: row.tokens_out ?? 0,
      cacheReadTokens: row.cache_read_tokens ?? 0,
      cacheCreationTokens: row.cache_creation_tokens ?? 0,
      creditCost: row.credit_cost ?? 0,
      errorMessage: row.error_message,
      errorStage: row.error_stage,
      routeValidationIssues: draft?.routeValidationIssues,
      hasValidationErrors: draft?.hasValidationErrors,
      partFamily: draft?.partFamily,
      templateUsed: draft?.templateUsed,
      implications: draft?.implications ?? [],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      appliedAt: row.applied_at,
    };
  }

  private formatKbContext(
    partFamily: string,
    featureMappings: any[],
    routingRules: any[],
    template: any,
  ): string {
    const lines: string[] = ['## Manufacturing Knowledge Base (GROUND TRUTH — MUST FOLLOW)'];

    if (featureMappings.length > 0) {
      lines.push('\n### Feature → Process Rules');
      for (const m of featureMappings) {
        let line = `- ${m.feature_type}: primary_process=${m.primary_process}`;
        if (m.typical_machine_type) line += `, machine=${m.typical_machine_type}`;
        if (m.prerequisite_process) line += `, MUST be preceded by ${m.prerequisite_process}`;
        if (m.secondary_processes?.length) line += `, also consider: ${m.secondary_processes.join(', ')}`;
        lines.push(line);
      }
    }

    if (routingRules.length > 0) {
      lines.push('\n### Process Sequencing Rules (VIOLATIONS = ERRORS)');
      for (const r of routingRules) {
        lines.push(`- [${r.severity.toUpperCase()}] ${r.message}${r.suggested_fix ? ` FIX: ${r.suggested_fix}` : ''}`);
      }
    }

    if (template) {
      lines.push(`\n### Standard Routing Template for ${partFamily.replace('_', ' ').toUpperCase()}: ${template.template_name}`);
      lines.push('Use this sequence as the base — inject feature-specific operations at the correct positions:');
      if (Array.isArray(template.routing_sequence)) {
        for (const step of template.routing_sequence) {
          lines.push(`  Op ${step.step}: ${step.process} [${step.machine_type}]${step.required ? ' (required)' : ' (conditional)'} — ${step.description}`);
        }
      }
    }

    lines.push('\nCRITICAL: Always follow the Feature→Process rules above. Validate your output against the sequencing rules before calling save_draft.');
    return lines.join('\n');
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function canonicalize(obj: unknown): string {
  // Stable JSON for hashing — sorts object keys recursively.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + (obj as unknown[]).map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k])).join(',') + '}';
}

function countLines(lines: { kind: string }[]) {
  return lines.reduce(
    (acc, l) => ({ ...acc, [l.kind]: (acc as any)[l.kind] + 1 }),
    { raw_material: 0, process: 0, tooling: 0, logistics: 0, procured_part: 0 },
  );
}
