// Phase 1 (Press Brake) integration tests — REAL SupabaseService against the
// dev project (`.env`), read-only, no mocks. Every expected value is read at
// test time from the live tables or from memory/Sheetmetal/machine/
// machine_library.csv (the roadmap source), never typed in here.
//
// Requirement → test traceability:
//   R1.4  Time Per Stroke resolves on open; interpolation exposes the two
//         real bracketing rows                     → "manual stroke table"
//   R1.4  The selected machine's own bend cycle time wins over the table,
//         same as the cost engine                  → "per-machine stroke"
//   R1.3  SECC carries a real UTS for the calculator → "SECC UTS"
//   R1.7  press_brake mhr_records carry the library bend length / thickness
//         (migration 894)                          → "machine library backfill"
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';

const REASON = 'e2e test: read-only reference data check';
// Each test makes several round trips to the remote dev database.
jest.setTimeout(30_000);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function readPressBrakeLibrary(): { name: string; bendLengthMm: number; minThicknessMm: number; cycleS: number }[] {
  const csvPath = path.resolve(__dirname, '../../memory/Sheetmetal/machine/machine_library.csv');
  const [header, ...lines] = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cols = header.split(',');
  const at = (cells: string[], c: string) => cells[cols.indexOf(c)];
  return lines
    .map((l) => l.split(','))
    .filter((c) => at(c, 'machine_category') === 'Bend Press Brake' && at(c, 'name') !== 'Default Bend Brake')
    .map((c) => ({
      name: at(c, 'name'),
      bendLengthMm: Number(at(c, 'max_bend_length_mm')),
      minThicknessMm: Math.min(
        Number(at(c, 'max_thickness_steel_mm')),
        Number(at(c, 'max_thickness_stainless_steel_mm')),
        Number(at(c, 'max_thickness_aluminum_mm')),
      ),
      cycleS: Number(at(c, 'bend_cycle_time_s')),
    }));
}

describe('[e2e] Phase 1 press brake — real DB, no mocks', () => {
  let supabase: SupabaseService;
  let lookup: SheetMetalLookupService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, SheetMetalLookupService],
    }).compile();
    supabase = moduleRef.get(SupabaseService);
    lookup = moduleRef.get(SheetMetalLookupService);
  });

  it('manual stroke table: a thickness between two real rows interpolates and returns both rows', async () => {
    const db = supabase.getPrivilegedClient(REASON);
    const { data, error } = await db.from('sm_lookup_manual_stroke')
      .select('thickness_mm, tonnage, complexity, stroke_time_sec').eq('complexity', 'simple');
    expect(error).toBeNull(); // a failure names the real database error, not "undefined"
    expect(data?.length).toBeGreaterThan(0);
    // Pick a real tonnage class with two adjacent thickness rows, query halfway.
    const byTon = new Map<number, number[]>();
    for (const r of data!) byTon.set(Number(r.tonnage), [...(byTon.get(Number(r.tonnage)) ?? []), Number(r.thickness_mm)]);
    const [ton, ts] = [...byTon.entries()].find(([, t]) => new Set(t).size >= 2)!;
    const [lo, hi] = [...new Set(ts)].sort((a, b) => a - b);
    const mid = (lo + hi) / 2;

    const res = await lookup.getManualStrokeTime(mid, ton, 'simple');
    expect(res.dataFound).toBe(true);
    expect(res.resolution.policy).toBe('INTERPOLATE');
    const rows = res.resolution.nearestRows.map((r) => Number(r.columns.thickness_mm));
    expect(rows).toEqual([lo, hi]);
    const sec = (t: number) => Number(data!.find((r) => Number(r.tonnage) === ton && Number(r.thickness_mm) === t)!.stroke_time_sec);
    expect(res.secondsPerBend).toBeCloseTo((sec(lo) + sec(hi)) / 2, 6);
  });

  it('per-machine stroke: a library press brake uses its own bend cycle time, flagged fromMachineSpec', async () => {
    const machine = readPressBrakeLibrary()[0];
    const res = await lookup.getManualStrokeTimeForPressBrake(1.6, 100, 'simple', machine.name);
    expect(res.fromMachineSpec).toBe(true);
    expect(res.secondsPerBend).toBe(machine.cycleS);
  });

  it('per-machine stroke: an unknown machine falls back to the table, not flagged', async () => {
    const table = await lookup.getManualStrokeTime(1.6, 100, 'simple');
    const res = await lookup.getManualStrokeTimeForPressBrake(1.6, 100, 'simple', 'No Such Press Brake');
    expect(res.fromMachineSpec).toBe(false);
    expect(res.secondsPerBend).toBe(table.secondsPerBend);
  });

  it('SECC UTS: the raw_materials row carries a real UTS for the bending calculator', async () => {
    const db = supabase.getPrivilegedClient(REASON);
    const { data, error } = await db.from('raw_materials')
      .select('name, uts_mpa, ultimate_tensile_strength').ilike('name', 'SECC');
    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
    for (const r of data!) expect(Number(r.uts_mpa ?? r.ultimate_tensile_strength)).toBeGreaterThan(0);
  });

  // Fails until migration 894 has been run against this database.
  it('machine library backfill: every matched press_brake row carries the library bend length and thickness', async () => {
    const db = supabase.getPrivilegedClient(REASON);
    const { data, error } = await db.from('mhr_records')
      .select('machine_name, max_length_mm, max_thickness_mm').eq('machine_class', 'press_brake');
    expect(error).toBeNull();
    const lib = new Map(readPressBrakeLibrary().map((m) => [norm(m.name), m]));
    const matched = (data ?? []).filter((r) => lib.has(norm(r.machine_name)));
    expect(matched.length).toBeGreaterThan(0);
    const wrong = matched.filter((r) => {
      const m = lib.get(norm(r.machine_name))!;
      return Number(r.max_length_mm) !== m.bendLengthMm || Number(r.max_thickness_mm) > m.minThicknessMm;
    });
    expect(wrong.map((r) => r.machine_name)).toEqual([]);
  });
});
