import type { SuggestionDto } from '../dto/suggestion.dto';

/**
 * Hardcoded per-route metadata that powers instant smart suggestions without
 * any LLM call. Suggestions here are the cheap, deterministic baseline. The
 * SuggestionService may augment with one Claude-generated dynamic tip on top.
 *
 * Match semantics: longest matching pattern wins. `[id]` segments match any
 * non-slash chunk.
 */
export interface RouteRegistryEntry {
  displayName: string;
  helpTopics: string[];
  suggestions: SuggestionDto[];
}

const ENTRIES: Array<{ pattern: RegExp; entry: RouteRegistryEntry }> = [
  {
    pattern: /^\/projects\/[^/]+\/bom(\/|$)/i,
    entry: {
      displayName: 'BOM editor',
      helpTopics: ['cost-rollup', 'auto-fill', 'cad-link'],
      suggestions: [
        s('bom-1', 'Ask Echo why a part is expensive', 'Echo can break down material, process, tooling, and overhead percentages for the selected BOM item.', 'static'),
        s('bom-2', 'Run DFM review', 'Get manufacturability score, warnings, and recommended processes for any part.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/projects\/[^/]+\/process-planning(\/|$)/i,
    entry: {
      displayName: 'Process planning',
      helpTopics: ['candidates', 'ranking', 'draft-apply'],
      suggestions: [
        s('pp-1', 'Compare process candidates', 'Echo can summarise ranked materials, machines, and processes for the current part.', 'static'),
        s('pp-2', 'Why this process?', 'Ask Echo to explain the AI planner\'s top-ranked candidate and the alternatives it considered.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/projects\/[^/]+\/supplier-(nomination|evaluation)(\/|$)/i,
    entry: {
      displayName: 'Supplier nomination',
      helpTopics: ['ranking', 'capability-filter', 'cost-benchmark'],
      suggestions: [
        s('sup-1', 'Rank suppliers for this part', 'Echo can rank candidates by cost, lead time, dev cost, and overall score.', 'static'),
        s('sup-2', 'Find vendors with capability', 'Ask Echo to filter vendors by process, equipment, country, or certification.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/projects\/[^/]+\/rfq(\/|$)/i,
    entry: {
      displayName: 'RFQ',
      helpTopics: ['generate', 'follow-up', 'compare-quotes'],
      suggestions: [
        s('rfq-1', 'Who hasn\'t responded?', 'Echo can list pending vendors and how long each has been waiting.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/projects\/[^/]+\/production-planning(\/|$)/i,
    entry: {
      displayName: 'Production planning',
      helpTopics: ['lot-health', 'subtasks', 'remarks'],
      suggestions: [
        s('prod-1', 'Show stale lots', 'Echo can list lots with no updates in the last 5 days and what needs attention.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/(raw-materials|hr-rates|mhr-database|calculators)(\/|$)/i,
    entry: {
      displayName: 'Costing rates',
      helpTopics: ['mhr-setup', 'lsr-setup', 'calculator-inputs'],
      suggestions: [
        s('cost-1', 'Validate rate inputs', 'Echo can check whether MHR/LSR inputs are sane and explain the formula.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/vave(\/|$)/i,
    entry: {
      displayName: 'VAVE',
      helpTopics: ['ideas', 'savings', 'risk'],
      suggestions: [
        s('vave-1', 'Highest-ROI ideas', 'Echo can sort VAVE ideas by estimated savings and flag duplicates.', 'static'),
      ],
    },
  },
  {
    pattern: /^\/projects\/[^/]+\/?$/i,
    entry: {
      displayName: 'Project',
      helpTopics: ['cost-status', 'coverage', 'next-step'],
      suggestions: [
        s('proj-1', 'What\'s blocking this project?', 'Echo can scan BOMs, RFQs, and lots and tell you what needs attention first.', 'static'),
      ],
    },
  },
];

export function lookupRoute(route: string | undefined | null): RouteRegistryEntry | null {
  if (!route) return null;
  const clean = route.split('?')[0].replace(/\/+$/, '') || '/';
  // Longest match wins — sort patterns by source length descending.
  const sorted = [...ENTRIES].sort((a, b) => b.pattern.source.length - a.pattern.source.length);
  for (const { pattern, entry } of sorted) {
    if (pattern.test(clean)) return entry;
  }
  return null;
}

function s(id: string, title: string, body: string, source: 'static' | 'dynamic'): SuggestionDto {
  return { id, title, body, source };
}
