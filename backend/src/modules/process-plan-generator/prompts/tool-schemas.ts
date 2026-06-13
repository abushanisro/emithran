/**
 * Anthropic tool definitions for the Process Plan Generator reasoning loop.
 *
 * Two tools only:
 *   - `expand_candidates` — one-shot per kind, used when Stage-1 candidates
 *     don't include a good fit (e.g., model needs centerless grinding which
 *     wasn't ranked into the top-6 processes).
 *   - `save_draft`        — the final write. JSON schema mirrors the
 *     AbstractPlan TypeScript interface (see dto/abstract-plan.dto.ts).
 *     We do runtime validation in services/abstract-plan.validator.ts.
 */

export const TOOLS = [
  {
    name: 'expand_candidates',
    description:
      'Search the user master tables for additional candidates of a specific kind. ' +
      'Returns up to 5 additional rows ranked by the same scorer used in Stage 1. ' +
      'Use sparingly — at most ONE call per kind for the entire session. ' +
      'After expansion, the new candidates are added to your in-context CandidateSet ' +
      'with fresh IDs (rm-9, mc-7, etc).',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['rawMaterial', 'machine', 'labour', 'process', 'calculator'],
          description: 'Which kind of master to expand.',
        },
        query: {
          type: 'string',
          description:
            'A refined keyword query (e.g., "centerless grinding" or "EN24 alloy steel"). Used to widen the search beyond Stage-1 ranking.',
        },
      },
      required: ['kind', 'query'],
    },
  },
  {
    name: 'save_draft',
    description:
      'Final write of the AbstractPlan. ENDS the session. Call exactly once when your plan is complete. ' +
      'All lines must reference masters by symbolic candidateId (rm-N, mc-N, etc.) from the CandidateSet, or by proposedMasterId for newly proposed masters. ' +
      'Numeric inputs only — never set total_cost (backend computes it).',
    input_schema: {
      type: 'object',
      required: ['partFamily', 'rawMaterials', 'processes'],
      properties: {
        partFamily: {
          type: 'string',
          enum: ['cnc_turned', 'cnc_milled', 'sheet_metal'],
        },
        rawMaterials: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['grossUsageKg', 'netUsageKg', 'scrapPct', 'overheadPct', 'reason'],
            properties: {
              candidateId: { type: 'string', description: "rm-N from CandidateSet" },
              proposedMasterId: { type: 'string', description: "pm-N from proposedMasters[]" },
              grossUsageKg: { type: 'number', minimum: 0 },
              netUsageKg: { type: 'number', minimum: 0 },
              scrapPct: { type: 'number', minimum: 0, maximum: 100 },
              overheadPct: { type: 'number', minimum: 0, maximum: 1000 },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        processes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: [
              'opNbr',
              'machineCandidateId',
              'labourCandidateId',
              'setupMin',
              'setupManning',
              'batchSize',
              'heads',
              'cycleSec',
              'partsPerCycle',
              'scrapPct',
              'reason',
            ],
            properties: {
              opNbr: { type: 'integer', minimum: 1 },
              candidateId: { type: 'string', description: 'op-N' },
              proposedMasterId: { type: 'string', description: 'pm-N' },
              machineCandidateId: { type: 'string', description: 'mc-N' },
              labourCandidateId: { type: 'string', description: 'lb-N' },
              calculatorCandidateId: { type: 'string', description: 'cl-N (optional)' },
              setupMin: { type: 'number', minimum: 0 },
              setupManning: { type: 'number', minimum: 0 },
              batchSize: { type: 'number', minimum: 1 },
              heads: { type: 'number', minimum: 1 },
              cycleSec: { type: 'number', minimum: 0 },
              partsPerCycle: { type: 'number', minimum: 1 },
              scrapPct: { type: 'number', minimum: 0, maximum: 100 },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        tooling: {
          type: 'array',
          items: {
            type: 'object',
            required: ['toolingType', 'description', 'unitCost', 'quantity', 'amortizationParts', 'usagePercentage', 'isCustom', 'reason'],
            properties: {
              toolingType: { type: 'string', enum: ['cutting_tool', 'fixture', 'jig', 'gauge', 'die', 'mold', 'other'] },
              description: { type: 'string' },
              specifications: { type: 'string' },
              unitCost: { type: 'number', minimum: 0 },
              quantity: { type: 'number', minimum: 1 },
              amortizationParts: { type: 'number', minimum: 1 },
              usagePercentage: { type: 'number', minimum: 0, maximum: 100 },
              isCustom: { type: 'boolean' },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        logistics: {
          type: 'array',
          items: {
            type: 'object',
            required: ['costName', 'logisticsType', 'modeOfTransport', 'costBasis', 'unitCost', 'quantity', 'reason'],
            properties: {
              costName: { type: 'string' },
              logisticsType: { type: 'string', enum: ['packaging', 'inbound', 'outbound', 'storage'] },
              modeOfTransport: { type: 'string', enum: ['road', 'rail', 'air', 'sea'] },
              costBasis: { type: 'string', enum: ['per_unit', 'per_batch', 'per_kg', 'per_km'] },
              unitCost: { type: 'number', minimum: 0 },
              quantity: { type: 'number', minimum: 1 },
              parameters: { type: 'string' },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        procuredParts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['partName', 'unitCost', 'quantity', 'scrapPct', 'overheadPct', 'reason'],
            properties: {
              partName: { type: 'string' },
              partNumber: { type: 'string' },
              supplierName: { type: 'string' },
              unitCost: { type: 'number', minimum: 0 },
              quantity: { type: 'number', minimum: 1 },
              scrapPct: { type: 'number', minimum: 0, maximum: 100 },
              overheadPct: { type: 'number', minimum: 0, maximum: 1000 },
              leadTimeDays: { type: 'integer', minimum: 0 },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        proposedMasters: {
          type: 'array',
          description: 'New master rows to add (only when CandidateSet + expand_candidates have no suitable fit)',
          items: {
            type: 'object',
            required: ['kind', 'proposedMasterId', 'reason'],
            properties: {
              kind: { type: 'string', enum: ['raw_material', 'process'] },
              proposedMasterId: {
                type: 'string',
                pattern: '^pm-[a-z0-9-]+$',
                description: "Symbolic ID like 'pm-1', 'pm-centerless-grind'",
              },
              materialGroup: { type: 'string' },
              material: { type: 'string' },
              grade: { type: 'string' },
              densityKgPerM3: { type: 'number', minimum: 0 },
              unitCostInrPerKg: { type: 'number', minimum: 0 },
              location: { type: 'string' },
              processName: { type: 'string' },
              processCategory: { type: 'string' },
              machineType: { type: 'string' },
              description: { type: 'string' },
              setupTimeMinutes: { type: 'number', minimum: 0 },
              cycleTimeMinutes: { type: 'number', minimum: 0 },
              skillLevelRequired: {
                type: 'string',
                enum: ['Unskilled', 'Semi-Skilled', 'Skilled', 'Highly Skilled'],
              },
              reason: { type: 'string', maxLength: 240 },
            },
          },
        },
        notes: {
          type: 'string',
          description: 'Optional overall remarks about the plan',
          maxLength: 500,
        },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];
