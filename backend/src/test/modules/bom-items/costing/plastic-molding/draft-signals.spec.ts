import { undercutCountFromDraftSummary } from '../../../../../modules/bom-items/costing/plastic-molding/draft-signals';
import { buildInjectionMoldingRoute } from '../../../../../modules/bom-items/costing/plastic-molding/process/routing-engine';
import type { InjectionMoldingSignals } from '../../../../../modules/bom-items/costing/plastic-molding/process/routing-engine';

describe('undercutCountFromDraftSummary', () => {
  it('is the count the analysis found, when it ran', () => {
    expect(undercutCountFromDraftSummary({ undercutFaceCount: 3, partingComplexity: 0.4 })).toBe(3);
  });

  it('is 0, not "not run", when the analysis ran and found no undercut (Back cover 270924: undrafted faces and parting complexity 0.5 shown)', () => {
    expect(undercutCountFromDraftSummary({ undercutFaceCount: 0, partingComplexity: 0.5 })).toBe(0);
  });

  it('is null when the analysis did not run: its fallback has zero counts and no parting complexity', () => {
    expect(undercutCountFromDraftSummary({ undercutFaceCount: 0, partingComplexity: null })).toBeNull();
    expect(undercutCountFromDraftSummary({})).toBeNull();
    expect(undercutCountFromDraftSummary(null)).toBeNull();
    expect(undercutCountFromDraftSummary({ undercutFaceCount: 2, partingComplexity: undefined })).toBeNull();
  });

  it('does not read a non-number as a count', () => {
    expect(undercutCountFromDraftSummary({ undercutFaceCount: 'x', partingComplexity: 0.5 })).toBe(0);
  });
});

describe('the molding route, given what the draft analysis found', () => {
  const signals = (undercutCount: number | null): InjectionMoldingSignals => ({
    materialGrade: 'Generic ABS', projectedAreaMm2: 8000, partVolumeMm3: 18_800, partMassKg: 0.02, wallThicknessNominalMm: 1.5, wallThicknessMinMm: 0.35,
    wallThicknessMaxMm: 6, ribCount: null, bossCount: null, undercutCount, insertCount: null, textFeatureCount: null, assemblyFeatureCount: null,
    gateType: 'edge', partingComplexity: 0.5, unscrewingCoreCount: null, overmoldSubstrate: null,
  });
  const NOT_RUN = 'Undercut detection not run';

  it('does not warn that detection did not run for a part analysed with no undercuts, and routes no side action', () => {
    const tree = buildInjectionMoldingRoute(signals(undercutCountFromDraftSummary({ undercutFaceCount: 0, partingComplexity: 0.5 })));
    expect(tree.routingWarnings.join('\n')).not.toContain(NOT_RUN);
    expect(tree.operations.map((o) => o.id)).not.toContain('side_action');
  });

  it('still warns when the analysis did not run', () => {
    const tree = buildInjectionMoldingRoute(signals(undercutCountFromDraftSummary({ undercutFaceCount: 0, partingComplexity: null })));
    expect(tree.routingWarnings.join('\n')).toContain(NOT_RUN);
  });

  it('routes a side action for the undercuts it found', () => {
    const tree = buildInjectionMoldingRoute(signals(undercutCountFromDraftSummary({ undercutFaceCount: 2, partingComplexity: 0.5 })));
    expect(tree.operations.map((o) => o.id)).toContain('side_action');
  });
});
