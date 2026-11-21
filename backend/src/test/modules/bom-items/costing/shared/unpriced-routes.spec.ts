// A part with no material grade: its quote prices nothing (the summary bom-item-costing returns for it), and every route of every family's
// comparison says so: not feasible, no total, reason code INPUT_MISSING, the reason naming the grade. The Linear Bracket (Roto & Blow Molding,
// 2026-11-21) was applied with "Extrusion blow molding is not feasible for this part: the part could not be costed", and a sand or die-cast
// part with no grade was a feasible route at $0.
import { BomItemCostingService } from '../../../../../modules/bom-items/bom-item-costing.service';
import { ADDITIVE_DOMAINS } from '../../../../../modules/bom-items/costing/additive/additive-domain';
import { additiveRouteFor } from '../../../../../modules/bom-items/costing/additive/additive-route-comparison';
import { ASSEMBLY_ROUTES } from '../../../../../modules/bom-items/costing/assembly/assembly-route';
import { assemblyRouteFor } from '../../../../../modules/bom-items/costing/assembly/assembly-route-comparison';
import { BAR_TUBE_ROUTES } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-route';
import { barTubeRouteFor } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-route-comparison';
import { castingFamilyOption } from '../../../../../modules/bom-items/costing/casting/casting-process-choice';
import { investmentCastingRoute } from '../../../../../modules/bom-items/costing/casting/investment/investment-route-comparison';
import { sandCastingRoute } from '../../../../../modules/bom-items/costing/casting/sand/sand-route-comparison';
import { COMPOSITES_ROUTES } from '../../../../../modules/bom-items/costing/composites/composites-route';
import { compositesRouteFor } from '../../../../../modules/bom-items/costing/composites/composites-route-comparison';
import { FORGING_ROUTES } from '../../../../../modules/bom-items/costing/forging/forging-route';
import { forgingRouteFor } from '../../../../../modules/bom-items/costing/forging/forging-route-comparison';
import { MULTI_SPINDLE_ROUTES } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route';
import { multiSpindleRouteFor } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-route-comparison';
import { PART_ASSEMBLY_ROUTES } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-route';
import { partAssemblyRouteFor } from '../../../../../modules/bom-items/costing/part-assembly/part-assembly-route-comparison';
import { INSERT_MOLDING_ROUTES } from '../../../../../modules/bom-items/costing/plastic-molding/insert/insert-molding';
import { insertMoldingRouteFor } from '../../../../../modules/bom-items/costing/plastic-molding/insert/insert-molding-route-comparison';
import { MULTI_SHOT_ROUTES } from '../../../../../modules/bom-items/costing/plastic-molding/multi-shot/multi-shot';
import { multiShotRouteFor } from '../../../../../modules/bom-items/costing/plastic-molding/multi-shot/multi-shot-route-comparison';
import { powderMetalRoute } from '../../../../../modules/bom-items/costing/powder-metal/powder-metal-route-comparison';
import { ROTO_BLOW_ROUTES } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-route';
import { rotoBlowRouteFor } from '../../../../../modules/bom-items/costing/roto-blow/roto-blow-route-comparison';
import { unpricedReason } from '../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { twoModelRoute } from '../../../../../modules/bom-items/costing/two-model/two-model-route-comparison';

import type { CostSummaryResponseDto } from '../../../../../modules/bom-items/dto/cost-breakdown.dto';
import type { RouteResultDto } from '../../../../../modules/bom-items/dto/route-comparison.dto';

const NO_GRADE = 'the part has no material grade (choose one in Material Grade, then Apply)';

// The summary computeCostSummary returns for a part with no material grade, from the service's own builder.
interface Unpriced { unpricedSummary: (input: { costingInputs: unknown; batchSize: number; family: string; missingInputs: string[]; warnings: string[] }) => CostSummaryResponseDto }
const noGrade = (Object.create(BomItemCostingService.prototype) as Unpriced)
  .unpricedSummary({ costingInputs: {}, batchSize: 1, family: 'unknown', missingInputs: ['materialGrade'], warnings: [] });

const routes: [string, RouteResultDto][] = [
  ...ROTO_BLOW_ROUTES.map((r): [string, RouteResultDto] => [`roto-blow ${r.key}`, rotoBlowRouteFor(r.key, noGrade)]),
  ...FORGING_ROUTES.map((r): [string, RouteResultDto] => [`forging ${r.key}`, forgingRouteFor(r.key, noGrade)]),
  ...BAR_TUBE_ROUTES.map((r): [string, RouteResultDto] => [`bar-tube ${r.key}`, barTubeRouteFor(r.key, noGrade)]),
  ...COMPOSITES_ROUTES.map((r): [string, RouteResultDto] => [`composites ${r.key}`, compositesRouteFor(r.key, noGrade)]),
  ...MULTI_SPINDLE_ROUTES.map((r): [string, RouteResultDto] => [`multi-spindle ${r.key}`, multiSpindleRouteFor(r.key, noGrade)]),
  ...ASSEMBLY_ROUTES.map((r): [string, RouteResultDto] => [`assembly ${r.key}`, assemblyRouteFor(r.key, noGrade)]),
  ...PART_ASSEMBLY_ROUTES.map((r): [string, RouteResultDto] => [`part assembly ${r.key}`, partAssemblyRouteFor(r.key, noGrade)]),
  ...INSERT_MOLDING_ROUTES.map((r): [string, RouteResultDto] => [`insert molding ${r.key}`, insertMoldingRouteFor(r.key, noGrade)]),
  ...MULTI_SHOT_ROUTES.map((r): [string, RouteResultDto] => [`multi-shot ${r.key}`, multiShotRouteFor(r.key, noGrade)]),
  ...ADDITIVE_DOMAINS.flatMap((d) => d.routes.map((r): [string, RouteResultDto] => [`${d.key} ${r.key}`, additiveRouteFor(d, r.key, noGrade)])),
  ['powder metal', powderMetalRoute(noGrade)],
  ['2-model machining', twoModelRoute(noGrade)],
  ['investment casting', investmentCastingRoute(noGrade)],
  ['sand casting', sandCastingRoute(noGrade)],
];

describe('a part with no material grade', () => {
  it('its summary priced nothing, and says it is the grade', () => {
    expect(noGrade).toMatchObject({ scenarioReady: false, missingInputs: ['materialGrade'], totalCost: 0 });
    expect(unpricedReason(noGrade)).toBe(NO_GRADE);
  });

  it.each(routes)('%s: not feasible, no total, and the reason is the missing grade (INPUT_MISSING)', (_name, route) => {
    expect(route.isFeasible).toBe(false);
    expect(route.totalCost).toBeNull();
    expect(route.capability.overallCapable).toBe(false);
    expect(route.capability.reasonCodes).toEqual(['INPUT_MISSING']);
    expect(route.capability.warnings).toEqual([NO_GRADE]);
  });

  it('a Casting part: no casting process is costed, and each says it is the grade', () => {
    expect(castingFamilyOption('sand_cast', noGrade)).toMatchObject({ costed: false, total: null, detail: NO_GRADE });
  });
});

describe('unpricedReason', () => {
  it('is null for a priced summary, whatever its warnings', () => {
    expect(unpricedReason({ warnings: ['Material priced from bar stock.'] })).toBeNull();
    expect(unpricedReason({ scenarioReady: true, warnings: [] })).toBeNull();
  });

  it('another missing input gives the summary\'s own sentence (a part with no measured geometry)', () => {
    const why = 'The part has no measured volume or bounding box: press Apply Scenario (it extracts the CAD features first).';
    expect(unpricedReason({ scenarioReady: false, missingInputs: ['geometry'], warnings: [why] })).toBe(why);
  });
});
