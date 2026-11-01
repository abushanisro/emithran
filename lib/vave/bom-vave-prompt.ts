/**
 * The benchmark VAVE analysis prompt, built on the server from structured BOM metrics. The browser sends only the metrics; it never
 * supplies prompt text, so /api/vave-analysis cannot be used as a general-purpose LLM proxy, and every field is bounded.
 */

export const MAX_VAVE_ITEMS = 50;
const MAX_TEXT = 200;

export interface VaveAnalysisItem {
  name: string | null;
  partNumber: string | null;
  material: string | null;
  quantity: number | null;
  unitCost: number | null;
  totalCost: number | null;
  weight: number | null;
  makeBuy: string | null;
  supplier: string | null;
  manufacturingProcess: string | null;
  toleranceGrade: string | null;
  surfaceFinish: string | null;
  heatTreatment: string | null;
}

export interface VaveAnalysisInput {
  bomName: string | null;
  totalParts: number | null;
  totalCost: number | null;
  totalWeight: number | null;
  makeVsBuy: { make: number | null; buy: number | null };
  items: VaveAnalysisItem[];
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The metrics from an untrusted request body, with unknown fields dropped and every value bounded; null when there is no BOM. */
export function parseVaveAnalysisInput(raw: unknown): VaveAnalysisInput | null {
  const bom = record(record(raw).bom);
  if (Object.keys(bom).length === 0) return null;
  const items = Array.isArray(bom.items) ? bom.items.slice(0, MAX_VAVE_ITEMS) : [];
  const makeVsBuy = record(bom.makeVsBuy);
  return {
    bomName: text(bom.bomName),
    totalParts: num(bom.totalParts),
    totalCost: num(bom.totalCost),
    totalWeight: num(bom.totalWeight),
    makeVsBuy: { make: num(makeVsBuy.make), buy: num(makeVsBuy.buy) },
    items: items.map((value) => {
      const item = record(value);
      return {
        name: text(item.name),
        partNumber: text(item.partNumber),
        material: text(item.material),
        quantity: num(item.quantity),
        unitCost: num(item.unitCost),
        totalCost: num(item.totalCost),
        weight: num(item.weight),
        makeBuy: text(item.makeBuy),
        supplier: text(item.supplier),
        manufacturingProcess: text(item.manufacturingProcess),
        toleranceGrade: text(item.toleranceGrade),
        surfaceFinish: text(item.surfaceFinish),
        heatTreatment: text(item.heatTreatment),
      };
    }),
  };
}

export function buildVaveAnalysisPrompt(input: VaveAnalysisInput): string {
  return `Analyze this BOM for precise VAVE (Value Analysis/Value Engineering) opportunities. Focus on cost-effective, specific, actionable insights.

BOM Data: ${JSON.stringify(input, null, 2)}

Provide detailed analysis in this exact JSON format:
{
  "specificOpportunities": [
    {
      "type": "Specific opportunity type",
      "priority": "Critical|High|Medium|Low",
      "description": "Precise description with part numbers/materials",
      "costImpact": actual_dollar_amount,
      "implementation": "Step-by-step implementation plan",
      "timeframe": "Timeline for implementation",
      "confidence": percentage_as_number
    }
  ],
  "materialOptimization": {
    "substitutions": [
      {
        "from": "current_material",
        "to": "recommended_material",
        "savings": dollar_amount,
        "reason": "Technical and cost justification"
      }
    ],
    "consolidations": [
      {
        "materials": ["material1", "material2"],
        "potential": "consolidated_material",
        "savings": dollar_amount
      }
    ]
  },
  "designOptimization": {
    "partConsolidation": [
      {
        "parts": ["part1", "part2"],
        "newDesign": "consolidated_part_description",
        "savings": dollar_amount
      }
    ],
    "toleranceOptimization": [
      {
        "parts": ["precision_parts"],
        "suggestion": "tolerance_relaxation_suggestion",
        "savings": dollar_amount
      }
    ]
  },
  "supplierOptimization": {
    "makeVsBuyRecommendations": [
      {
        "part": "part_name",
        "current": "make|buy",
        "recommended": "buy|make",
        "savings": dollar_amount,
        "reason": "Cost and capacity justification"
      }
    ],
    "supplierConsolidation": [
      {
        "suggestion": "consolidation_strategy",
        "savings": dollar_amount
      }
    ]
  },
  "totalPotentialSavings": total_dollar_amount,
  "confidence": overall_confidence_percentage
}

Focus on:
1. Specific part numbers and materials, not generic advice
2. Quantified cost savings based on actual BOM data
3. Manufacturing feasibility
4. Supply chain optimization
5. Design for manufacturability improvements

Be precise, data-driven, and cost-focused.`;
}
