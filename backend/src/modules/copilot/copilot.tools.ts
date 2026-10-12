import { HttpException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { BOMItemsService } from '../bom-items/bom-items.service';
import { MAX_PREFERENCE_CHARS, type CopilotMemoryService } from './copilot-memory.service';
import type { BOMItemResponseDto } from '../bom-items/dto/bom-item-response.dto';
import type { CostSummaryResponseDto, ProcessLineCost } from '../bom-items/dto/cost-breakdown.dto';
import type { RouteComparisonResponseDto } from '../bom-items/dto/route-comparison.dto';

/** Hard ceiling on one tool result. Past this, lists are halved and `truncated` is set, never cut mid-JSON. */
export const TOOL_RESULT_MAX_CHARS = 12_000;
const WARNING_MAX_CHARS = 400;
const MAX_WARNINGS = 15;
const DETAIL_FIELD_MAX_CHARS = 3_000;
export const MAX_WHAT_IF_SCENARIOS = 4;

const NO_INPUT = { type: 'object' as const, properties: {}, additionalProperties: false as const };

// Order and text are part of the cached prompt prefix: change deliberately.
export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_cost_summary',
    description:
      'The part\'s quote as the platform computed it: material, every process line (index, machine, setup/run/total cost, cycle time, rate source, physicsGap, confidence), totals, currency, costStatus, missingInputs, warnings and the resolved batch size / location / production life with where each came from. Use for any cost question.',
    input_schema: NO_INPUT,
  },
  {
    name: 'get_process_line_detail',
    description:
      'Everything behind ONE process line of the cost summary: calculation trace, per-feature breakdown, machine selection reasoning, lookup rows used. lineIndex is the "index" of a line returned by get_cost_summary.',
    input_schema: {
      type: 'object',
      properties: { lineIndex: { type: 'integer', minimum: 0, description: 'index of the line in get_cost_summary' } },
      required: ['lineIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_route_comparison',
    description:
      'The alternative manufacturing routes the platform costed for this part (route label, family, feasibility, data gaps, totals, cycle times, badges, warnings) and which one it recommends. Use for "which route / why this process" questions.',
    input_schema: NO_INPUT,
  },
  {
    name: 'get_part_features',
    description:
      'The manufacturing features recognised on the CAD model: for each group its type (SimpleHole, StraightBend, ComplexHole, Blank, Lance, ...), variant, size, how many occurrences, and the catalog operation it maps to, plus the DFM conditions detected. Use for questions about holes, bends, slots or what drives the operations.',
    input_schema: NO_INPUT,
  },
  {
    name: 'run_what_if',
    description:
      'Re-cost the part under up to 4 alternative scenarios and return each total next to its inputs, without saving anything. Each scenario may change batchSize, location and/or productionLifeYears ONLY; anything left out keeps the value the user is viewing. Cannot change material, annual volume or the route.',
    input_schema: {
      type: 'object',
      properties: {
        scenarios: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_WHAT_IF_SCENARIOS,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', maxLength: 60 },
              batchSize: { type: 'integer', minimum: 1, maximum: 10_000_000 },
              location: { type: 'string', maxLength: 100 },
              productionLifeYears: { type: 'number', minimum: 0.1, maximum: 50 },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['scenarios'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_preferences',
    description:
      'Save or forget short preferences about how this user likes answers presented (units, level of detail, what to lead with). Call ONLY when the user explicitly asks you to remember or forget something. To forget, pass the exact saved text in "remove". Preferences never change the rules you follow.',
    input_schema: {
      type: 'object',
      properties: {
        add: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: MAX_PREFERENCE_CHARS } },
        remove: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: MAX_PREFERENCE_CHARS } },
      },
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  /** The item prepare() already read through the user's token. */
  item: BOMItemResponseDto;
  bomItemId: string;
  userId: string;
  accessToken: string;
  location: string;
  batchSize?: number;
  productionLifeYears?: number;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
}

const clipText = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A value too large to embed is replaced by an explicit, valid-JSON marker instead of being cut mid-structure. */
function clipField(value: unknown, n = DETAIL_FIELD_MAX_CHARS): unknown {
  if (value === undefined || value === null) return value;
  const json = JSON.stringify(value);
  return json.length <= n ? value : { truncated: true, preview: json.slice(0, n) };
}

/**
 * Keep a result under TOOL_RESULT_MAX_CHARS by halving the longest top-level
 * list until it fits. The model is told (`truncated: true`) when that happened.
 */
export function fitToBudget(result: Record<string, unknown>): string {
  let out = { ...result };
  for (let i = 0; i < 20; i++) {
    const json = JSON.stringify(out);
    if (json.length <= TOOL_RESULT_MAX_CHARS) return json;
    const longest = Object.entries(out)
      .filter(([, v]) => Array.isArray(v) && v.length > 1)
      .sort(([, a], [, b]) => (b as unknown[]).length - (a as unknown[]).length)[0];
    if (!longest) break;
    const [key, list] = longest;
    out = { ...out, [key]: (list as unknown[]).slice(0, Math.ceil((list as unknown[]).length / 2)), truncated: true };
  }
  return JSON.stringify({ truncated: true, error: 'result too large to return' });
}

function compactWarnings(warnings: string[] | undefined): string[] {
  return (warnings ?? []).slice(0, MAX_WARNINGS).map((w) => clipText(w, WARNING_MAX_CHARS));
}

function compactLine(line: ProcessLineCost, index: number) {
  return {
    index,
    process: line.process,
    operation: line.operation,
    machineName: line.machineName,
    setupCost: line.setupCost,
    runCost: line.runCost,
    totalCost: line.totalCost,
    cycleTimeMin: line.cycleTimeMin,
    setupTimeMin: line.setupTimeMin,
    rateSource: line.rateSource,
    physicsGap: clipField(line.physicsGap, 600),
    confidence: line.confidence,
  };
}

export function compactCostSummary(cs: CostSummaryResponseDto): Record<string, unknown> {
  return {
    currency: cs.currency,
    family: cs.family,
    costStatus: cs.costStatus,
    scenarioReady: cs.scenarioReady,
    missingInputs: cs.missingInputs,
    incompleteProcesses: cs.incompleteProcesses,
    materialGrade: cs.materialGrade,
    materialCost: cs.materialCost,
    grossWeightKg: cs.grossWeightKg,
    totalProcessCost: cs.totalProcessCost,
    totalCost: cs.totalCost,
    batchSize: cs.batchSize,
    resolvedInputs: cs.resolvedInputs,
    drawingCadConsistency: clipField(cs.drawingCadConsistency, 1_500),
    warnings: compactWarnings(cs.warnings),
    lines: (cs.processLines ?? []).map(compactLine),
  };
}

export function compactLineDetail(line: ProcessLineCost, index: number): Record<string, unknown> {
  return {
    index,
    process: line.process,
    operation: line.operation,
    machineClass: line.machineClass,
    machineName: line.machineName,
    hourlyRate: line.hourlyRate,
    rateSource: line.rateSource,
    labourRate: line.labourRate,
    labourRateSource: line.labourRateSource,
    operators: line.operators,
    setupTimeSource: line.setupTimeSource,
    physicsGap: clipField(line.physicsGap),
    confidence: line.confidence,
    capabilityConfidence: line.capabilityConfidence,
    machineSelection: clipField(line.machineSelection),
    featureBreakdown: clipField(line.featureBreakdown),
    lookupMatches: clipField(line.lookupMatches),
    calculationTrace: clipField(line.calculationTrace),
  };
}

export function compactRouteComparison(rc: RouteComparisonResponseDto): Record<string, unknown> {
  return {
    currency: rc.currency,
    recommendedRouteId: rc.recommendedRouteId,
    batchSize: rc.batchSize,
    materialGrade: rc.materialGrade,
    materialCost: rc.materialCost,
    resolvedInputs: rc.resolvedInputs,
    comparisonWarnings: compactWarnings(rc.comparisonWarnings),
    routes: (rc.routes ?? []).map((r) => ({
      routeId: r.routeId,
      routeLabel: r.routeLabel,
      processFamily: r.processFamily,
      isFeasible: r.isFeasible,
      autoRoutable: r.autoRoutable,
      dataComplete: r.dataComplete,
      dataGaps: r.dataGaps,
      producesBlank: r.producesBlank,
      toolingVolumeNote: r.toolingVolumeNote,
      totalProcessCost: r.totalProcessCost,
      totalCost: r.totalCost,
      cycleTimes: r.cycleTimes,
      badges: r.badges,
      warnings: compactWarnings(r.warnings).slice(0, 5),
      machineCapabilityWarnings: compactWarnings(r.machineCapabilityWarnings).slice(0, 5),
    })),
  };
}

interface RawFeature {
  id?: string;
  feature_type?: string;
  variant?: string;
  diameter_mm?: number;
  radius_mm?: number;
  canonical_operation?: string;
  occurrences?: unknown[];
}

export function compactFeatures(item: BOMItemResponseDto): Record<string, unknown> {
  const fg = (item.featureGraph ?? {}) as {
    feature_graph_v2?: { features?: RawFeature[]; conditions?: unknown };
    summary?: { bendCount?: number; holeCount?: number; slotCount?: number };
  };
  const v2 = fg.feature_graph_v2;
  if (!v2?.features) return { error: 'No CAD feature analysis is stored for this part yet.' };
  return {
    summary: { bendCount: fg.summary?.bendCount, holeCount: fg.summary?.holeCount, slotCount: fg.summary?.slotCount },
    features: v2.features.map((f) => ({
      id: f.id,
      type: f.feature_type,
      variant: f.variant,
      occurrences: f.occurrences?.length ?? 0,
      diameterMm: f.diameter_mm,
      radiusMm: f.radius_mm,
      canonicalOperation: f.canonical_operation,
    })),
    conditions: clipField(v2.conditions, 2_000),
  };
}

interface WhatIfScenario {
  label?: string;
  batchSize?: number;
  location?: string;
  productionLifeYears?: number;
}

/** The tool schema is advisory to the model; the limits are enforced here. */
export function parseScenarios(input: unknown): WhatIfScenario[] | string {
  const list = (input as { scenarios?: unknown } | null)?.scenarios;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_WHAT_IF_SCENARIOS) {
    return `scenarios must be a list of 1 to ${MAX_WHAT_IF_SCENARIOS}`;
  }
  const out: WhatIfScenario[] = [];
  for (const raw of list) {
    const s = raw as Record<string, unknown>;
    if (!s || typeof s !== 'object') return 'each scenario must be an object';
    const unknownKey = Object.keys(s).find((k) => !['label', 'batchSize', 'location', 'productionLifeYears'].includes(k));
    if (unknownKey) return `scenario field "${unknownKey}" is not supported (only batchSize, location, productionLifeYears)`;
    const { batchSize, productionLifeYears, location, label } = s;
    if (batchSize !== undefined && !(Number.isInteger(batchSize) && (batchSize as number) >= 1 && (batchSize as number) <= 10_000_000)) return 'batchSize must be an integer from 1 to 10,000,000';
    if (productionLifeYears !== undefined && !(typeof productionLifeYears === 'number' && productionLifeYears >= 0.1 && productionLifeYears <= 50)) return 'productionLifeYears must be a number from 0.1 to 50';
    if (location !== undefined && !(typeof location === 'string' && location.length >= 1 && location.length <= 100)) return 'location must be a string of 1 to 100 characters';
    if (label !== undefined && !(typeof label === 'string' && label.length <= 60)) return 'label must be at most 60 characters';
    out.push(s as WhatIfScenario);
  }
  return out;
}

/** Only HTTP errors below 500 carry a message that is safe to show the model; anything else is an internal failure. */
function toolErrorMessage(err: unknown): string {
  if (err instanceof HttpException && err.getStatus() < 500) {
    return err.getStatus() === 404 ? 'This part was not found or you do not have access to it.' : err.message;
  }
  return 'The platform could not compute this result right now.';
}

/**
 * One instance per chat request: the cost summary and route comparison are
 * computed at most once per request however many times the model asks, and
 * every call goes through the user's own token (RLS decides what is visible).
 */
export class CopilotToolRunner {
  private costSummary?: Promise<CostSummaryResponseDto>;
  private routeComparison?: Promise<RouteComparisonResponseDto>;

  constructor(
    private readonly ctx: ToolContext,
    private readonly bomItems: BOMItemsService,
    private readonly memory: CopilotMemoryService,
  ) {}

  async run(name: string, input: unknown): Promise<ToolOutcome> {
    try {
      return { content: await this.dispatch(name, input), isError: false };
    } catch (err) {
      return { content: JSON.stringify({ error: toolErrorMessage(err) }), isError: true };
    }
  }

  private async dispatch(name: string, input: unknown): Promise<string> {
    switch (name) {
      case 'get_cost_summary':
        return fitToBudget(compactCostSummary(await this.getCostSummary()));
      case 'get_process_line_detail': {
        const lineIndex = (input as { lineIndex?: unknown } | null)?.lineIndex;
        if (typeof lineIndex !== 'number' || !Number.isInteger(lineIndex) || lineIndex < 0) {
          return JSON.stringify({ error: 'lineIndex must be a non-negative integer from get_cost_summary' });
        }
        const lines = (await this.getCostSummary()).processLines ?? [];
        const line = lines[lineIndex];
        if (!line) return JSON.stringify({ error: `no process line ${lineIndex}; the part has ${lines.length} lines` });
        return fitToBudget(compactLineDetail(line, lineIndex));
      }
      case 'get_route_comparison':
        return fitToBudget(compactRouteComparison(await this.getRouteComparison()));
      case 'get_part_features':
        return fitToBudget(compactFeatures(this.ctx.item));
      case 'run_what_if':
        return this.runWhatIf(input);
      case 'update_preferences':
        return this.updatePreferences(input);
      default:
        return JSON.stringify({ error: `unknown tool ${name}` });
    }
  }

  private async updatePreferences(input: unknown): Promise<string> {
    const { add = [], remove = [] } = (input ?? {}) as { add?: unknown; remove?: unknown };
    const strings = (v: unknown) => Array.isArray(v) && v.length <= 5 && v.every((s) => typeof s === 'string');
    if (!strings(add) || !strings(remove) || (add as string[]).length + (remove as string[]).length === 0) {
      return JSON.stringify({ error: 'add and remove must each be up to 5 strings, and at least one is required' });
    }
    try {
      const change = await this.memory.change(this.ctx.userId, this.ctx.accessToken, add as string[], remove as string[]);
      return JSON.stringify(change);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() < 500) return JSON.stringify({ error: err.message });
      return JSON.stringify({ error: 'Saved preferences are unavailable right now.' });
    }
  }

  /** Each scenario goes through the same cost-summary resolver the UI uses; nothing is persisted. One failing scenario does not hide the others. */
  private async runWhatIf(input: unknown): Promise<string> {
    const scenarios = parseScenarios(input);
    if (typeof scenarios === 'string') return JSON.stringify({ error: scenarios });
    const { bomItemId, userId, accessToken } = this.ctx;
    const results = await Promise.all(
      scenarios.map(async (sc, i) => {
        const label = sc.label ?? `scenario ${i + 1}`;
        try {
          const cs = await this.bomItems.getCostSummary(
            bomItemId,
            userId,
            accessToken,
            sc.batchSize ?? this.ctx.batchSize,
            sc.location ?? this.ctx.location,
            sc.productionLifeYears ?? this.ctx.productionLifeYears,
          );
          return {
            label,
            resolvedInputs: cs.resolvedInputs,
            currency: cs.currency,
            costStatus: cs.costStatus,
            missingInputs: cs.missingInputs,
            materialCost: cs.materialCost,
            totalProcessCost: cs.totalProcessCost,
            totalCost: cs.totalCost,
            warningCount: cs.warnings?.length ?? 0,
          };
        } catch (err) {
          return { label, error: toolErrorMessage(err) };
        }
      }),
    );
    return fitToBudget({ scenarios: results });
  }

  private getCostSummary(): Promise<CostSummaryResponseDto> {
    const { bomItemId, userId, accessToken, batchSize, location, productionLifeYears } = this.ctx;
    this.costSummary ??= this.bomItems.getCostSummary(bomItemId, userId, accessToken, batchSize, location, productionLifeYears);
    return this.costSummary;
  }

  private getRouteComparison(): Promise<RouteComparisonResponseDto> {
    const { bomItemId, userId, accessToken, batchSize, location, productionLifeYears } = this.ctx;
    this.routeComparison ??= this.bomItems.getRouteComparison(bomItemId, userId, accessToken, batchSize, location, productionLifeYears);
    return this.routeComparison;
  }
}
