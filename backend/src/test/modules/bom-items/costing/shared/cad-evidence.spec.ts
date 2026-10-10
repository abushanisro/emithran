import { CAD_EVIDENCE_KEYS, cadEvidenceKey } from '../../../../../modules/bom-items/costing/shared/cad-evidence';

describe('cadEvidenceKey', () => {
  it('names the CAD quantity behind a CAD-extracted input', () => {
    expect(cadEvidenceKey('Cutting Length', 'CAD feature extraction — total cut path length')).toBe('cut_length');
    expect(cadEvidenceKey('No Of Starts', 'CAD feature extraction — pierce/start count')).toBe('pierce_count');
    expect(cadEvidenceKey('No Of Bends', 'CAD/drawing bend count')).toBe('bend_count');
  });

  it('gives nothing for a value that did not come from CAD, even under a known field name', () => {
    expect(cadEvidenceKey('Cutting Length', 'Entered in the calculator')).toBeUndefined();
    expect(cadEvidenceKey('Cutting Length', undefined)).toBeUndefined();
    expect(cadEvidenceKey('Cutting Length', 'sm_lookup_laser_cut — 1.5mm sheet')).toBeUndefined();
  });

  it('gives nothing for an input that is not a CAD measurement', () => {
    expect(cadEvidenceKey('Cutting Speed', 'CAD feature extraction')).toBeUndefined();
  });

  it('only ever returns a key the frontend and engine contract knows', () => {
    const fields = ['Cutting Length', 'Length Of Cut', 'Burr Edge Length', 'No Of Starts', 'No Of Bends', 'Bending Line Length', 'Flat Pattern Area'];
    for (const f of fields) {
      expect(CAD_EVIDENCE_KEYS).toContain(cadEvidenceKey(f, 'CAD feature extraction'));
    }
  });
});
