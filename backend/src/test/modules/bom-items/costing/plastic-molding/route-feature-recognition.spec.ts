import { catalogProcessName, resolveRouteFeatureRecognition } from '../../../../../modules/bom-items/costing/plastic-molding/operation/route-feature-recognition';
import { resolvePlasticCatalogOperations, type PlasticFeature } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operation-resolver';
import { realOperationCatalog } from './real-plastic-reference';

const RULES = { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: true };
const ALL_TYPES = ['PlanarFace', 'CurvedSurface', 'CurvedWall', 'SharpEdge', 'Rib', 'SimpleHole', 'MultiStepHole', 'Void', 'ComboVoid', 'PartingLine', 'SlideBundle', 'LifterBundle'];

const feature = (feature_type: string, extra: Partial<PlasticFeature> = {}): PlasticFeature =>
  ({ id: `${feature_type}-1`, feature_type, variant: null, occurrences: [{ face_ids: [1] }], ...extra });

// A part that has one of every type the CAD engine can recognise, the side holes across the pull included.
const EVERY_FEATURE: PlasticFeature[] = ALL_TYPES.filter((t) => t !== 'SharpEdge').map((t) =>
  feature(t, { attributes: { angle_to_pull_deg: 90, ...(t === 'LifterBundle' ? { count: 2 } : {}) }, ...(t.endsWith('Hole') ? { diameter_mm: 6 } : {}) }));

function recognise(process: string, features: PlasticFeature[], notYetRecognized: string[] = ['SharpEdge']) {
  const catalogRaw = realOperationCatalog()[process]!;
  const operations = resolvePlasticCatalogOperations({ catalogRaw, features, rules: RULES });
  return resolveRouteFeatureRecognition({ catalogRaw, features, notYetRecognized, operations });
}

describe('route feature recognition: each molding process against its own reference vocabulary', () => {
  it('reads the process name from a catalog compound string', () => {
    expect(catalogProcessName('Compression Molding:As Molded//CurvedSurface')).toBe('Compression Molding');
    expect(catalogProcessName('As Molded//CurvedSurface')).toBeNull();
  });

  it('the vocabulary of each process is exactly the feature types the reference lists for it', () => {
    const catalog = realOperationCatalog();
    for (const process of ['Injection Molding', 'Reaction Injection Molding', 'Structural Foam Molding', 'Compression Molding']) {
      const fromCsv = [...new Set(catalog[process]!.map((raw) => raw.split('//').pop()!))].sort();
      expect(recognise(process, [])?.vocabulary).toEqual(fromCsv);
    }
    // the reference differs by process: compression has no slides, lifters or combo voids; injection has no parting-line operation
    expect(recognise('Compression Molding', [])?.vocabulary).not.toEqual(expect.arrayContaining(['SlideBundle']));
    expect(recognise('Injection Molding', [])?.vocabulary).not.toContain('PartingLine');
  });

  it('compression cannot make slides, lifters or combo voids: each is a process incompatibility', () => {
    const r = recognise('Compression Molding', EVERY_FEATURE)!;
    const kinds = r.incompatibilities.map((i) => `${i.featureType}:${i.kind}`);
    expect(kinds).toEqual(expect.arrayContaining(['ComboVoid:not_in_process_vocabulary', 'LifterBundle:not_in_process_vocabulary', 'SlideBundle:not_in_process_vocabulary']));
    // and the holes and voids across the pull, which compression has no core for (the catalog lists only As Molded)
    expect(kinds).toEqual(expect.arrayContaining(['SimpleHole:no_operation_can_make', 'Void:no_operation_can_make']));
    expect(r.incompatibilities.find((i) => i.featureType === 'SlideBundle')?.reason).toContain('Compression Molding');
    // the parting line is listed by compression (manual flash trimming): recognised, not flagged
    expect(r.recognised.map((x) => x.featureType)).toContain('PartingLine');
    expect(r.incompatibilities.map((i) => i.featureType)).not.toContain('PartingLine');
  });

  it('injection, reaction injection and structural foam list every tooling type: nothing is flagged for being absent from the vocabulary', () => {
    for (const process of ['Injection Molding', 'Reaction Injection Molding', 'Structural Foam Molding']) {
      const r = recognise(process, EVERY_FEATURE)!;
      expect(r.incompatibilities.filter((i) => i.kind === 'not_in_process_vocabulary')).toEqual([]);
      expect(r.recognised.map((x) => x.featureType)).toEqual(expect.arrayContaining(['SlideBundle', 'LifterBundle', 'ComboVoid']));
    }
  });

  it('a type the process lists no operation for, and that is no tooling (the parting line under injection), is not an incompatibility', () => {
    const r = recognise('Injection Molding', [feature('PartingLine')])!;
    expect(r.incompatibilities).toEqual([]);
    expect(r.recognised).toEqual([]);
  });

  it('counts a face group by its faces and a bundle by its members', () => {
    const r = recognise('Injection Molding', [feature('PlanarFace', { attributes: { faces: 12 } }), feature('LifterBundle', { attributes: { count: 3 } })])!;
    expect(r.recognised).toEqual([{ featureType: 'LifterBundle', count: 3 }, { featureType: 'PlanarFace', count: 12 }]);
  });

  it('names the types of this process the CAD cannot assess yet, and only those', () => {
    // SharpEdge is in every molding vocabulary; PartingLine only in compression's
    expect(recognise('Injection Molding', [], ['SharpEdge', 'PartingLine'])?.notAssessed).toEqual(['SharpEdge']);
    expect(recognise('Compression Molding', [], ['SharpEdge', 'PartingLine'])?.notAssessed).toEqual(['PartingLine', 'SharpEdge']);
  });

  it('returns nothing for a catalog that is not a molding process', () => {
    expect(resolveRouteFeatureRecognition({ catalogRaw: ['Inspection:As Molded//PlanarFace'], features: [], notYetRecognized: [], operations: [] })).toBeNull();
  });

  it('changes no operation: the resolver output is the same with or without it', () => {
    const catalogRaw = realOperationCatalog()['Compression Molding']!;
    const before = JSON.stringify(resolvePlasticCatalogOperations({ catalogRaw, features: EVERY_FEATURE, rules: RULES }));
    recognise('Compression Molding', EVERY_FEATURE);
    expect(JSON.stringify(resolvePlasticCatalogOperations({ catalogRaw, features: EVERY_FEATURE, rules: RULES }))).toBe(before);
  });
});

describe('route feature recognition: multi-shot molding, whose features sit in each mold stage', () => {
  // memory/Assembly plastic molding/Processes/operations.csv: "Multi-Shot Molding:Multi-Shot Mold:Multi-Shot//Stage:Lifters//LifterBundle" and so on.
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const rows = readFileSync(join(__dirname, '../../../../../../../memory/Assembly plastic molding/Processes/operations.csv'), 'utf8')
    .split(/\r?\n/).slice(1).map((l) => l.replace(/^"|"$/g, '').trim()).filter((l) => l.startsWith('Multi-Shot Molding'));

  it('reads the stage\'s features as the process\'s vocabulary: lifters and slides are not an incompatibility (Back cover 270924: 4 lifter bundles)', () => {
    const features = [feature('LifterBundle'), feature('SlideBundle'), feature('Rib'), feature('SimpleHole')];
    const r = resolveRouteFeatureRecognition({ catalogRaw: rows, features, notYetRecognized: [], operations: [] })!;
    expect(r.process).toBe('Multi-Shot Molding');
    expect(r.vocabulary).toEqual(expect.arrayContaining(['LifterBundle', 'SlideBundle', 'Rib', 'CurvedWall', 'PlanarFace', 'SimpleHole']));
    expect(r.incompatibilities).toEqual([]);
  });

  it('a side void is formed by the lifter bundle that holds it, or by one of the stage\'s lifters or slides: never "no operation can make it"', () => {
    // Back cover 270924: void-3 is the member of lifter bundle-3 (90 deg from the pull); void-1 (57.6 deg) is in no bundle.
    const lifter = feature('LifterBundle', { id: 'bundle-3', attributes: { member_ids: ['void-3'], size_class: 'small' } });
    const held = feature('Void', { id: 'void-3', variant: 'side', attributes: { angle_to_pull_deg: 90 } });
    const loose = feature('Void', { id: 'void-1', variant: 'side', attributes: { angle_to_pull_deg: 57.6 } });
    const ops = resolvePlasticCatalogOperations({ catalogRaw: rows, features: [lifter, held, loose], rules: RULES });
    const of = (id: string) => ops.find((o) => o.featureIds.includes(id))!;
    expect(of('void-3')).toMatchObject({ status: 'resolved', reason: expect.stringContaining('formed by its LifterBundle (bundle-3)') });
    expect(of('void-1')).toMatchObject({ status: 'undecided', reason: expect.stringContaining('stage\'s lifters or slides') });
    const r = resolveRouteFeatureRecognition({ catalogRaw: rows, features: [lifter, held, loose], notYetRecognized: [], operations: ops })!;
    expect(r.incompatibilities).toEqual([]);
  });

  it('a plain injection row has no stage: its vocabulary is read as before', () => {
    expect(recognise('Injection Molding', EVERY_FEATURE)!.incompatibilities).toEqual([]);
  });
});
