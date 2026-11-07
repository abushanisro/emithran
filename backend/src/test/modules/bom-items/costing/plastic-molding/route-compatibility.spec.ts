import { routeCompatibility, noCompatibleProcess, NO_COMPATIBLE_PROCESS_MESSAGE } from '../../../../../modules/bom-items/costing/plastic-molding/operation/route-compatibility';
import { resolveRouteFeatureRecognition } from '../../../../../modules/bom-items/costing/plastic-molding/operation/route-feature-recognition';
import { resolvePlasticCatalogOperations, type PlasticFeature } from '../../../../../modules/bom-items/costing/plastic-molding/operation/plastic-catalog-operation-resolver';
import { assignMoldingRouteBadges } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-route-comparison.service';
import { selectRecommendedRoute } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import type { RouteResultDto } from '../../../../../modules/bom-items/dto/route-comparison.dto';
import { realOperationCatalog } from './real-plastic-reference';

const RULES = { maxNoCoreInsertDiameterMm: 3, slideEpsilonDeg: 30, lifterEpsilonDeg: 10, autoManualFlashTrimming: true };
const feature = (feature_type: string, extra: Partial<PlasticFeature> = {}): PlasticFeature =>
  ({ id: `${feature_type}-1`, feature_type, variant: null, occurrences: [{ face_ids: [1] }], ...extra });

/** The whole chain on the real reference: the part's features -> the process's recognition -> the verdict. */
function verdict(process: string, features: PlasticFeature[], notYetRecognized: string[] = []) {
  const catalogRaw = realOperationCatalog()[process]!;
  const operations = resolvePlasticCatalogOperations({ catalogRaw, features, rules: RULES });
  return routeCompatibility(resolveRouteFeatureRecognition({ catalogRaw, features, notYetRecognized, operations }));
}

const SLIDE = feature('SlideBundle', { attributes: { count: 1 } });
const FACE = feature('PlanarFace', { attributes: { faces: 6 } });

describe('route compatibility', () => {
  describe('a confirmed incompatibility makes the route incompatible', () => {
    it('compression cannot make a slide: incompatible, naming the exact feature and why', () => {
      const v = verdict('Compression Molding', [FACE, SLIDE])!;
      expect(v.status).toBe('incompatible');
      expect(v.incompatibilities).toHaveLength(1);
      expect(v.incompatibilities[0]).toMatchObject({ featureType: 'SlideBundle', kind: 'not_in_process_vocabulary', count: 1 });
      expect(v.incompatibilities[0]!.reason).toContain('Compression Molding');
    });

    it('a hole across the pull on a process with no core operation is incompatible too', () => {
      const v = verdict('Compression Molding', [feature('SimpleHole', { diameter_mm: 6, attributes: { angle_to_pull_deg: 90 } })])!;
      expect(v.status).toBe('incompatible');
      expect(v.incompatibilities[0]).toMatchObject({ featureType: 'SimpleHole', kind: 'no_operation_can_make' });
    });

    it('the same part is compatible with the processes that have the tooling', () => {
      for (const process of ['Injection Molding', 'Reaction Injection Molding', 'Structural Foam Molding']) {
        expect(verdict(process, [FACE, SLIDE])?.status).toBe('compatible');
      }
    });
  });

  describe('a feature the CAD cannot assess yet is a warning, never an exclusion', () => {
    it('names the unassessed types of this process and stays compatible', () => {
      const v = verdict('Injection Molding', [FACE], ['SharpEdge'])!;
      expect(v.status).toBe('compatible');
      expect(v.incompatibilities).toEqual([]);
      expect(v.notAssessed).toEqual(['SharpEdge']);
      expect(v.warnings).toHaveLength(1);
      expect(v.warnings[0]).toContain('SharpEdge');
      expect(v.warnings[0]).toContain('not excluded or confirmed');
    });

    it('is both: a confirmed incompatibility is still decisive when another type is unassessed', () => {
      const v = verdict('Compression Molding', [SLIDE], ['SharpEdge'])!;
      expect(v.status).toBe('incompatible');
      expect(v.notAssessed).toEqual(['SharpEdge']);
    });

    it('a type outside the process vocabulary is not the process\'s to warn about', () => {
      // PartingLine is not in injection's vocabulary: no warning for it there
      expect(verdict('Injection Molding', [FACE], ['PartingLine'])?.warnings).toEqual([]);
    });
  });

  it('no recognition (no feature graph) is no verdict: nothing is held against the route', () => {
    expect(routeCompatibility(null)).toBeNull();
    expect(routeCompatibility(undefined)).toBeNull();
  });

  describe('noCompatibleProcess', () => {
    const inc = { compatibility: { status: 'incompatible' as const } };
    const ok = { compatibility: { status: 'compatible' as const } };
    it('is true only when there are routes and every one is incompatible', () => {
      expect(noCompatibleProcess([inc, inc])).toBe(true);
      expect(noCompatibleProcess([inc, ok])).toBe(false);
      expect(noCompatibleProcess([ok])).toBe(false);
      expect(noCompatibleProcess([])).toBe(false);
    });
    it('a route with no verdict is not incompatible, so it keeps the set from being "all incompatible"', () => {
      expect(noCompatibleProcess([inc, {}, { compatibility: null }])).toBe(false);
    });
    it('the message is the one the product states', () => {
      expect(NO_COMPATIBLE_PROCESS_MESSAGE).toBe('No compatible manufacturing process found.');
    });
  });
});

// ── the recommendation: reads the verdict, never computes it ─────────────────────────────────
function route(routeId: string, totalCost: number, compat?: 'compatible' | 'incompatible' | null, over: Partial<RouteResultDto> = {}): RouteResultDto {
  return {
    routeId, routeLabel: routeId, processFamily: 'cutting', toolingVolumeNote: null, autoRoutable: true, processLines: [], materialCost: 0, abrasiveCost: 0,
    totalProcessCost: totalCost, totalCost, isFeasible: true, dataComplete: true, dataGaps: [],
    cycleTimes: { cuttingMin: 1, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 1 },
    badges: { lowestCost: false, fastest: false, bestQuality: false },
    capability: { cuttingCapable: true, pressBrakeCapable: true, overallCapable: true, confidence: 'high', estimatedTonnage: null, reasonCodes: [], warnings: [] },
    warnings: [], ratesSource: 'x',
    ...(compat === undefined ? {} : { compatibility: compat === null ? null : { status: compat, incompatibilities: [], notAssessed: [], warnings: [] } }),
    ...over,
  } as RouteResultDto;
}

describe('recommendation with compatibility', () => {
  it('an incompatible route is never recommended, even when it is the cheapest', () => {
    const routes = [route('cheap-but-incompatible', 1, 'incompatible'), route('next', 2, 'compatible'), route('dear', 3, 'compatible')];
    expect(selectRecommendedRoute(routes)?.routeId).toBe('next');
  });

  it('compatible routes go through the existing logic unchanged: cheapest wins, ties break on cycle time then id', () => {
    expect(selectRecommendedRoute([route('b', 5, 'compatible'), route('a', 5, 'compatible')])?.routeId).toBe('a');
    expect(selectRecommendedRoute([route('x', 5, 'compatible', { cycleTimes: { cuttingMin: 2, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 2 } }), route('y', 5, 'compatible')])?.routeId).toBe('y');
  });

  it('a route with no verdict is judged exactly as before', () => {
    expect(selectRecommendedRoute([route('a', 2, undefined), route('b', 1, null)])?.routeId).toBe('b');
    expect(selectRecommendedRoute([route('a', 2, undefined), route('b', 1, 'incompatible')])?.routeId).toBe('a');
  });

  it('every route incompatible: nothing is recommended, no fallback', () => {
    expect(selectRecommendedRoute([route('a', 1, 'incompatible'), route('b', 2, 'incompatible')])).toBeNull();
  });

  it('the other gates still apply to compatible routes', () => {
    expect(selectRecommendedRoute([route('data-gap', 1, 'compatible', { dataComplete: false }), route('ok', 2, 'compatible')])?.routeId).toBe('ok');
    expect(selectRecommendedRoute([route('infeasible', 1, 'compatible', { isFeasible: false })])).toBeNull();
  });
});

describe('molding badges follow the same gate', () => {
  it('an incompatible route holds neither Lowest cost nor Fastest', () => {
    const routes = [
      route('incompat', 1, 'incompatible', { cycleTimes: { cuttingMin: 0.5, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0.5 } }),
      route('ok', 2, 'compatible'),
    ];
    assignMoldingRouteBadges(routes);
    expect(routes[0]!.badges).toMatchObject({ lowestCost: false, fastest: false });
    expect(routes[1]!.badges).toMatchObject({ lowestCost: true, fastest: true });
  });

  it('is repeatable: running it again once compatibility is known moves the badges off the excluded route', () => {
    const routes = [route('a', 1, undefined), route('b', 2, 'compatible')];
    assignMoldingRouteBadges(routes);
    expect(routes[0]!.badges.lowestCost).toBe(true);
    routes[0]!.compatibility = { status: 'incompatible', incompatibilities: [], notAssessed: [], warnings: [] };
    assignMoldingRouteBadges(routes);
    expect(routes.map((r) => r.badges.lowestCost)).toEqual([false, true]);
  });

  it('with every route incompatible, no badge is given', () => {
    const routes = [route('a', 1, 'incompatible'), route('b', 2, 'incompatible')];
    assignMoldingRouteBadges(routes);
    expect(routes.every((r) => !r.badges.lowestCost && !r.badges.fastest)).toBe(true);
  });

  it('is unchanged from before for routes with no verdict: cheapest feasible, fastest capable', () => {
    const routes = [route('a', 2, undefined), route('b', 1, undefined, { cycleTimes: { cuttingMin: 3, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 3 } })];
    assignMoldingRouteBadges(routes);
    expect(routes.map((r) => [r.badges.lowestCost, r.badges.fastest])).toEqual([[false, true], [true, false]]);
  });
});

