/**
 * capability-rules.ts resolves the finishing-process thresholds from the
 * staged reference rows. Checked against the real memory/Machining files
 * (variables.csv, lookup/tblGtolProcessCapabilities.csv): the same rows
 * migrations 639 and 747 stage.
 */
import { resolveMachiningCapabilityRules } from '../../../../../modules/bom-items/costing/machining/capability-rules';
import { realCapabilityRules } from './real-reference-tables';

describe('resolveMachiningCapabilityRules', () => {
  it('reads every threshold from the real reference files', () => {
    expect(realCapabilityRules()).toEqual({
      finishGrindingDepthMm: 0.1,        // variables finishGrindingDepth
      jigBorePositionToleranceMm: 0.0254, // variables jigBoreMaxPosTol (tblGtol rounds it to 0.026)
      grindingRaTriggerUm: 0.4,           // tblGtol Turning / Milling Fine roughness Best Achievable
      jigBoringRepetitions: 3,            // tblGtol Jig Boring positionTolerance
      jigGrindRepetitions: 4,             // tblGtol Jig Grind positionTolerance (its roughness row says 1.5)
    });
  });

  it('returns no rule and names each absent value', () => {
    const { rules, missing } = resolveMachiningCapabilityRules([{ key: 'finishGrindingDepth', value: '0.1' }], []);
    expect(rules).toBeNull();
    expect(missing).toEqual([
      'variables: jigBoreMaxPosTol',
      'tblGtolProcessCapabilities: Turning roughness Best Achievable',
      'tblGtolProcessCapabilities: Milling Fine roughness Best Achievable',
      'tblGtolProcessCapabilities: Jig Boring positionTolerance Num Repetitions',
      'tblGtolProcessCapabilities: Jig Grind positionTolerance Num Repetitions',
    ]);
  });
});
