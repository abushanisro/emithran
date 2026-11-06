import { parseProcessCompatibility, processCompatibilityGap } from './process-compatibility';

const abs = parseProcessCompatibility([
  { property_key: 'process_compatibility_can_im_sfm', value_text: 'True' },
  { property_key: 'process_compatibility_can_rim', value_text: 'False' },
  { property_key: 'process_compatibility_can_cm', value_text: 'False' },
  { property_key: 'process_compatibility_material_form', value_text: 'PELLET' },
]);

describe('process compatibility', () => {
  it('reads the three flags and ignores other properties', () => {
    expect(abs).toEqual({ injection_or_foam: true, reaction_injection: false, compression: false });
  });

  it('offers only the process the material is flagged for', () => {
    expect(processCompatibilityGap(abs, 'injection_or_foam', 'ABS')).toBeNull();
    expect(processCompatibilityGap(abs, 'compression', 'ABS')).toMatch(/not a compression molding material/);
    expect(processCompatibilityGap(abs, 'reaction_injection', 'ABS')).toMatch(/not a reaction injection molding material/);
  });

  it('does not assume a material with no flags is compatible', () => {
    const none = parseProcessCompatibility([]);
    expect(none).toEqual({ injection_or_foam: null, reaction_injection: null, compression: null });
    expect(processCompatibilityGap(none, 'compression', 'Legacy grade')).toMatch(/No process-compatibility data is on file/);
  });
});
