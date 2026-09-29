/**
 * Polygon sockets / bosses: CAD polygon candidates kept by a drawing polygon
 * callout, rotary broached from the real tblRotaryBroaching + variables, with
 * the pilot hole through the real Drilling calculator (tblDrilling).
 */
import { polygonCallout, resolvePolygons, splitPolygonPockets } from '../../../../../../modules/bom-items/costing/machining/operation/polygon-routing';
import { computeMillingCostSummary, computeDrillCycle } from '../../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { realDrillingTable, realRotaryBroachReference } from '../real-reference-tables';

const CALCS = specAsCalculators();
const ROTARY = realRotaryBroachReference();
const DRILLING = realDrillingTable();
const rate = (r: number, extra: Record<string, unknown> = {}) => ({ rate: r, source: 'mhr_database' as const, machineName: null, commodityCode: null, ...extra }) as any;

// The cad-engine hex-socket fixture (test_polygon_rings.py): radius-8 hexagon, 10 mm deep.
const HEX_SOCKET = { kind: 'socket', side_count: 6, across_flats_mm: 13.856, depth_mm: 10, face_indices: [6, 7, 8, 9, 10, 11] };

function milled(polygons: ReturnType<typeof resolvePolygons>) {
  return computeMillingCostSummary({
    volume: 50_000, surfaceArea: 12_000, maxLength: 60, maxWidth: 50, maxHeight: 20,
    holeCount: 0, holeGroups: [], pocketCount: 0,
    materialGrade: 'AISI 1018', materialCostPerKg: 2, materialDensityKgM3: 7850,
    materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
    batchSize: 100, family: 'milled', finishedWeightKg: 0.4,
    mhrRate: rate(900, { machineClass: '3_axis_mill' }),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'manual_deburr' }),
    inspectionRate: rate(450, { machineClass: 'machining_inspection' }),
    surfaceTreatment: null,
    machiningCalculators: CALCS,
    drillingTable: DRILLING,
    polygons,
    rotaryBroach: ROTARY,
  } as any, { machineClass: '3_axis_mill' } as any);
}

describe('polygon routing (drawing callout + CAD candidates)', () => {
  it('keeps candidates only when the drawing has a polygon callout', () => {
    expect(polygonCallout({ polygon_callout: 'None' })).toBeNull();
    expect(resolvePolygons([HEX_SOCKET], null)).toEqual([]);
    expect(resolvePolygons([HEX_SOCKET, HEX_SOCKET], 'HEX SOCKET')).toEqual([{ kind: 'socket', sides: 6, acrossFlatsMm: 13.856, depthMm: 10, count: 2 }]);
    expect(resolvePolygons([{ ...HEX_SOCKET, kind: 'unknown' }], 'HEX SOCKET')).toEqual([]);
  });

  it("takes only the socket's own pocket (shared face ids) out of the milling sequence", () => {
    const features = [
      { feature_type: 'PocketV2', occurrences: [{ face_ids: [6, 7, 12] }, { face_ids: [20, 21] }] },
      { feature_type: 'SimpleHole', occurrences: [{ face_ids: [30] }] },
    ];
    const out = splitPolygonPockets(features, [HEX_SOCKET], 'HEX SOCKET');
    expect(out.removedPocketOccurrences).toBe(1);
    expect(out.filteredFeatures[0]).toMatchObject({ occurrences: [{ face_ids: [20, 21] }] });
    expect(splitPolygonPockets(features, [HEX_SOCKET], null).filteredFeatures).toBe(features);
  });
});

describe('Rotary Broaching end to end (real tables)', () => {
  it('prices a 13.86 mm A/F hex socket, 10 deep, in mild steel: pilot hole + broach', () => {
    const line = milled(resolvePolygons([HEX_SOCKET], 'HEX SOCKET')).processLines.find((l) => l.process === 'Rotary Broaching')!;
    expect(line).toBeDefined();
    const pilot = computeDrillCycle(13.856 * ROTARY.pilotDiameterRatio[6]!, 'AISI 1018', 10 * ROTARY.pilotLengthRatio, DRILLING, CALCS, 1);
    const row = ROTARY.rows.find((r: any) => r.MaterialCutCodeName === '1.0')!; // 125 HB, nearest to mild steel
    const broachSec = (10 / (row.RPM * row.FeedMmPerRev * ROTARY.feedAdjustment)) * 60;
    expect(pilot.sec).not.toBeNull();
    expect(line.cycleTimeMin).toBeCloseTo((pilot.sec! + broachSec) / 60, 2);
  });

  it('names a socket deeper than the broach reaches instead of pricing it', () => {
    const r = milled(resolvePolygons([{ ...HEX_SOCKET, depth_mm: 60 }], 'HEX SOCKET'));
    expect(JSON.stringify(r.processLines.find((l) => l.process === 'Rotary Broaching')?.physicsGap ?? r.warnings)).toContain('a rotary broach reaching 60 mm');
  });

  it('reports a boss (polygon turning) as not priced', () => {
    const r = milled(resolvePolygons([{ ...HEX_SOCKET, kind: 'boss' }], 'POLYGON TURNING'));
    expect(r.warnings.join(' ')).toContain('Polygon turning (6-sided, 13.856 mm across flats) not priced');
    expect(r.processLines.some((l) => l.process === 'Rotary Broaching')).toBe(false);
  });
});
