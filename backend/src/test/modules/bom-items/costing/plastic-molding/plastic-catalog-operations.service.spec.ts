import { PlasticCatalogOperationsService, type PlasticFeatureGraph } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operations.service';
import type { ProcessLineCost } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';

// The staged catalog rows of each molding process (process_taxonomy_operations): compression has no core or lifter operation for a hole.
const CATALOG: Record<string, string[]> = {
  inj: ['Injection Molding:As Molded//SimpleHole', 'Injection Molding:HoleSideCore//SimpleHole', 'Injection Molding:HoleLifter//SimpleHole', 'Injection Molding:HoleNoCore//SimpleHole', 'Injection Molding:As Molded//PlanarFace'],
  rim: ['Reaction Injection Molding:As Molded//SimpleHole', 'Reaction Injection Molding:HoleSideCore//SimpleHole', 'Reaction Injection Molding:HoleNoCore//SimpleHole', 'Reaction Injection Molding:As Molded//PlanarFace'],
  sfm: ['Structural Foam Molding:As Molded//SimpleHole', 'Structural Foam Molding:HoleSideCore//SimpleHole', 'Structural Foam Molding:HoleNoCore//SimpleHole', 'Structural Foam Molding:As Molded//PlanarFace'],
  cm: ['Compression Molding:As Molded//SimpleHole', 'Compression Molding:As Molded//PlanarFace'],
};
const CLASS_TO_CANONICAL: Record<string, string> = {
  injection_molding: 'inj', reaction_injection_molding: 'rim', structural_foam_molding: 'sfm', compression_molding: 'cm',
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
  const rules = { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10 };

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

  it('names what is not assessed yet, and attaches nothing without the graph', async () => {
    const lines = [line('injection_molding')];
    const warnings = await service().attach({ lines, graph, rules, family: 'plastic_molded', accessToken: 't' });
    expect(warnings.join(' ')).toContain('Void, PartingLine');
    const l2 = [line('injection_molding')];
    expect(await service().attach({ lines: l2, graph: null, rules, family: 'plastic_molded', accessToken: 't' })).toEqual([]);
    expect(l2[0].catalogOperations).toBeUndefined();
  });
});
