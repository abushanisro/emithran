import { Injectable } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface CostDriver {
  label: string;
  category: 'process' | 'raw_material' | 'tooling' | 'procured_part' | 'packaging';
  costPerPart: number;
  pctOfMfgCost: number;
}

export interface ProcessLine {
  opNbr: number;
  operation: string | null;
  processGroup: string | null;
  processRoute: string | null;
  machineRate: number;
  laborRate: number;
  cycleTimeSec: number;
  setupTimeMin: number;
  batchSize: number;
  heads: number;
  setupManning: number;
  partsPerCycle: number;
  scrap: number;
  setupCostPerPart: number;
  cycleCostPerPart: number;
  totalCostPerPart: number;
  featureType: string | null;
}

export interface MaterialLine {
  materialName: string;
  materialDescription: string | null;
  unitCost: number;
  netUsage: number;
  grossUsage: number;
  scrap: number;
  overhead: number;
  totalCost: number;
}

export interface CostConfidence {
  material: 'high' | 'medium' | 'low';
  processRouting: 'high' | 'medium' | 'low';
  cycleTime: 'high' | 'medium' | 'low';
  supplierCost: 'high' | 'medium' | 'low';
  overall: number;
  label: string;
}

export interface BomItemCostDto {
  bomItemId: string;
  rawMaterialCost: number;
  processCost: number;
  toolingCost: number;
  packagingCost: number;
  procuredPartCost: number;
  manufacturingCost: number;
  sgaCost: number;
  profitCost: number;
  sellingPrice: number;
  costDrivers: CostDriver[];
  confidence: CostConfidence;
  processLines: ProcessLine[];
  materialLines: MaterialLine[];
}

@Injectable()
export class CostAggregationService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async computeBomItemCost(bomItemId: string, accessToken?: string): Promise<BomItemCostDto> {
    this.logger.log(`Computing aggregated cost for BOM item: ${bomItemId}`, 'CostAggregationService');
    const client = this.supabaseService.getClient(accessToken);

    const [
      { data: rawMatRows, error: rmErr },
      { data: processRows, error: pcErr },
      { data: toolingRows, error: tcErr },
      { data: packagingRows, error: pkErr },
      { data: procuredRows, error: ppErr },
    ] = await Promise.all([
      client
        .from('raw_material_cost_records')
        .select('material_name, material_description, unit_cost, gross_usage, net_usage, scrap, overhead')
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true),
      client
        .from('process_cost_records')
        .select('op_nbr, operation, process_group, process_route, machine_rate, labor_rate, setup_manning, setup_time, batch_size, heads, cycle_time, parts_per_cycle, scrap, mhr_id, lhr_id, feature_type')
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true)
        .order('op_nbr', { ascending: true }),
      client
        .from('tooling_cost_records')
        .select('description, unit_cost, quantity, usage_percentage, amortization_parts')
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true),
      client
        .from('packaging_logistics_cost_records')
        .select('cost_name, unit_cost, quantity')
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true),
      client
        .from('procured_parts_cost_records')
        .select('part_name, unit_cost, quantity, scrap_percentage, overhead_percentage')
        .eq('bom_item_id', bomItemId)
        .eq('is_active', true),
    ]);

    if (rmErr) this.logger.warn(`raw_material_cost_records: ${rmErr.message}`, 'CostAggregationService');
    if (pcErr) this.logger.warn(`process_cost_records: ${pcErr.message}`, 'CostAggregationService');
    if (tcErr) this.logger.warn(`tooling_cost_records: ${tcErr.message}`, 'CostAggregationService');
    if (pkErr) this.logger.warn(`packaging_logistics_cost_records: ${pkErr.message}`, 'CostAggregationService');
    if (ppErr) this.logger.warn(`procured_parts_cost_records: ${ppErr.message}`, 'CostAggregationService');

    // ── Material lines — compute from gross_usage × unit_cost × (1 + overhead/100)
    const materialLines: MaterialLine[] = (rawMatRows ?? []).map(r => {
      const grossUsage = parseFloat(r.gross_usage) || 0;
      const unitCost   = parseFloat(r.unit_cost)   || 0;
      const overhead   = parseFloat(r.overhead)    || 0;
      const totalCost  = grossUsage * unitCost * (1 + overhead / 100);
      return {
        materialName:        r.material_name        || '—',
        materialDescription: r.material_description ?? null,
        unitCost,
        netUsage:  parseFloat(r.net_usage) || 0,
        grossUsage,
        scrap:     parseFloat(r.scrap)     || 0,
        overhead,
        totalCost,
      };
    });
    const rawMaterialCost = materialLines.reduce((s, m) => s + m.totalCost, 0);

    // ── Process lines — compute from raw timing/rate fields
    // Formula: setupPerPart = (setup_time_min/60 × (MHR + LHR × manning)) / batch_size
    //          cyclePerPart = (cycle_time_sec/3600 × (MHR + LHR × heads)) / parts_per_cycle
    //          totalPerPart = (setupPerPart + cyclePerPart) × (1 + scrap/100)
    const processLines: ProcessLine[] = (processRows ?? []).map(r => {
      const machineRate  = parseFloat(r.machine_rate)    || 0;
      const laborRate    = parseFloat(r.labor_rate)      || 0;
      const setupManning = parseFloat(r.setup_manning)   || 0;
      const setupTimeMin = parseFloat(r.setup_time)      || 0;
      const batchSize    = parseFloat(r.batch_size)      || 1;
      const heads        = parseFloat(r.heads)           || 0;
      const cycleTimeSec = parseFloat(r.cycle_time)      || 0;
      const ppc          = parseFloat(r.parts_per_cycle) || 1;
      const scrap        = parseFloat(r.scrap)           || 0;

      const setupCostPerPart  = batchSize > 0
        ? (setupTimeMin / 60) * (machineRate + laborRate * setupManning) / batchSize
        : 0;
      const cycleCostPerPart  = ppc > 0
        ? (cycleTimeSec / 3600) * (machineRate + laborRate * heads) / ppc
        : 0;
      const totalCostPerPart  = (setupCostPerPart + cycleCostPerPart) * (1 + scrap / 100);

      return {
        opNbr:         parseInt(r.op_nbr)      || 0,
        operation:     r.operation             ?? null,
        processGroup:  r.process_group         ?? null,
        processRoute:  r.process_route         ?? null,
        machineRate,
        laborRate,
        cycleTimeSec,
        setupTimeMin,
        batchSize,
        heads,
        setupManning,
        partsPerCycle: ppc,
        scrap,
        setupCostPerPart,
        cycleCostPerPart,
        totalCostPerPart,
        featureType:   r.feature_type          ?? null,
      };
    });
    const processCost = processLines.reduce((s, p) => s + p.totalCostPerPart, 0);

    // ── Tooling — (unit_cost × qty × usage_pct/100) / amortization_parts
    let toolingCost = 0;
    const toolingItems: Array<{ label: string; cost: number }> = [];
    for (const r of toolingRows ?? []) {
      const cost = ((parseFloat(r.unit_cost) || 0) * (parseFloat(r.quantity) || 1)
        * (parseFloat(r.usage_percentage) || 100) / 100) / (parseFloat(r.amortization_parts) || 1);
      toolingCost += cost;
      if (cost > 0) toolingItems.push({ label: r.description || 'Tooling', cost });
    }

    // ── Packaging / logistics — unit_cost × quantity
    let packagingCost = 0;
    for (const r of packagingRows ?? []) {
      packagingCost += (parseFloat(r.unit_cost) || 0) * (parseFloat(r.quantity) || 1);
    }

    // ── Procured parts — unit_cost × qty × (1 + scrap_pct/100 + overhead_pct/100)
    let procuredPartCost = 0;
    const procuredItems: Array<{ label: string; cost: number }> = [];
    for (const r of procuredRows ?? []) {
      const cost = (parseFloat(r.unit_cost) || 0) * (parseFloat(r.quantity) || 1)
        * (1 + (parseFloat(r.scrap_percentage) || 0) / 100 + (parseFloat(r.overhead_percentage) || 0) / 100);
      procuredPartCost += cost;
      if (cost > 0) procuredItems.push({ label: r.part_name || 'Procured Part', cost });
    }

    const manufacturingCost = rawMaterialCost + processCost + toolingCost + packagingCost + procuredPartCost;
    const sgaCost    = manufacturingCost * 0.125;
    const profitCost = manufacturingCost * 0.08;
    const sellingPrice = manufacturingCost + sgaCost + profitCost;

    // ── Cost drivers — collect all cost items, rank top 5 by value
    const allDrivers: CostDriver[] = [];

    for (const pl of processLines) {
      if (pl.totalCostPerPart > 0) {
        allDrivers.push({
          label:       pl.operation || pl.processGroup || `Op ${pl.opNbr}`,
          category:    'process',
          costPerPart: pl.totalCostPerPart,
          pctOfMfgCost: 0,
        });
      }
    }
    for (const ml of materialLines) {
      if (ml.totalCost > 0) {
        allDrivers.push({
          label:       ml.materialDescription ? `${ml.materialName} (${ml.materialDescription})` : ml.materialName,
          category:    'raw_material',
          costPerPart: ml.totalCost,
          pctOfMfgCost: 0,
        });
      }
    }
    for (const t of toolingItems) {
      allDrivers.push({ label: t.label, category: 'tooling', costPerPart: t.cost, pctOfMfgCost: 0 });
    }
    for (const p of procuredItems) {
      allDrivers.push({ label: p.label, category: 'procured_part', costPerPart: p.cost, pctOfMfgCost: 0 });
    }

    const costDrivers = allDrivers
      .sort((a, b) => b.costPerPart - a.costPerPart)
      .slice(0, 5)
      .map(d => ({
        ...d,
        pctOfMfgCost: manufacturingCost > 0 ? (d.costPerPart / manufacturingCost) * 100 : 0,
      }));

    // ── Confidence — proxy: mhr_id/lhr_id presence for rate quality, routing completeness
    const hasRates    = (processRows ?? []).some(r => r.mhr_id || r.lhr_id);
    const hasRouting  = (processRows ?? []).length > 0
      && (processRows ?? []).every(r => r.process_group && r.operation);

    const cycleTimeConf: 'high' | 'medium' | 'low' = hasRates ? 'high' : processLines.length > 0 ? 'medium' : 'low';
    const routingConf:   'high' | 'medium' | 'low' = hasRouting ? 'high' : processLines.length > 0 ? 'medium' : 'low';
    const materialConf:  'high' | 'medium' | 'low' = materialLines.length > 0 ? 'high' : 'low';
    const supplierConf:  'high' | 'medium' | 'low' = procuredPartCost > 0 ? 'high' : 'medium';

    const confScore = (c: 'high' | 'medium' | 'low') => c === 'high' ? 100 : c === 'medium' ? 65 : 30;
    const overall = Math.round(
      confScore(materialConf) * 0.3
      + confScore(routingConf) * 0.3
      + confScore(cycleTimeConf) * 0.3
      + confScore(supplierConf) * 0.1,
    );

    const confidence: CostConfidence = {
      material:       materialConf,
      processRouting: routingConf,
      cycleTime:      cycleTimeConf,
      supplierCost:   supplierConf,
      overall,
      label: `${overall}%`,
    };

    this.logger.log(
      `BOM item ${bomItemId}: mfg=₹${manufacturingCost.toFixed(2)} raw=₹${rawMaterialCost.toFixed(2)} process=₹${processCost.toFixed(2)} procured=₹${procuredPartCost.toFixed(2)} confidence=${overall}%`,
      'CostAggregationService',
    );

    return {
      bomItemId,
      rawMaterialCost,
      processCost,
      toolingCost,
      packagingCost,
      procuredPartCost,
      manufacturingCost,
      sgaCost,
      profitCost,
      sellingPrice,
      costDrivers,
      confidence,
      processLines,
      materialLines,
    };
  }
}
