import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { BOMItemsService } from '../bom-items.service';
import { MachineDiscoveryService } from './machine-discovery.service';
import { SecondaryProcessService } from './secondary-process.service';
import { MACHINING_REFERENCE_SOURCE_VERSION } from '../costing/machining/lookup/machining-lookup-tables';
import { resolveCostingInputs } from '../costing/shared/physics/costing-inputs';

// One-time (non-recurring) investment for a part, from reference data only.
//
// Replaces the Investment tab's frontend tables: fixture prices per machine
// class, programming bands keyed on an invented "difficulty", drill/endmill/
// tap/boring-bar prices, CMM/gauge/profilometer prices and an FAI rate, all
// typed into page.tsx as INR "industry benchmarks". None came from a source.
//
// What the reference data does define, and is computed here:
//   NC programming  time = max(baseProgrammingTime, programmingFactor x the
//                   part's machining cycle time) (memory/Machining variables);
//                   cost at the selected machine's own programming rate, when
//                   its reference record carries one.
//   Fixture build   fixture build time x rate from the selected machine's own
//                   reference record, when it carries them.
//   CMM programming probe touches (the secondary-process CMM line) x
//                   CMMProgrammingTimePerTouch, at the CMM's machine + crew rate.
// Anything else (cutting-tool purchase, gauges) has no reference source and is
// listed as such, never priced.

export type NreStatus = 'costed' | 'gap';

export interface NreItem {
  item: string;
  status: NreStatus;
  usd: number | null;
  detail: string;
  source: string;
}

export interface NreResponse {
  items: NreItem[];
  totalUsd: number;
  /** Items that could not be priced (their usd is null). */
  gaps: number;
  amortization: {
    enabled: boolean;
    lifetimeVolume: number | null;
    perUnitUsd: number | null;
    reason: string;
  };
}

const VAR_SRC = 'memory/Machining/variables.csv';
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

@Injectable()
export class NreService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly bomItems: BOMItemsService,
    private readonly discovery: MachineDiscoveryService,
    private readonly secondary: SecondaryProcessService,
  ) {}

  private async machiningVariables(keys: string[]): Promise<Map<string, string>> {
    const { data } = await this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read')
      .from('machining_reference_data')
      .select('key, value')
      .eq('category', 'variable')
      .eq('source_version', MACHINING_REFERENCE_SOURCE_VERSION)
      .in('key', keys);
    return new Map((data ?? []).map((r: any) => [r.key, r.value]));
  }

  /** A selected machine's reference record (accounting block), by its mhr row. */
  private async machineAccounting(mhrId: string, accessToken: string): Promise<{ key: string; accounting: Record<string, unknown> } | null> {
    const db = this.supabase.getClient(accessToken);
    const { data: m } = await db.from('mhr_records').select('benchmark_source_key').eq('id', mhrId).maybeSingle();
    const key = (m as any)?.benchmark_source_key as string | undefined;
    if (!key) return null;
    const { data } = await this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read')
      .from('machining_reference_data')
      .select('raw')
      .eq('category', 'machine')
      .eq('key', key)
      .limit(1);
    const raw = (data?.[0] as any)?.raw;
    return raw ? { key, accounting: (raw.accounting ?? {}) as Record<string, unknown> } : null;
  }

  async compute(input: {
    itemId: string; userId: string; accessToken: string;
    batchSize: number | undefined; location: string; productionLifeYears: number | undefined;
  }): Promise<NreResponse> {
    const { itemId, userId, accessToken, location } = input;
    const item: any = await this.bomItems.findOne(itemId, userId, accessToken);
    const cost = await this.bomItems.getCostSummary(itemId, userId, accessToken, input.batchSize, location, input.productionLifeYears);
    const inputs = resolveCostingInputs({
      requested: { batchSize: input.batchSize ?? null, location, productionLifeYears: input.productionLifeYears ?? null },
      scenarioOverrides: item.scenarioOverrides,
      item,
    });
    const items: NreItem[] = [];

    // ── NC programming + fixture (primary machining lines) ─────────────────
    const primary = new Set([
      ...(await this.discovery.getEligibleClasses('primary_milling', location, accessToken)),
      ...(await this.discovery.getEligibleClasses('primary_turning', location, accessToken)),
    ]);
    const lines = (cost.processLines ?? []).filter((l) => primary.has(l.machineClass));
    if (lines.length === 0) {
      items.push({
        item: 'NC programming / fixture',
        status: 'gap',
        usd: null,
        detail: 'The route has no CNC machining line, and the reference data defines programming and fixture investment only for machining.',
        source: VAR_SRC,
      });
    } else {
      const v = await this.machiningVariables(['baseProgrammingTime', 'programmingFactor', 'disableInvestmentAmortization']);
      const baseMin = num(v.get('baseProgrammingTime'));
      const factor = num(v.get('programmingFactor'));
      const cycleMin = lines.reduce((s, l) => s + (l.cycleTimeMin ?? 0), 0);
      const main = lines[0]!;
      const acct = main.mhrId ? await this.machineAccounting(main.mhrId, accessToken) : null;
      const progRate = num(acct?.accounting['programmingRateUsdPerHr'] ?? acct?.accounting['programming_rate_usd_per_hr']);
      if (baseMin == null || factor == null) {
        items.push({ item: 'NC programming', status: 'gap', usd: null, detail: 'baseProgrammingTime / programmingFactor are not staged (migration 639).', source: VAR_SRC });
      } else {
        const hours = Math.max(baseMin, factor * cycleMin) / 60;
        const detail = `${hours.toFixed(2)} h = max(baseProgrammingTime ${baseMin} min, programmingFactor ${factor} × ${cycleMin.toFixed(2)} min machining cycle)`;
        items.push(progRate == null
          ? { item: 'NC programming', status: 'gap', usd: null, detail: `${detail}; ${main.machineName ?? main.machineClass} has no programming rate in its reference record.`, source: VAR_SRC }
          : { item: 'NC programming', status: 'costed', usd: hours * progRate, detail: `${detail} × ${progRate} USD/h (${main.machineName})`, source: `${VAR_SRC}; ${acct!.key}` });
      }
      const fxTime = num(acct?.accounting['fixtureBuildTimeHr'] ?? acct?.accounting['fixture_build_time_hr']);
      const fxRate = num(acct?.accounting['fixtureBuildRateUsdPerHr'] ?? acct?.accounting['fixture_build_rate_usd_per_hr']);
      items.push(fxTime != null && fxRate != null
        ? { item: 'Fixture build', status: 'costed', usd: fxTime * fxRate, detail: `${fxTime} h × ${fxRate} USD/h (${main.machineName})`, source: acct!.key }
        : { item: 'Fixture build', status: 'gap', usd: null, detail: `${main.machineName ?? main.machineClass} has no fixture build time/rate in its reference record.`, source: acct?.key ?? 'mhr_records.benchmark_source_key' });
    }

    // ── CMM programming (from the secondary-process CMM line) ──────────────
    const sec = await this.secondary.compute({ item, location, batchSize: inputs.batchSize, accessToken });
    const cmm = sec.lines.find((l) => l.process === 'CMM Inspection');
    const progStep = cmm?.trace.find((t) => t.label.startsWith('Programming'));
    if (cmm?.status === 'costed' && cmm.machine && progStep && typeof progStep.value === 'number') {
      const hourly = cmm.machine.mhrUsd + cmm.machine.lhrUsd * cmm.machine.operators;
      items.push({
        item: 'CMM programming', status: 'costed', usd: (progStep.value / 3600) * hourly,
        detail: `${progStep.value} s (${progStep.source}) × ${hourly.toFixed(2)} USD/h (${cmm.machine.name})`,
        source: 'memory/Secondary process',
      });
    } else {
      items.push({ item: 'CMM programming', status: 'gap', usd: null, detail: cmm?.reason ?? 'No CMM result for this part.', source: 'memory/Secondary process' });
    }

    // ── Injection mold (the engine's tooling result, memory/Plastic Modeling) ─
    const t = cost.tooling;
    if (t) {
      const labour = t.moldLabourCostUsd == null ? 'toolroom labour not priced (no rate for this location)' : `labour ${t.moldLabourCostUsd.toFixed(2)} USD`;
      items.push({
        item: 'Injection mold',
        status: 'costed',
        usd: t.moldCostUsd,
        detail: `${t.moldsRequired ?? 1} × SPI ${t.moldClass} mold (components ${(t.moldBomSubtotalUsd ?? 0).toFixed(2)} USD, ${labour}); ` +
          `one mold lasts ${(t.moldToolLifeShots ?? 0).toLocaleString()} shots; excludes mold-base steel (no price table on file)`,
        source: 'memory/Plastic Modeling (tblSpiType, cm* tooling tables, tblToolLife, digital_factory_settings_usa)',
      });
    } else if (cost.family === 'plastic_molded') {
      items.push({
        item: 'Injection mold', status: 'gap', usd: null,
        detail: cost.warnings.find((w) => w.startsWith('Tooling cost not computed')) ?? 'Needs an annual volume and production life to size the mold.',
        source: 'memory/Plastic Modeling',
      });
    }

    // ── Die casting die and coreboxes (the route's tooling, memory/Die Casting) ─
    const die = cost.dieTooling;
    if (die) {
      const usd = die.totalToolingUsd ?? die.dieCostUsd;
      items.push(die.ok && usd != null
        ? {
          item: 'Die casting die', status: 'costed', usd,
          detail: `${die.diesRequired ?? 1} × ${die.complexity} die${die.dieSizeMm ? ` ${die.dieSizeMm.map((v) => Math.round(v)).join(' × ')} mm` : ''}` +
            ` at ${die.dieCostUsd?.toFixed(2)} USD each` +
            (die.shotsPerDie != null ? `; one die lasts ${die.shotsPerDie.toLocaleString()} shots` : ''),
          source: 'memory/Die Casting (die tooling tables) + tool shop rates',
        }
        : { item: 'Die casting die', status: 'gap', usd: null, detail: die.reason ?? 'Die cost not derivable for this part.', source: 'memory/Die Casting' });
    }
    const boxes = cost.coreboxTooling;
    if (boxes) {
      items.push({ item: 'Coreboxes', status: 'costed', usd: boxes.costUsd, detail: `${boxes.boxes} corebox(es): ${boxes.detail}`, source: 'memory/Die Casting (coremaking) + tool shop rates' });
    }

    items.push({
      item: 'Cutting tools, gauges',
      status: 'gap',
      usd: null,
      detail: 'No reference purchase price for cutting tools (tblToolCost covers 5 drill rows only) or gauges.',
      source: 'memory/Machining/lookup/tblToolCost.csv',
    });

    // ── Amortization ───────────────────────────────────────────────────────
    const disable = (await this.machiningVariables(['disableInvestmentAmortization'])).get('disableInvestmentAmortization');
    const totalUsd = items.reduce((s, i) => s + (i.usd ?? 0), 0);
    const lifetimeVolume = inputs.annualVolume != null ? inputs.annualVolume * inputs.productionLifeYears : null;
    const enabled = disable === 'false';
    return {
      items,
      totalUsd,
      gaps: items.filter((i) => i.usd == null).length,
      amortization: {
        enabled,
        lifetimeVolume,
        perUnitUsd: enabled && lifetimeVolume ? totalUsd / lifetimeVolume : null,
        reason: disable == null
          ? 'disableInvestmentAmortization is not staged.'
          : !enabled ? 'Amortization is disabled by the reference variable disableInvestmentAmortization.'
            : lifetimeVolume == null ? 'No annual volume on file, so NRE cannot be spread per unit.'
              : `Spread over ${lifetimeVolume} units (annual volume × ${inputs.productionLifeYears} yr).`,
      },
    };
  }
}
