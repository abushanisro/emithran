/**
 * Anthropic tool schemas Echo exposes to Claude.
 *
 * Each schema is the JSON contract for a read-only backend tool that wraps an
 * existing NestJS service. The actual handler lives in `tool-dispatcher.ts`.
 *
 * Conventions:
 *   - All `*Id` fields are UUIDs.
 *   - Descriptions are written for the LLM. They MUST tell Claude when (and
 *     when NOT) to use the tool — that's how we control quality.
 *   - Inputs are minimal. Hydrated entity context is already in the user turn,
 *     so we don't ask Claude to repeat ids it can see.
 */

export interface EchoToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ECHO_TOOLS: EchoToolSchema[] = [
  {
    name: 'get_part_cost_breakdown',
    description:
      'Returns the full cost decomposition for a BOM item: raw material, process, tooling, packaging, procured-parts, overhead, total, plus per-component percentages. Use this whenever the user asks why a part is expensive, what drives cost, or for any cost-vs-target comparison. Prefer this over guessing.',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string', description: 'UUID of the BOM item' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'get_dfm_review',
    description:
      'Returns the LAST STORED DFM analysis for a BOM item: manufacturability score 0-100, difficulty level, recommended processes, warnings (thin walls, undercuts, holes, finishes), geometric constraints, cost factors. Cheap and fast — use this first for any manufacturability question. Returns { stale: true } if the cached analysis is older than 7 days.',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'run_dfm_deep_analysis',
    description:
      'Runs a FRESH AI-enhanced DFM analysis on the BOM item by calling the cad-engine service. Takes 5-15 seconds and charges extra credits. Use ONLY when (a) the user explicitly asks for a fresh/deep review, or (b) get_dfm_review returned { stale: true }. Returns AI insights: process recommendations with rationale, cost optimization suggestions, alternative materials, tooling requirements, lead-time estimate, risk assessment.',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string' },
        includeProcessSuggestions: { type: 'boolean' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'get_process_candidates',
    description:
      'Returns the ranked process candidate set for a BOM item: raw materials, machines, labour, processes, calculators that the system considers feasible for this part family. Use when the user asks "what processes could we use?" or "show me alternative routes".',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'rank_suppliers_for_part',
    description:
      'Ranks candidate vendors for a BOM item under a specific supplier nomination by cost, lead time, development cost, financial risk, and overall_rank. Use whenever the user asks "which supplier is best?" or "rank vendors for this part".',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string' },
        nominationId: { type: 'string', description: 'Supplier nomination workspace UUID' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'find_suppliers_with_capability',
    description:
      'Searches vendors filtered by process, equipment type, certifications, or location. Use when the user is looking for "vendors who can do X" — not for ranking already-selected vendors.',
    input_schema: {
      type: 'object',
      properties: {
        process: { type: 'string' },
        equipmentType: { type: 'string' },
        material: { type: 'string' },
        country: { type: 'string' },
        certification: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: 'compare_cost_to_benchmark',
    description:
      'Compares a part or process cost against industry benchmarks (country cost factors, scrap rates, labour library, supplier capability benchmarks). Use to contextualise "is this cheap or expensive?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string' },
        processCategory: { type: 'string', description: 'Optional narrowing — e.g. "cnc_milling"' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'get_rfq_status',
    description:
      'Returns the live state of an RFQ: vendors invited, who has responded, quoted amounts, lead times, and how long each pending vendor has been pending. Use for any "what is the status of RFQ X?" or "who has not replied?" question.',
    input_schema: {
      type: 'object',
      properties: {
        rfqId: { type: 'string' },
      },
      required: ['rfqId'],
    },
  },
  {
    name: 'get_production_lot_status',
    description:
      'Returns the state of a production lot: current status, open subtasks count, recent remarks, last update timestamp. Use for "what is happening on lot X?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        lotId: { type: 'string' },
      },
      required: ['lotId'],
    },
  },
  {
    name: 'get_drawing_analysis',
    description:
      'Returns the full 2D drawing extraction and 3D geometry analysis for a BOM item. ' +
      'Use this whenever the user asks about: tolerances, GD&T, surface finish callouts, ' +
      'threads, holes, missing tolerances, what the 2D drawing says, what the 3D model is, ' +
      'part geometry, bounding box, volume, feature counts (holes/pockets/thin walls/undercuts). ' +
      'This is the primary tool for any drawing or model question — call it before concluding data is unavailable.',
    input_schema: {
      type: 'object',
      properties: {
        bomItemId: { type: 'string', description: 'UUID of the BOM item' },
      },
      required: ['bomItemId'],
    },
  },
  {
    name: 'get_vave_ideas',
    description:
      'Returns active VAVE (Value Analysis / Value Engineering) ideas with estimated savings and target parts for the current project. Use for "what cost-reduction opportunities exist?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        vaveProjectId: { type: 'string', description: 'Optional — if the user is on a specific VAVE workspace' },
      },
      required: ['projectId'],
    },
  },
];

export type EchoToolName = (typeof ECHO_TOOLS)[number]['name'];

export function filterToolsBySkill(allowed: readonly string[]): EchoToolSchema[] {
  const set = new Set(allowed);
  return ECHO_TOOLS.filter((t) => set.has(t.name));
}
