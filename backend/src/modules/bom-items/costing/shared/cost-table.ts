// The part's applied cost as a table: one row per cost object (part, material, process group, process, logistics, procured part, tooling) and one value
// per column, laid out as the Part Details view of a cost tool: cost object | manufacturing | material info | variable costs | period costs | piece part
// cost | capital | targets. Pure: the rows the Apply wrote come in, the table goes out. Every value is a stored number; nothing is computed that the
// engine did not already state, and a column the model has no data for is declared `modelled: false` with the reason, never filled with a zero.
// All money is USD: every persisted cost table is USD-native (see persisted-currency-contract.ts); the page converts to the display currency.

export type CostColumnKey =
  | 'annualVolume' | 'laborTimeSec'
  | 'operationNumber' | 'machineName' | 'partsPerCycle' | 'scrapPct' | 'setupTimeMin' | 'batchSize' | 'machineRate' | 'laborRate' | 'timingSource' | 'setupTimeSource'
  | 'finishMassKg' | 'materialComposition' | 'utilizationPct' | 'materialUnitCost'
  | 'materialCost' | 'processCost' | 'amortizedBatchSetup' | 'logistics' | 'tooling' | 'otherDirect' | 'totalVariable'
  | 'indirectOverhead' | 'sga' | 'margin'
  | 'pieceCost'
  | 'capitalInvestment'
  | 'targetCost';

export type CostColumnGroup = 'Manufacturing' | 'Process Source' | 'Material Info' | 'Variable Costs' | 'Period Costs' | 'Piece Part Cost' | 'Capital Costs' | 'Cost Targets';
export type CostUnit = 'usd' | 'usd_per_kg' | 'usd_per_hr' | 'minutes' | 'seconds' | 'kg' | 'percent' | 'count' | 'text';

export interface CostColumn {
  key: CostColumnKey;
  label: string;
  group: CostColumnGroup;
  unit: CostUnit;
  /** false: the cost model holds no data for this column; `note` says why. The page shows "—" and the note. */
  modelled: boolean;
  note?: string;
  /** In the compact table the page shows; the dialog shows every column. */
  basic: boolean;
}

export const COST_COLUMNS: readonly CostColumn[] = [
  { key: 'annualVolume', label: 'Annual Volume', group: 'Manufacturing', unit: 'count', modelled: true, basic: false },
  { key: 'laborTimeSec', label: 'Labor Time (s)', group: 'Manufacturing', unit: 'seconds', modelled: true, basic: false, note: 'The cycle time per part of the operation.' },
  { key: 'operationNumber', label: 'Op #', group: 'Process Source', unit: 'count', modelled: true, basic: false, note: "The operation's number in the route." },
  { key: 'machineName', label: 'Machine', group: 'Process Source', unit: 'text', modelled: true, basic: false },
  { key: 'partsPerCycle', label: 'Parts per Cycle', group: 'Process Source', unit: 'count', modelled: true, basic: false },
  { key: 'scrapPct', label: 'Scrap (%)', group: 'Process Source', unit: 'percent', modelled: true, basic: false },
  { key: 'setupTimeMin', label: 'Setup Time (min)', group: 'Process Source', unit: 'minutes', modelled: true, basic: false, note: 'Per batch.' },
  { key: 'batchSize', label: 'Batch Size', group: 'Process Source', unit: 'count', modelled: true, basic: false, note: 'The batch the setup is spread over.' },
  { key: 'machineRate', label: 'Machine Rate (USD/hr)', group: 'Process Source', unit: 'usd_per_hr', modelled: true, basic: false },
  { key: 'laborRate', label: 'Labor Rate (USD/hr)', group: 'Process Source', unit: 'usd_per_hr', modelled: true, basic: false },
  { key: 'timingSource', label: 'Cycle Time Source', group: 'Process Source', unit: 'text', modelled: true, basic: false, note: 'Where the cycle time came from; empty when the record does not say.' },
  { key: 'setupTimeSource', label: 'Setup Time Source', group: 'Process Source', unit: 'text', modelled: true, basic: false, note: 'Where the setup time came from; empty when the record does not say.' },
  { key: 'finishMassKg', label: 'Finish Mass (kg)', group: 'Material Info', unit: 'kg', modelled: true, basic: false },
  { key: 'materialComposition', label: 'Material Composition', group: 'Material Info', unit: 'text', modelled: true, basic: false },
  { key: 'utilizationPct', label: 'Utilization (%)', group: 'Material Info', unit: 'percent', modelled: true, basic: false },
  { key: 'materialUnitCost', label: 'Material Unit Cost (USD/kg)', group: 'Material Info', unit: 'usd_per_kg', modelled: true, basic: false },
  { key: 'materialCost', label: 'Material Cost', group: 'Variable Costs', unit: 'usd', modelled: true, basic: true },
  { key: 'processCost', label: 'Process Cost', group: 'Variable Costs', unit: 'usd', modelled: true, basic: true, note: "The operation's cost per part less its amortized setup: machine, labour, inspection and yield. The machine and labour split is not stored per operation." },
  { key: 'amortizedBatchSetup', label: 'Amortized Batch Setup', group: 'Variable Costs', unit: 'usd', modelled: true, basic: true },
  { key: 'logistics', label: 'Logistics', group: 'Variable Costs', unit: 'usd', modelled: true, basic: false },
  { key: 'tooling', label: 'Tooling (amortized)', group: 'Variable Costs', unit: 'usd', modelled: true, basic: false },
  { key: 'otherDirect', label: 'Other Direct Costs', group: 'Variable Costs', unit: 'usd', modelled: true, basic: false, note: 'Procured parts.' },
  { key: 'totalVariable', label: 'Total Variable Costs', group: 'Variable Costs', unit: 'usd', modelled: true, basic: false },
  { key: 'indirectOverhead', label: 'Indirect Overhead', group: 'Period Costs', unit: 'usd', modelled: false, basic: false, note: 'Not modelled: no indirect overhead rate is on file.' },
  { key: 'sga', label: 'SG&A', group: 'Period Costs', unit: 'usd', modelled: false, basic: false, note: 'Not modelled: no SG&A rate is on file.' },
  { key: 'margin', label: 'Margin', group: 'Period Costs', unit: 'usd', modelled: false, basic: false, note: 'Not modelled: no margin is on file.' },
  { key: 'pieceCost', label: 'Piece Part Cost', group: 'Piece Part Cost', unit: 'usd', modelled: true, basic: true, note: 'Equals the total variable cost: period costs are not modelled.' },
  { key: 'capitalInvestment', label: 'Total Capital Investments', group: 'Capital Costs', unit: 'usd', modelled: true, basic: false, note: 'The tooling investment on file.' },
  { key: 'targetCost', label: 'Target Cost', group: 'Cost Targets', unit: 'usd', modelled: false, basic: false, note: 'Not modelled: no target cost is on file.' },
];

export type CostRowKind = 'part' | 'material' | 'group' | 'process' | 'logistics' | 'procured' | 'tooling';
export type CostValue = number | string | null;

export interface CostRow {
  id: string;
  parentId: string | null;
  kind: CostRowKind;
  name: string;
  /** attention: this cost object carries no cost (not costed yet). */
  status: 'ok' | 'attention';
  statusNote?: string;
  values: Partial<Record<CostColumnKey, CostValue>>;
}

export interface CostTable {
  currency: 'USD';
  columns: readonly CostColumn[];
  rows: CostRow[];
}

// The stored rows, as the database names the columns (numeric columns arrive as numbers or numeric strings).
type Num = number | string | null | undefined;
export interface ProcessRecord { id: string; operation: string | null; process_name: string | null; process_group: string | null; machine_name: string | null; cycle_time: Num; setup_cost_per_part: Num; total_cost_per_part: Num; op_nbr: Num; created_at: string;
  parts_per_cycle?: Num; scrap?: Num; setup_time?: Num; batch_size?: Num; machine_rate?: Num; labor_rate?: Num; timing_source?: string | null; setup_time_source?: string | null }
export interface MaterialRecord { id: string; material_name: string | null; unit_cost: Num; net_usage: Num; total_cost: Num; material_utilization_rate: Num }
export interface LogisticsRecord { id: string; cost_name: string | null; total_cost: Num }
export interface ProcuredRecord { id: string; part_name: string | null; total_cost: Num }
export interface ToolingRecord { id: string; tooling_type: string | null; description: string | null; unit_cost: Num; quantity: Num; total_cost: Num; total_tooling_investment: Num }

export interface CostTableInput {
  part: { id: string; name: string; annualVolume: number | null };
  processes: ProcessRecord[];
  materials: MaterialRecord[];
  logistics: LogisticsRecord[];
  procured: ProcuredRecord[];
  tooling: ToolingRecord[];
}

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The money columns a parent adds up from its children. */
const SUMMED: readonly CostColumnKey[] = ['materialCost', 'processCost', 'amortizedBatchSetup', 'logistics', 'tooling', 'otherDirect', 'capitalInvestment'];

function withTotals(values: CostRow['values']): CostRow['values'] {
  const total = (['materialCost', 'processCost', 'amortizedBatchSetup', 'logistics', 'tooling', 'otherDirect'] as const)
    .reduce((s, k) => s + (num(values[k]) ?? 0), 0);
  return { ...values, totalVariable: total, pieceCost: total };
}

/** A parent row's money: the sum of its children's, per column; a column no child has stays empty. */
function sumOf(children: CostRow[]): CostRow['values'] {
  const out: CostRow['values'] = {};
  for (const key of SUMMED) {
    const present = children.map((c) => num(c.values[key])).filter((v): v is number => v !== null);
    if (present.length > 0) out[key] = present.reduce((a, b) => a + b, 0);
  }
  return withTotals(out);
}

export function buildCostTable(input: CostTableInput): CostTable {
  const partId = `part:${input.part.id}`;
  const children: CostRow[] = [];

  // Material: the one active record; its usage and price describe the part.
  const material = input.materials[0];
  for (const m of input.materials) {
    children.push({
      id: `material:${m.id}`, parentId: partId, kind: 'material', name: m.material_name || 'Material', status: (num(m.total_cost) ?? 0) > 0 ? 'ok' : 'attention',
      values: withTotals({ materialCost: num(m.total_cost) }),
    });
  }

  // Processes, grouped as the apply wrote them (process_group), in operation order.
  const byGroup = new Map<string, ProcessRecord[]>();
  for (const p of [...input.processes].sort((a, b) => (num(a.op_nbr) ?? 1e9) - (num(b.op_nbr) ?? 1e9) || a.created_at.localeCompare(b.created_at))) {
    const g = p.process_group?.trim() || 'Other';
    byGroup.set(g, [...(byGroup.get(g) ?? []), p]);
  }
  for (const [group, records] of byGroup) {
    const groupId = `group:${group}`;
    const rows: CostRow[] = records.map((p) => {
      const total = num(p.total_cost_per_part);
      const setup = num(p.setup_cost_per_part) ?? 0;
      const seconds = num(p.cycle_time);
      return {
        id: `process:${p.id}`, parentId: groupId, kind: 'process',
        name: p.operation || p.process_name || 'Process', status: (total ?? 0) > 0 ? 'ok' : 'attention',
        ...((total ?? 0) > 0 ? {} : { statusNote: 'This operation carries no cost.' }),
        values: withTotals({
          processCost: total === null ? null : total - setup,
          amortizedBatchSetup: num(p.setup_cost_per_part),
          ...(seconds !== null ? { laborTimeSec: seconds } : {}),
          // The operation's source, as the record states it: nothing is derived, an unstated one stays empty.
          operationNumber: num(p.op_nbr), machineName: p.machine_name || null, partsPerCycle: num(p.parts_per_cycle), scrapPct: num(p.scrap),
          setupTimeMin: num(p.setup_time), batchSize: num(p.batch_size), machineRate: num(p.machine_rate), laborRate: num(p.labor_rate),
          timingSource: p.timing_source || null, setupTimeSource: p.setup_time_source || null,
        }),
      };
    });
    children.push({ id: groupId, parentId: partId, kind: 'group', name: group, status: rows.some((r) => r.status === 'attention') ? 'attention' : 'ok', values: sumOf(rows) }, ...rows);
  }

  for (const r of input.logistics) {
    children.push({ id: `logistics:${r.id}`, parentId: partId, kind: 'logistics', name: r.cost_name || 'Packaging & logistics', status: 'ok', values: withTotals({ logistics: num(r.total_cost) }) });
  }
  for (const r of input.procured) {
    children.push({ id: `procured:${r.id}`, parentId: partId, kind: 'procured', name: r.part_name || 'Procured part', status: 'ok', values: withTotals({ otherDirect: num(r.total_cost) }) });
  }
  for (const r of input.tooling) {
    const investment = num(r.total_tooling_investment) ?? ((num(r.unit_cost) ?? 0) * (num(r.quantity) ?? 1) || null);
    children.push({
      id: `tooling:${r.id}`, parentId: partId, kind: 'tooling', name: r.description || r.tooling_type || 'Tooling', status: 'ok',
      values: withTotals({ tooling: num(r.total_cost), capitalInvestment: investment }),
    });
  }

  // The part adds up its leaf rows only (a group row is already the sum of its processes).
  const leaves = children.filter((c) => c.kind !== 'group');
  const partValues = sumOf(leaves);
  const part: CostRow = {
    id: partId, parentId: null, kind: 'part', name: input.part.name,
    status: leaves.length === 0 || leaves.some((r) => r.status === 'attention') ? 'attention' : 'ok',
    ...(leaves.length === 0 ? { statusNote: 'No cost has been applied yet.' } : {}),
    values: {
      ...partValues,
      annualVolume: input.part.annualVolume,
      ...(material ? {
        finishMassKg: num(material.net_usage), materialComposition: material.material_name, utilizationPct: num(material.material_utilization_rate),
        materialUnitCost: num(material.unit_cost),
      } : {}),
    },
  };

  return { currency: 'USD', columns: COST_COLUMNS, rows: [part, ...children] };
}
