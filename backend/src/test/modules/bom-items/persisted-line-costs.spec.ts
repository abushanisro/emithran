import { readFileSync } from 'fs';
import { join } from 'path';

import { applyPersistedRouteToSummary } from '../../../modules/bom-items/costing/shared/core/cost-engine';
import {
  getRouteCoreProcessClasses, getFormingProcessClasses, getProcessLabelForClass,
} from '../../../modules/bom-items/costing/shared/core/manufacturing-process-registry';

// D1. process_cost_records carries three per-line cost columns. Nothing ever
// wrote them, and buildLineFromAppliedRecord reads them as `?? 0` — so the
// moment a route was applied, the Cost Guide showed its two OVERLAID (core)
// operations at zero. Measured end to end on a real CAD-bearing part:
//
//   Cost Guide totalProcessCost 0.03988023952
//   applied route total         0.04095808383
//   difference                  Laser Cutting 0.00023952 + Press Brake 0.00035928
//
// The secondary operations matched exactly, because they are not overlaid and
// kept their live values. Two things had to change for the columns to arrive:
// the writer had to send them, and migration 704's RPC had to carry them (they
// were absent from its jsonb_to_recordset list and were silently dropped).

const CONTROLLER = join(__dirname, '..', '..', '..', 'modules', 'bom-items', 'bom-items.controller.ts');
const RPC = join(__dirname, '..', '..', '..', '..', 'migrations', '706_persist_process_line_costs.sql');
// The CURRENT definition of the same function. 706 added the three cost
// columns, 707 the currency contract, 718 the costed-operation provenance --
// each a full CREATE OR REPLACE, so the newest file is the one that must carry
// every column the writer sends.
const RPC_CURRENT = join(__dirname, '..', '..', '..', '..', 'migrations', '718_costed_operation_provenance.sql');
const executable = (src: string) =>
  src.split(/\r?\n/).filter((l) => !/^\s*(--|\/\/|\*|\/\*)/.test(l)).join('\n');

const COST_COLS = ['setup_cost_per_part', 'total_cycle_cost_per_part', 'total_cost_per_part'] as const;

describe('the writer sends the engine per-line costs', () => {
  const code = executable(readFileSync(CONTROLLER, 'utf8'));

  it.each(COST_COLS)('writes %s', (col) => {
    expect(code).toContain(col);
  });

  it('passes the engine values through instead of computing new ones', () => {
    expect(code).toMatch(/setup_cost_per_part:\s*line\.setupCost/);
    expect(code).toMatch(/total_cycle_cost_per_part:\s*line\.runCost/);
    expect(code).toMatch(/total_cost_per_part:\s*line\.totalCost/);
  });

  it('persists NULL, never 0, when the engine costed nothing', () => {
    // apply-custom-route composes steps awaiting manual cycle time. A 0 there
    // would read as a real, free operation.
    expect(code).toMatch(/setup_cost_per_part:\s*line\.setupCost \?\? null/);
    expect(code).not.toMatch(/setupCost\s*\?\?\s*0/);
    expect(code).not.toMatch(/totalCost\s*\?\?\s*0/);
  });
});

describe('the generation-swap RPC carries them too', () => {
  const sql = readFileSync(RPC, 'utf8');

  it.each(COST_COLS)('declares %s in the recordset', (col) => {
    // Absent from 704, so a caller that sent them had them silently dropped:
    // the rows inserted, three columns short, with no error anywhere.
    const recordset = sql.slice(sql.indexOf('jsonb_to_recordset'));
    expect(recordset).toContain(col);
  });

  it.each(COST_COLS)('inserts %s', (col) => {
    const insert = sql.slice(sql.indexOf('INSERT INTO process_cost_records'), sql.indexOf('FROM jsonb_to_recordset'));
    expect(insert).toContain(col);
  });

  it('keeps the 704 atomic-replacement semantics intact', () => {
    expect(sql).toContain('pg_advisory_xact_lock');           // concurrent applies serialise
    expect(sql).toContain('SECURITY INVOKER');                 // RLS applies as the caller
    expect(sql).toContain('refusing to replace with an empty generation');
    expect(sql).toMatch(/DELETE FROM process_cost_records[\s\S]{0,120}INSERT INTO process_cost_records/);
    expect(sql).toMatch(/v_inserted <> jsonb_array_length\(p_rows\)/); // all-or-nothing
  });

  it('does not redefine the rollup trigger', () => {
    // The live sync_process_cost_to_bom_item already sums the active
    // generation (verified behaviourally); its definition cannot be read from
    // this environment, so it is not rewritten blind.
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION sync_process_cost_to_bom_item');
    expect(sql).not.toContain('CREATE TRIGGER');
  });
});

describe('a persisted generation round-trips through the Cost Guide overlay', () => {
  const row = (over: Record<string, unknown>) => ({
    machine_class: 'fiber_laser', machine_name: 'NTC TLM-404 3300', mhr_id: null,
    operation: 'Laser Cut', process_group: 'Sheet Metal', process_route: 'Laser Cutting',
    cycle_time: 1.2, setup_time: 15, direct_rate: 1.942216,
    setup_cost_per_part: 0.0001, total_cycle_cost_per_part: 0.00013952,
    total_cost_per_part: 0.00023952, ...over,
  }) as never;

  const summarise = (rows: unknown[]) => applyPersistedRouteToSummary(
    {
      processLines: [
        { process: 'Laser Cutting', machineClass: 'fiber_laser', machineName: 'x',
          cycleTimeMin: 99, setupCost: 9, runCost: 9, totalCost: 9, hourlyRate: 0 },
        { process: 'Press Brake', machineClass: 'press_brake', machineName: 'x',
          cycleTimeMin: 99, setupCost: 9, runCost: 9, totalCost: 9, hourlyRate: 0 },
      ],
      cycleTimes: { laserMin: 99, pressBrakeMin: 99, totalMin: 198 },
      totalProcessCost: 0, materialCost: 0, totalCost: 0, warnings: [],
    } as never,
    rows as never, getProcessLabelForClass(),
  ) as never as { processLines: Array<{ process: string; setupCost: number; runCost: number; totalCost: number }>; totalProcessCost: number };

  it('shows one operation at its persisted cost, not zero', () => {
    const out = summarise([row({})]);
    const line = out.processLines.find((l) => l.process === 'Laser Cutting')!;
    expect(line.totalCost).toBeCloseTo(0.00023952, 8);
    expect(line.setupCost).toBeCloseTo(0.0001, 8);
    expect(line.runCost).toBeCloseTo(0.00013952, 8);
    expect(line.totalCost).not.toBe(0); // the defect
  });

  it('totals multiple operations rather than taking the last', () => {
    const out = summarise([
      row({}),
      row({ machine_class: 'press_brake', machine_name: 'Amada HG 8025', operation: 'Bend Brake',
        process_route: 'Bending', total_cost_per_part: 0.00035928,
        setup_cost_per_part: 0.0002, total_cycle_cost_per_part: 0.00015928 }),
    ]);
    // Sum, not last-row-wins — the same rule the live rollup applies.
    expect(out.totalProcessCost).toBeCloseTo(0.00023952 + 0.00035928, 6);
  });

  it('still reports zero when the columns are genuinely null', () => {
    // apply-custom-route's uncosted steps. Zero here is honest: nothing was
    // charged, and the row says so rather than inventing a figure.
    const out = summarise([row({ setup_cost_per_part: null, total_cycle_cost_per_part: null, total_cost_per_part: null })]);
    expect(out.processLines.find((l) => l.process === 'Laser Cutting')!.totalCost).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * D2. The costed-operation provenance columns (migration 718)
 *
 * Same failure shape as D1, one column further on: ProcessLineCost.hourlyRate
 * is the MACHINE hour rate (eMithranTerms takes mhrPerHr and dlrPerHr
 * separately), but buildLineFromAppliedRecord read direct_rate, which on a
 * newly applied row is machine + labour. Live row fce24614, 3 Roll Bending on a
 * Faccin HCU 300 X 1 whose mhr_records.total_machine_hour_rate is 15.85:
 *
 *   engine costed at        15.85 / hr
 *   applied line reported   62.52 / hr   (direct_rate = 15.85 + 46.67)
 *
 * direct_rate could not simply be swapped for machine_rate, because across live
 * active rows it means three different things depending on which producer wrote
 * it. So 718 added a column with one meaning, and only rows that carry it are
 * read the new way.
 * ──────────────────────────────────────────────────────────────────────────── */

const PROVENANCE_COLS = [
  'line_hourly_rate', 'line_labour_rate', 'engine_version', 'setup_time_source',
] as const;

describe('the writer sends the costed-operation provenance', () => {
  const code = executable(readFileSync(CONTROLLER, 'utf8'));

  it.each(PROVENANCE_COLS)('writes %s', (col) => {
    expect(code).toContain(col);
  });

  it('persists the rate the engine costed with, unrounded and unsummed', () => {
    expect(code).toMatch(/line_hourly_rate:\s*line\.hourlyRate/);
    // Not r2(...), and not machineRate + lhr.lhr -- that sum is direct_rate,
    // and reproducing it here would recreate the ambiguity 718 removes.
    expect(code).not.toMatch(/line_hourly_rate:\s*r2\(/);
    expect(code).not.toMatch(/line_hourly_rate:[^,\n]*\+/);
  });

  it('records the engine labour rate, never the re-looked-up benchmark', () => {
    // lhr.lhr is re-resolved here by process group; the engine used whatever it
    // resolved for the selected machine. The value that belongs against this
    // line is the one that produced its cost.
    expect(code).toMatch(/line_labour_rate:\s*line\.labourRate \?\? null/);
    expect(code).not.toMatch(/line_labour_rate:\s*lhr\.lhr/);
  });

  it('stamps the contract version so a reader can tell who wrote the row', () => {
    expect(code).toMatch(/engine_version:\s*COST_ENGINE_CONTRACT_VERSION/);
  });
});

describe('the current generation-swap RPC carries the provenance columns', () => {
  const sql = readFileSync(RPC_CURRENT, 'utf8');

  // The exact defect 706 existed to fix: a column the writer sends that is
  // missing from jsonb_to_recordset is discarded with no error at all.
  it.each(PROVENANCE_COLS)('declares %s in the recordset', (col) => {
    const recordset = sql.slice(sql.indexOf('jsonb_to_recordset'));
    expect(recordset).toContain(col);
  });

  it.each(PROVENANCE_COLS)('inserts %s', (col) => {
    const insert = sql.slice(
      sql.indexOf('INSERT INTO process_cost_records'),
      sql.indexOf('FROM jsonb_to_recordset'),
    );
    expect(insert).toContain(col);
  });

  // 718 is a full CREATE OR REPLACE, so everything 706 and 707 established has
  // to still be in it or applying 718 silently regresses them.
  it.each(['setup_cost_per_part', 'total_cycle_cost_per_part', 'total_cost_per_part',
           'cost_currency_basis', 'cost_currency_local', 'cost_fx_rate_from_local'])(
    'still carries %s from the earlier phases', (col) => {
      expect(sql.slice(sql.indexOf('jsonb_to_recordset'))).toContain(col);
    });

  it('keeps the atomic-replacement semantics intact', () => {
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('refusing to replace with an empty generation');
    expect(sql).toMatch(/v_inserted <> jsonb_array_length\(p_rows\)/);
  });
});

describe('an applied line reports the rate the engine costed it at', () => {
  // The real live row, with its real machine: Faccin HCU 300 X 1, whose
  // mhr_records.total_machine_hour_rate is 15.85, costed against the USA Sheet
  // Metal benchmark labour rate of 46.67 -- so direct_rate is 62.52.
  const rollBending = (over: Record<string, unknown>) => ({
    machine_class: 'roll_bending_3', machine_name: 'Faccin HCU 300 X 1', mhr_id: 'x',
    operation: '3 Roll Bending', process_group: 'Sheet Metal',
    process_route: 'Bending/Floating /Forming',
    cycle_time: 0.6, setup_time: 30,
    machine_rate: 15.85, labor_rate: 46.67, direct_rate: 62.52,
    setup_cost_per_part: 0.11812, total_cycle_cost_per_part: 0.012498,
    total_cost_per_part: 0.184644, ...over,
  }) as never;

  const lineFor = (row: unknown) => {
    const out = applyPersistedRouteToSummary(
      {
        processLines: [{
          process: '3 Roll Bending', machineClass: 'roll_bending_3', machineName: 'x',
          cycleTimeMin: 99, setupCost: 9, runCost: 9, totalCost: 9, hourlyRate: 0,
        }],
        cycleTimes: { laserMin: 0, pressBrakeMin: 0, totalMin: 0 },
        totalProcessCost: 0, materialCost: 0, totalCost: 0, warnings: [],
      } as never,
      [row] as never, getProcessLabelForClass(),
    ) as never as { processLines: Array<{ hourlyRate: number; labourRate?: number; setupTimeSource?: string }> };
    return out.processLines[0];
  };

  it('reads the machine rate, not the machine+labour sum', () => {
    const line = lineFor(rollBending({
      line_hourly_rate: 15.85, line_labour_rate: 46.67,
      engine_version: 'emithran-cost-1', setup_time_source: 'machine',
    }));
    expect(line.hourlyRate).toBeCloseTo(15.85, 6);
    // The defect: the same operation reporting 62.52 purely because a route was
    // applied -- a 3.9x jump with no rate having changed.
    expect(line.hourlyRate).not.toBeCloseTo(62.52, 2);
  });

  it('carries the engine labour rate and the real setup source through', () => {
    const line = lineFor(rollBending({
      line_hourly_rate: 15.85, line_labour_rate: 46.67,
      engine_version: 'emithran-cost-1', setup_time_source: 'machine',
    }));
    expect(line.labourRate).toBeCloseTo(46.67, 6);
    // Disclosed so a class default is never shown as the selected machine's own
    // setup time.
    expect(line.setupTimeSource).toBe('machine');
  });

  it('does not round the stored rate on the way back out', () => {
    // Per-part quantities here are legitimately sub-cent and rates are
    // legitimately sub-unit; r2 was what turned real persisted costs into 0.00
    // in D1. The same rule applies to the rate.
    const line = lineFor(rollBending({
      line_hourly_rate: 0.281677, line_labour_rate: 1.73,
      engine_version: 'emithran-cost-1',
    }));
    expect(line.hourlyRate).toBeCloseTo(0.281677, 6);
  });

  // Nothing is backfilled, so every row written before 718 has NULL here and
  // MUST keep reading exactly as it did. Reinterpreting a legacy row with a
  // meaning its producer never intended is the failure this phase exists to
  // stop, not a repair.
  it('leaves a legacy row reading exactly as it did before', () => {
    const line = lineFor(rollBending({}));
    expect(line.hourlyRate).toBeCloseTo(62.52, 2);
    expect(line.labourRate).toBeUndefined();
    expect(line.setupTimeSource).toBeUndefined();
  });

  it('treats a zero rate as a real rate, not as absence', () => {
    // Inspection and surface treatment genuinely set hourlyRate 0. `?? null`
    // rather than `|| null` in the writer, and `!= null` rather than a
    // truthiness check in the reader, are what keep that distinguishable.
    const line = lineFor(rollBending({
      line_hourly_rate: 0, line_labour_rate: 46.67, engine_version: 'emithran-cost-1',
    }));
    expect(line.hourlyRate).toBe(0);
  });
});
