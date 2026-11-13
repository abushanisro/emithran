import type { PlasticFeatureGraph } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operations.service';
import { planRibInserts, ribSignals } from '../../../../../modules/bom-items/costing/plastic-molding/process/rib-inserts';
import { realPlasticReference } from './real-plastic-reference';

const REF = realPlasticReference().moldExtras.ribInsert;
const rib = (attributes: Record<string, unknown>) => ({ id: `rib-${Math.random()}`, feature_type: 'Rib', variant: 'legacy_antiparallel_pairs', attributes, occurrences: [] });
const graph = (items: ReturnType<typeof rib>[]): PlasticFeatureGraph =>
  ({ schema: 'plastic_feature_graph_v1', items, not_yet_recognized: ['SharpEdge'], unclassified_faces: 0 }) as unknown as PlasticFeatureGraph;

describe('rib inserts (EDM, formula registry F-31)', () => {
  it('reads the measured ribs from the graph, and counts a rib the engine did not measure as unmeasured', () => {
    const s = ribSignals(graph([
      rib({ count: 3, ribs: [{ height_mm: 30, length_mm: 40, thickness_mm: 1.2 }, { height_mm: 10, length_mm: 20, thickness_mm: 1.2 }] }),
      rib({ count: 2 }), // an analysis from before heights were measured
    ]));
    expect(s).toEqual({ measured: [{ heightMm: 30, lengthMm: 40, thicknessMm: 1.2 }, { heightMm: 10, lengthMm: 20, thicknessMm: 1.2 }], unmeasured: 3 });
    expect(ribSignals(null)).toBeNull();
  });

  it('is read from the real reference: 20 mm threshold, insert areas 1 / 9 / 36 in2, graphite electrodes', () => {
    expect(REF).toMatchObject({
      thresholdMm: 20, areaIn2: { small: 1, medium: 9, large: 36 }, electrodeIn3: { small: 4.6875, medium: 31.6875, large: 117.1875 },
      burns: { small: 2, medium: 2, large: 2 }, designHours: { small: 3, medium: 5, large: 10 },
      cutterPathHours: 5, spottingHours: 1, assemblyHours: 0.25, electrodeBurnFraction: 0.05, electrodeUsdPerIn3: 2.25,
      burnRateMm3PerMin: 68.28, pocketRateMm3PerMin: 136612, pocketSetupHours: 2,
    });
  });

  it('gives an insert only to a rib taller than machinedRibThreshold, of the smallest class whose area holds its footprint', () => {
    const p = planRibInserts({
      measured: [
        { heightMm: 20, lengthMm: 500, thicknessMm: 1 }, // not taller than 20 mm: machined in the plate, no insert
        { heightMm: 25, lengthMm: 20, thicknessMm: 1 }, // 20 mm2 = 0.031 in2 -> small (1 in2)
        { heightMm: 25, lengthMm: 300, thicknessMm: 2 }, // 600 mm2 = 0.93 in2 -> small
        { heightMm: 40, lengthMm: 500, thicknessMm: 2 }, // 1,000 mm2 = 1.55 in2 -> medium (9 in2)
        { heightMm: 40, lengthMm: 3000, thicknessMm: 3 }, // 9,000 mm2 = 13.95 in2 -> large (36 in2)
        { heightMm: 40, lengthMm: 9000, thicknessMm: 3 }, // 27,000 mm2 = 41.85 in2: no class holds it
      ],
      unmeasured: 0,
    }, REF);
    expect(p.counts).toEqual({ small: 2, medium: 1, large: 1 });
    expect(p.oversize).toBe(1);
    expect(p.priced).toBe(false); // an oversize rib is a gap, never squeezed into the large class
  });

  it('is priced only when every rib was measured and classed; no ribs at all is a real zero', () => {
    expect(planRibInserts({ measured: [{ heightMm: 25, lengthMm: 20, thicknessMm: 1 }], unmeasured: 0 }, REF).priced).toBe(true);
    expect(planRibInserts({ measured: [], unmeasured: 0 }, REF)).toMatchObject({ priced: true, counts: { small: 0, medium: 0, large: 0 } });
    expect(planRibInserts({ measured: [], unmeasured: 2 }, REF).priced).toBe(false);
    expect(planRibInserts(null, REF).priced).toBe(false);
  });
});
