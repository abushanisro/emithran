import { RuleEngineService } from './rule-engine.service';
import { FeatureGraphService } from './feature-graph.service';
import { UNAVAILABLE_DRAWING_BRIEF } from '../dto/drawing-brief.dto';
import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type {
  ManufacturingFeature,
  ManufacturingFeatureGraph,
} from '../dto/manufacturing-feature.dto';

function graph(features: ManufacturingFeature[]): ManufacturingFeatureGraph {
  return { features, buildSources: ['drawing'], overallConfidence: 0.9 };
}

describe('RuleEngineService — cleaning before surface treatment', () => {
  const svc = new RuleEngineService();

  it('inserts a Cleaning op sequenced before the surface treatment op', () => {
    const ops = svc.evaluate(graph([
      { id: 'F1', type: 'ANODIZE', source: 'drawing', confidence: 0.95, spec: 'Type III Hardcoat' },
    ]));
    const clean = ops.find((o) => o.machineCategoryHint === 'cleaning');
    const anodize = ops.find((o) => o.machineCategoryHint === 'surface_treatment');
    expect(clean).toBeDefined();
    expect(anodize).toBeDefined();
    expect(clean!.suggestedOpNbr).toBeLessThan(anodize!.suggestedOpNbr);
  });

  it('also fires from the drawing-confirmed coating column (no ANODIZE feature)', () => {
    const ops = svc.evaluate(graph([]), { tightestToleranceMm: null, coating: 'Type III Hardcoat' });
    expect(ops.some((o) => o.machineCategoryHint === 'surface_treatment')).toBe(true);
    expect(ops.some((o) => o.machineCategoryHint === 'cleaning')).toBe(true);
  });

  it('adds no cleaning op when the part has no surface treatment', () => {
    const ops = svc.evaluate(graph([
      { id: 'F1', type: 'DEBURR', source: 'bom', confidence: 0.99 },
    ]));
    expect(ops.some((o) => o.machineCategoryHint === 'cleaning')).toBe(false);
  });
});

describe('RuleEngineService — CMM inspection', () => {
  const svc = new RuleEngineService();

  it('emits a dedicated CMM op (before final inspection) when the INSPECT feature demands CMM', () => {
    const ops = svc.evaluate(graph([
      { id: 'F1', type: 'INSPECT', source: 'drawing', confidence: 0.99, inspectionMethod: 'cmm' },
    ]));
    const cmm = ops.find((o) => o.machineCategoryHint === 'cmm');
    const final = ops.find((o) => o.machineCategoryHint === 'inspection_bench');
    expect(cmm).toBeDefined();
    expect(cmm!.operationHint).toBe('CMM Inspection');
    expect(final).toBeDefined();
    expect(cmm!.suggestedOpNbr).toBeLessThan(final!.suggestedOpNbr);
  });

  it('does not duplicate CMM when the tolerance rule would also fire', () => {
    const ops = svc.evaluate(
      graph([{ id: 'F1', type: 'INSPECT', source: 'drawing', confidence: 0.99, inspectionMethod: 'cmm' }]),
      { tightestToleranceMm: 0.05, coating: null },
    );
    expect(ops.filter((o) => o.machineCategoryHint === 'cmm')).toHaveLength(1);
  });

  it('still fires the tolerance-only CMM rule when the feature graph has no CMM signal', () => {
    const ops = svc.evaluate(
      graph([{ id: 'F1', type: 'INSPECT', source: 'bom', confidence: 0.99 }]),
      { tightestToleranceMm: 0.08, coating: null },
    );
    expect(ops.filter((o) => o.machineCategoryHint === 'cmm')).toHaveLength(1);
  });
});

describe('RuleEngineService — family-aware machine hints', () => {
  const svc = new RuleEngineService();
  const thread: ManufacturingFeature = {
    id: 'F1', type: 'THREAD_INTERNAL', source: 'drawing', confidence: 0.95, spec: 'M4×0.7',
  };

  it('taps on the mill for milled parts', () => {
    const ops = svc.evaluate(graph([thread]), undefined, undefined, 'cnc_milled');
    expect(ops.find((o) => /tapping/i.test(o.operationHint))!.machineCategoryHint).toBe('cnc_mill');
  });

  it('taps on the lathe for turned parts (and when family is unknown)', () => {
    const turned = svc.evaluate(graph([thread]), undefined, undefined, 'cnc_turned');
    expect(turned.find((o) => /tapping/i.test(o.operationHint))!.machineCategoryHint).toBe('cnc_lathe');
    const unknown = svc.evaluate(graph([thread]));
    expect(unknown.find((o) => /tapping/i.test(o.operationHint))!.machineCategoryHint).toBe('cnc_lathe');
  });
});

describe('FeatureGraphService — GD&T upgrades the INSPECT feature to CMM', () => {
  const svc = new FeatureGraphService();

  function makeBrief(overrides: {
    gdt?: Array<{ feature: string; symbol: string; tolerance: number; datumRefs: string[]; modifier: string | null }>;
    tightestToleranceMm?: number | null;
    available?: boolean;
  }): EngineeringBrief {
    return {
      bomItem: {
        partName: 'Boom Clamp', materialHint: 'AL6061',
        tightestToleranceMm: overrides.tightestToleranceMm ?? null,
        unitWeightKg: 0.27,
      },
      dfm: { holeCount: 0, pocketCount: 0, slotCount: 0, bendCount: 0, cutLengthMm: 0 },
      drawing: {
        ...UNAVAILABLE_DRAWING_BRIEF,
        available: overrides.available ?? true,
        gdt: overrides.gdt ?? [],
      },
      scope: { family: 'cnc_milled', inScope: true, reason: '', confidence: 0.9 },
    } as unknown as EngineeringBrief;
  }

  it('position ⌀0.05 → INSPECT feature carries inspectionMethod cmm', () => {
    const result = svc.build(makeBrief({
      gdt: [{ feature: 'holes', symbol: 'position', tolerance: 0.05, datumRefs: ['A', 'B', 'C'], modifier: null }],
    }));
    const inspect = result.features.find((f) => f.type === 'INSPECT')!;
    expect(inspect.inspectionMethod).toBe('cmm');
    expect(inspect.spec).toContain('CMM');
  });

  it('loose GD&T alone does not force CMM', () => {
    const result = svc.build(makeBrief({
      gdt: [{ feature: 'face', symbol: 'flatness', tolerance: 1.0, datumRefs: [], modifier: null }],
    }));
    expect(result.features.find((f) => f.type === 'INSPECT')!.inspectionMethod).not.toBe('cmm');
  });

  it('tight BOM tolerance forces CMM even without GD&T callouts', () => {
    const result = svc.build(makeBrief({ tightestToleranceMm: 0.05, available: false }));
    expect(result.features.find((f) => f.type === 'INSPECT')!.inspectionMethod).toBe('cmm');
  });
});
