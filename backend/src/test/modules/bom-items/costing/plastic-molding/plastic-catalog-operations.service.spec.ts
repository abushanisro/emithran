import { PlasticCatalogOperationsService, type PlasticFeatureGraph } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operations.service';
import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// The staged catalog rows of each molding process (process_taxonomy_operations): compression has no core or lifter operation for a hole.
const CATALOG: Record<string, string[]> = {
  inj: ['Injection Molding:As Molded//SimpleHole', 'Injection Molding:HoleSideCore//SimpleHole', 'Injection Molding:HoleLifter//SimpleHole', 'Injection Molding:HoleNoCore//SimpleHole', 'Injection Molding:As Molded//PlanarFace', 'Injection Molding:Slides//SlideBundle'],
  rim: ['Reaction Injection Molding:As Molded//SimpleHole', 'Reaction Injection Molding:HoleSideCore//SimpleHole', 'Reaction Injection Molding:HoleNoCore//SimpleHole', 'Reaction Injection Molding:As Molded//PlanarFace'],
  sfm: ['Structural Foam Molding:As Molded//SimpleHole', 'Structural Foam Molding:HoleSideCore//SimpleHole', 'Structural Foam Molding:HoleNoCore//SimpleHole', 'Structural Foam Molding:As Molded//PlanarFace'],
  cm: ['Compression Molding:As Molded//SimpleHole', 'Compression Molding:As Molded//PlanarFace'],
  // memory/Assembly molding/Processes/operations.csv (migration 862): insert molding's own rows.
  iim: ['Insert Injection Molding:As Molded//SimpleHole', 'Insert Injection Molding:HoleUnscrewMandrel//SimpleHole', 'Insert Injection Molding:As Molded//PlanarFace', 'Insert Injection Molding:Slides//SlideBundle'],
  ipp: ['Insert Pick and Place:Manual Load//AssemblyComponentGcd', 'Insert Pick and Place:Robotic Load//AssemblyComponentGcd', 'Insert Pick and Place:Insert Slides//SlideBundle'],
};
const CLASS_TO_CANONICAL: Record<string, string> = {
  injection_molding: 'inj', reaction_injection_molding: 'rim', structural_foam_molding: 'sfm', compression_molding: 'cm',
  assembly_molding_insert_injection_molding: 'iim', assembly_molding_insert_pick_and_place: 'ipp',
};

const graph: PlasticFeatureGraph = {
  schema: 'plastic_feature_graph_v1',
  not_yet_recognized: ['Void', 'PartingLine'],
  unclassified_faces: 0,
  items: [
    { id: 'h1', feature_type: 'SimpleHole', variant: 'through', diameter_mm: 6.3, attributes: { angle_to_pull_deg: 90 }, occurrences: [{ face_ids: [1] }] },
    { id: 'pf', feature_type: 'PlanarFace', variant: null, attributes: { faces: 12 }, occurrences: [{ face_ids: [2] }] },
  ],
};

const line = (machineClass: string) => ({ machineClass, process: machineClass }) as unknown as ProcessLineCost;

function service() {
  const client = {
    from: () => {
      let ids: string[] = [];
      const q: any = {
        select: () => q,
        in: (_c: string, v: string[]) => { ids = v; return q; },
        order: () => q,
        range: () => Promise.resolve({ data: ids.flatMap((id) => (CATALOG[id] ?? []).map((raw) => ({ canonical_process_id: id, raw_compound_string: raw }))), error: null }),
      };
      return q;
    },
  };
  const db = { getClient: () => client } as any;
  const rates = {
    resolveProcessIdentities: async (_t: string, classes: string[]) =>
      Object.fromEntries(classes.map((c) => [c, { canonicalProcessId: CLASS_TO_CANONICAL[c] ?? null }])),
  } as any;
  return new PlasticCatalogOperationsService(db, rates);
}

describe('PlasticCatalogOperationsService', () => {
  const rules = { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: true };

  it('resolves each molding line against its own process catalog', async () => {
    const lines = ['injection_molding', 'reaction_injection_molding', 'structural_foam_molding', 'compression_molding'].map(line);
    await service().attach({ lines, graph, rules, family: 'plastic_molded', accessToken: 't' });
    const hole = (l: ProcessLineCost) => l.catalogOperations?.find((o) => o.featureType === 'SimpleHole');
    // injection: side core or lifter, undecided; RIM and structural foam have no lifter: a side core, resolved
    expect(hole(lines[0])).toMatchObject({ status: 'undecided', operations: ['HoleLifter', 'HoleSideCore'] });
    expect(hole(lines[1])).toMatchObject({ status: 'resolved', operations: ['HoleSideCore'] });
    expect(hole(lines[2])).toMatchObject({ status: 'resolved', operations: ['HoleSideCore'] });
    // compression has no core of any kind: the obscured hole cannot be made, and it says so
    expect(hole(lines[3])).toMatchObject({ status: 'infeasible', operations: [] });
    for (const l of lines) expect(l.catalogOperations?.find((o) => o.featureType === 'PlanarFace')).toMatchObject({ status: 'resolved', operations: ['As Molded'] });
  });

  it('insert molding: the press line lists its own catalog\'s operations on the part\'s features, and is the route\'s recognition', async () => {
    const press = line('assembly_molding_insert_injection_molding');
    const { featureRecognition } = await service().attach({ lines: [press], graph, rules, family: 'plastic_molded', accessToken: 't' });
    expect(press.catalogOperations?.find((o) => o.featureType === 'PlanarFace')).toMatchObject({ status: 'resolved', operations: ['As Molded'] });
    expect(featureRecognition?.process).toBe('Insert Injection Molding');
  });

  it('keeps the operations an engine already named on its line: insert loading\'s Manual Load of each insert is not re-read from the CAD', async () => {
    const loader = { ...line('assembly_molding_insert_pick_and_place'), catalogOperations: [{ operations: ['Manual Load'], featureType: 'AssemblyComponentGcd', variant: 'M4 insert', diameterMm: null, count: 2, featureIds: [], status: 'resolved', children: [] }] } as unknown as ProcessLineCost;
    await service().attach({ lines: [line('assembly_molding_insert_injection_molding'), loader], graph, rules, family: 'plastic_molded', accessToken: 't' });
    expect(loader.catalogOperations).toEqual([expect.objectContaining({ operations: ['Manual Load'], featureType: 'AssemblyComponentGcd', count: 2 })]);
  });

  it('names what is not assessed yet, and attaches nothing without the graph', async () => {
    const lines = [line('injection_molding')];
    const { warnings } = await service().attach({ lines, graph, rules, family: 'plastic_molded', accessToken: 't' });
    expect(warnings.join(' ')).toContain('Void, PartingLine');
    const l2 = [line('injection_molding')];
    expect(await service().attach({ lines: l2, graph: null, rules, family: 'plastic_molded', accessToken: 't' })).toEqual({ warnings: [], featureRecognition: null });
    expect(l2[0].catalogOperations).toBeUndefined();
  });

  it('returns each route\'s own recognition: compression reports what it cannot make, injection does not', async () => {
    const withSlide: PlasticFeatureGraph = { ...graph, items: [...graph.items, { id: 'sb', feature_type: 'SlideBundle', variant: null, attributes: { count: 1 }, occurrences: [{ face_ids: [3] }] }] };
    const svc = service();
    const inj = await svc.attach({ lines: [line('injection_molding')], graph: withSlide, rules, family: 'plastic_molded', accessToken: 't' });
    const cm = await svc.attach({ lines: [line('compression_molding')], graph: withSlide, rules, family: 'plastic_molded', accessToken: 't' });
    expect(inj.featureRecognition).toMatchObject({ process: 'Injection Molding' });
    // injection has side cores and a slide: nothing is incompatible (the hole's core is undecided, not impossible)
    expect(inj.featureRecognition?.incompatibilities).toEqual([]);
    expect(cm.featureRecognition).toMatchObject({ process: 'Compression Molding' });
    expect(cm.featureRecognition?.incompatibilities.map((i) => `${i.featureType}:${i.kind}`).sort()).toEqual(['SimpleHole:no_operation_can_make', 'SlideBundle:not_in_process_vocabulary']);
  });
});
