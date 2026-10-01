import { detectDrawingCadMismatches, type DrawingFacts, type CadFacts } from '../../../../../../modules/bom-items/costing/shared/physics/drawing-cad-consistency';

const bothEmpty: DrawingFacts = { bendCount: null, sheetThicknessMm: null, threadCount: null, dimensionsMm: null };
const cadEmpty: CadFacts = { bendCount: null, sheetThicknessMm: null, threadCount: null, dimensionsMm: null };

function find(results: ReturnType<typeof detectDrawingCadMismatches>, fact: string) {
  return results.find((r) => r.fact === fact)!;
}

describe('detectDrawingCadMismatches', () => {
  it('a part whose 2D and 3D agree on everything reports match for every fact', () => {
    const drawing: DrawingFacts = { bendCount: 4, sheetThicknessMm: 2.0, threadCount: 2, dimensionsMm: [150, 96.5, 6] };
    const cad: CadFacts = { bendCount: 4, sheetThicknessMm: 2.0, threadCount: 2, dimensionsMm: [96.5, 150, 6] };
    const results = detectDrawingCadMismatches(drawing, cad);
    expect(results.every((r) => r.status === 'match')).toBe(true);
  });

  // The exact 830-002176-00-style disagreement this feature exists to catch:
  // today resolveSheetGeometryInputs silently takes the drawing's higher
  // count with NO warning when CAD is already nonzero.
  it('flags a real CAD=2 vs drawing=3 bend disagreement as a critical mismatch', () => {
    const r = find(detectDrawingCadMismatches(
      { ...bothEmpty, bendCount: 3 }, { ...cadEmpty, bendCount: 2, bendFeatureIds: ['f1', 'f2'] },
    ), 'bendCount');
    expect(r.status).toBe('mismatch');
    expect(r.severity).toBe('critical');
    expect(r.message).toMatch(/drawing says 3 bends, the 3D model measures 2 bends/);
    expect(r.v2FeatureIds).toEqual(['f1', 'f2']);
  });

  it('a thread-count disagreement is flagged — never silently overridden like resolveThreads does today', () => {
    const r = find(detectDrawingCadMismatches(
      { ...bothEmpty, threadCount: 4 }, { ...cadEmpty, threadCount: 3, threadFeatureIds: ['t1', 't2', 't3'] },
    ), 'threadCount');
    expect(r.status).toBe('mismatch');
    expect(r.severity).toBe('critical');
    expect(r.v2FeatureIds).toEqual(['t1', 't2', 't3']);
  });

  describe('sheet thickness — a rounding/OCR epsilon, never a manufacturing tolerance', () => {
    it('matches at exactly the 0.1mm boundary', () => {
      const r = find(detectDrawingCadMismatches({ ...bothEmpty, sheetThicknessMm: 2.0 }, { ...cadEmpty, sheetThicknessMm: 2.1 }), 'sheetThicknessMm');
      expect(r.status).toBe('match');
    });

    it('mismatches just past the boundary', () => {
      const r = find(detectDrawingCadMismatches({ ...bothEmpty, sheetThicknessMm: 2.0 }, { ...cadEmpty, sheetThicknessMm: 2.11 }), 'sheetThicknessMm');
      expect(r.status).toBe('mismatch');
      expect(r.severity).toBe('warning');
    });
  });

  describe('overall dimensions — sorted-triplet comparison', () => {
    it('matches when the only difference is which axis is called length vs width', () => {
      const r = find(detectDrawingCadMismatches(
        { ...bothEmpty, dimensionsMm: [150, 96.5, 6] }, { ...cadEmpty, dimensionsMm: [96.5, 6, 150] },
      ), 'dimensionsMm');
      expect(r.status).toBe('match');
    });

    it('flags a genuine dimensional disagreement, not just an axis relabel', () => {
      const r = find(detectDrawingCadMismatches(
        { ...bothEmpty, dimensionsMm: [150, 96.5, 6] }, { ...cadEmpty, dimensionsMm: [96.5, 6, 140] },
      ), 'dimensionsMm');
      expect(r.status).toBe('mismatch');
      expect(r.severity).toBe('warning');
    });
  });

  it('reports drawing_only / cad_only rather than fabricating a mismatch when only one source has the fact', () => {
    const onlyDrawing = find(detectDrawingCadMismatches({ ...bothEmpty, bendCount: 2 }, cadEmpty), 'bendCount');
    expect(onlyDrawing.status).toBe('drawing_only');
    const onlyCad = find(detectDrawingCadMismatches(bothEmpty, { ...cadEmpty, bendCount: 2 }), 'bendCount');
    expect(onlyCad.status).toBe('cad_only');
  });

  it('reports match (not a fabricated mismatch) when a fact is absent from both sources', () => {
    const r = find(detectDrawingCadMismatches(bothEmpty, cadEmpty), 'bendCount');
    expect(r.status).toBe('match');
    expect(r.severity).toBe('info');
  });

  it('sheet metal has no CAD thread count (synthesized from the drawing itself, comparing it would be circular) — drawing_only, never a fabricated check', () => {
    const r = find(detectDrawingCadMismatches({ ...bothEmpty, threadCount: 2 }, cadEmpty), 'threadCount');
    expect(r.status).toBe('drawing_only');
  });
});
