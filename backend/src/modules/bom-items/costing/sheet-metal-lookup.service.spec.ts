import { SheetMetalLookupService } from './sheet-metal-lookup.service';

// Manual-stroke rows actually seeded for tonnage=80/simple (migration 360) —
// same three rows the live "Result Unavailable" trace showed as nearest
// matches for a 0.5mm request (thicknessMm=1 -> 1.18, =2 -> 1.30, =3 -> 1.46).
const MANUAL_STROKE_ROWS_80T_SIMPLE = [
  { thickness_mm: 1, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.18 },
  { thickness_mm: 2, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.30 },
  { thickness_mm: 3, tonnage: 80, complexity: 'simple', stroke_time_sec: 1.46 },
];

function fakeSupabaseService(rows: typeof MANUAL_STROKE_ROWS_80T_SIMPLE) {
  const builder: any = {
    from: (_table: string) => builder,
    select: (_cols: string) => builder,
    eq: (_col: string, _val: unknown) => builder,
    limit: (_n: number) => builder,
    lte: (_col: string, _val: unknown) => builder,
    gte: (_col: string, _val: unknown) => builder,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rows }),
  };
  return { getAdminClient: () => builder } as any;
}

describe('SheetMetalLookupService.getManualStrokeTime', () => {
  it('still resolves an exact seeded row unchanged', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(1, 80, 'simple');
    expect(result.dataFound).toBe(true);
    expect(result.secondsPerBend).toBeCloseTo(1.18, 2);
    expect(result.resolution.policy).toBe('EXACT_MATCH');
  });

  it('still interpolates between two real bracketing rows unchanged', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(1.5, 80, 'simple');
    expect(result.dataFound).toBe(true);
    // Linear midpoint of 1.18 and 1.30.
    expect(result.secondsPerBend).toBeCloseTo(1.24, 2);
    expect(result.resolution.matchedRow?.columns['interpolated_between_thickness_mm']).toBe('1-2');
  });

  it('extrapolates below the smallest real row instead of reporting a bare gap (0.5mm/80T/simple)', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService(MANUAL_STROKE_ROWS_80T_SIMPLE));
    const result = await svc.getManualStrokeTime(0.5, 80, 'simple');
    expect(result.dataFound).toBe(true);
    // Local slope between the two nearest real rows (1mm->1.18s, 2mm->1.30s)
    // is 0.12s/mm; extrapolating half a step below 1mm: 1.18 - 0.5*0.12 = 1.12.
    expect(result.secondsPerBend).toBeCloseTo(1.12, 2);
    expect(result.resolution.matchedRow?.columns['extrapolated_from_thickness_mm']).toBe('1-2');
    expect(result.resolution.matchedRow?.columns['interpolated_between_thickness_mm']).toBeUndefined();
  });

  it('still reports a real gap when fewer than two real rows exist on the near side', async () => {
    const svc = new SheetMetalLookupService(fakeSupabaseService([MANUAL_STROKE_ROWS_80T_SIMPLE[0]]));
    const result = await svc.getManualStrokeTime(0.5, 80, 'simple');
    expect(result.dataFound).toBe(false);
    expect(result.resolution.matchedRow).toBeNull();
  });
});
