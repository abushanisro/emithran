import type { ManufacturingProcessEngine } from './manufacturing-process.types';
import { LaserCuttingEngine, Co2LaserCuttingEngine, LaserCutEngine, ThreeDLaserCuttingEngine } from '../../sheet-metal/process/laser-cutting-engine';
import { TurretPunchEngine } from '../../sheet-metal/process/turret-punch-engine';
import { WaterjetEngine } from '../../sheet-metal/process/waterjet-engine';
import { OxyfuelCuttingEngine } from '../../sheet-metal/process/oxyfuel-cutting-engine';
import { ShearingEngine } from '../../sheet-metal/process/shearing-engine';
import { LaserPunchEngine } from '../../sheet-metal/process/laser-punch-engine';
import { PlasmaCuttingEngine } from '../../sheet-metal/process/plasma-cutting-engine';
import { PlasmaPunchEngine } from '../../sheet-metal/process/plasma-punch-engine';
import { RouterEngine } from '../../sheet-metal/process/router-engine';
import { PressStrokeEngine } from '../../sheet-metal/process/press-stroke-engine';
import { RollBendingEngine } from '../../sheet-metal/process/roll-bending-engine';
import { PressBrakeEngine } from '../../sheet-metal/process/press-brake-engine';
import { DeburringEngine } from '../../sheet-metal/operation/deburring-engine';
import { TappingEngine } from '../../sheet-metal/operation/tapping-engine';
import { HoleExtrusionEngine } from '../../sheet-metal/operation/hole-extrusion-engine';
import { CounterboringEngine } from '../../sheet-metal/operation/counterboring-engine';
import { CountersinkingEngine } from '../../sheet-metal/operation/countersinking-engine';
import { ReamingEngine } from '../../sheet-metal/operation/reaming-engine';
import { PemInsertionEngine } from '../../sheet-metal/operation/pem-insertion-engine';
import { CncMillingEngine } from '../../machining/process/cnc-milling-registry-engine';
import { CncTurningEngine } from '../../machining/process/cnc-turning-registry-engine';
import { InjectionMoldingEngine } from '../../injection-molding/process/injection-molding-registry-engine';
import { InspectionRegistryEngine } from '../process/inspection-registry-engine';
import { SurfaceTreatmentEngine } from '../process/surface-treatment-registry-engine';

// The single, explicit, engineering-owned list of manufacturing processes this
// app has a real, implemented, verified cost engine for — sheet-metal cutting
// today, other process families (milling, turning, casting, ...) once real
// engines exist for them. Registering an engine here is a deliberate
// engineering act: "I implemented and verified a real capability+cost engine
// for this machine class." It is NEVER inferred from a process_calculator_
// mappings catalog row existing — the real catalog has several sheet-metal
// cutting operations (Plasma Cutting, 3D Laser Cut, Turret Press-as-cutting,
// Nibbling) with an assigned machine_class but no real formula behind them at
// all (their seed calculator names were never real calculators — the same
// phantom-calculator bug already fixed once for waterjet). Exposing those as
// selectable routes without a registered engine would mean fabricating a
// cost, exactly what this registry exists to prevent. See
// getRouteComparison() for how catalog ∩ registry ∩ capability determines
// what's actually offered.
// 'sheet_metal_secondary_ops' (Platform Architecture Remediation Phase 1):
// these 8 engines are gated on real feature counts (bendCount, cutLengthMm,
// threadCount, ...), never picked as "alternative routes" the way the
// cutting/forming families above are — a consumer resolves which ones apply
// directly (as bom-items.service.ts's orchestration already does), not via
// getEnginesForFamily(...).find(machineClass). Three of them
// (Counterboring/Countersinking/Reaming) deliberately share the real
// 'drill_press' machineClass — the same physical machine performs all three
// distinct operations — so machineClass alone does NOT uniquely identify an
// engine within this family; key on `process`/the engine class itself.
// CNC/Injection-Molding/Inspection/Surface-Treatment (Platform Architecture
// Remediation Phase 1, "fix the pattern across all three domains" — sheet
// metal, CNC/Machining, Injection Molding): thin conformance wrappers around
// the existing real, tested cost functions (computeCNCMilledCostSummary,
// computeInjectionMoldedCostSummary, finalizeInspectionLine,
// computeSurfaceTreatmentLine) — no formula rewrites, see each wrapper
// file's own doc comment. CNC/IM use TResult = CostSummaryDto (they already
// compute a whole quote, not one line) and their own TGeometry/
// TCapabilityResult (their real capability checks are structurally
// incompatible with the sheet-metal-shaped PartGeometryForCapability/
// CapabilityCheck) — this is why ManufacturingProcessEngine is generic over
// all four type params, not just context/result.
export const MANUFACTURING_PROCESS_REGISTRY: ManufacturingProcessEngine<any, any, any, any>[] = [
  new LaserCuttingEngine(),
  new Co2LaserCuttingEngine(),
  new LaserCutEngine(),
  new ThreeDLaserCuttingEngine(),
  new TurretPunchEngine(),
  new WaterjetEngine(),
  new OxyfuelCuttingEngine(),
  new ShearingEngine(),
  new LaserPunchEngine(),
  new PlasmaCuttingEngine(),
  new PlasmaPunchEngine(),
  new RouterEngine(),
  new PressStrokeEngine('standard_press', 'Standard Press'),
  new PressStrokeEngine('tandem_press', 'Tandem Press'),
  new PressStrokeEngine('progressive_die_press', 'Progressive Die'),
  new RollBendingEngine('roll_bending_2', '2 Roll Bending'),
  new RollBendingEngine('roll_bending_3', '3 Roll Bending'),
  new RollBendingEngine('roll_bending_4', '4 Roll Bending'),
  new PressBrakeEngine(),
  new DeburringEngine(),
  new TappingEngine(),
  new HoleExtrusionEngine(),
  new CounterboringEngine(),
  new CountersinkingEngine(),
  new ReamingEngine(),
  new PemInsertionEngine(),
  new CncMillingEngine('cnc_3ax_vmc'),
  new CncMillingEngine('cnc_4ax_vmc'),
  new CncMillingEngine('cnc_5ax_mc'),
  new CncTurningEngine('cnc_lathe'),
  new CncTurningEngine('cnc_lathe_live'),
  new CncTurningEngine('cnc_mill_turn'),
  new InjectionMoldingEngine(),
  new InspectionRegistryEngine(),
  new SurfaceTreatmentEngine(),
];

export function getEnginesForFamily(processFamily: string): ManufacturingProcessEngine<any, any, any, any>[] {
  return MANUFACTURING_PROCESS_REGISTRY.filter((e) => e.processFamily === processFamily);
}

// Route id/label are a cosmetic UX lookup, not a candidacy gate — a machine
// class registered above but missing here still gets offered (falls back to
// the raw machine class as both id and label) rather than silently dropped.
// Single source of truth for both getRouteComparison's route assembly and
// apply-route.dto.ts's request validation, so the two never drift.
export const ROUTE_ID_FOR_CLASS: Record<string, string> = {
  fiber_laser: 'sm-laser',
  co2_laser: 'sm-co2-laser',
  laser_cut: 'sm-laser-cut',
  laser_3d: 'sm-laser-3d',
  turret_punch: 'sm-turret',
  waterjet: 'sm-waterjet',
  router_2axis: 'sm-router',
  oxyfuel_cut: 'sm-oxyfuel',
  shear: 'sm-shear',
  laser_punch: 'sm-laser-punch',
  plasma_cut: 'sm-plasma',
  plasma_punch: 'sm-plasma-punch',
  standard_press: 'sm-standard-press',
  tandem_press: 'sm-tandem-press',
  progressive_die_press: 'sm-progressive-die',
  roll_bending_2: 'sm-roll-bending-2',
  roll_bending_3: 'sm-roll-bending-3',
  roll_bending_4: 'sm-roll-bending-4',
};
export const ROUTE_LABEL_FOR_CLASS: Record<string, string> = {
  fiber_laser: 'Fiber Laser + Press Brake',
  co2_laser: 'CO2 Laser + Press Brake',
  laser_cut: 'Laser Cut + Press Brake',
  laser_3d: '3D Laser + Press Brake',
  turret_punch: 'Turret Punch + Press Brake',
  waterjet: 'Waterjet + Press Brake',
  router_2axis: '2-Axis Router + Press Brake',
  oxyfuel_cut: 'OxyFuel Cut + Press Brake',
  shear: 'Shearing + Press Brake',
  laser_punch: 'Laser Punch + Press Brake',
  plasma_cut: 'Plasma Cut + Press Brake',
  plasma_punch: 'Plasma Punch + Press Brake',
  standard_press: 'Standard Press',
  tandem_press: 'Tandem Press',
  // Real operation names from the catalog (process_calculator_mappings /
  // Process > Process Calculator Mappings admin page's "Sheet Metal" group)
  // — "Progressive die"/"2 Roll Bending"/"3 Roll Bending"/"4 Roll Bending",
  // not invented display strings. Missing here before this fix, so these 4
  // real classes fell back to their raw machine_class string as the label
  // (e.g. "progressive_die_press", "roll_bending_2") in the Workflow
  // Builder route picker.
  progressive_die_press: 'Progressive die',
  roll_bending_2: '2 Roll Bending',
  roll_bending_3: '3 Roll Bending',
  roll_bending_4: '4 Roll Bending',
};

export function getCuttingRouteIds(): string[] {
  return getEnginesForFamily('sheet_metal_cutting').map((e) => ROUTE_ID_FOR_CLASS[e.machineClass] ?? e.machineClass);
}

export function getFormingRouteIds(): string[] {
  return getEnginesForFamily('sheet_metal_forming').map((e) => ROUTE_ID_FOR_CLASS[e.machineClass] ?? e.machineClass);
}


/**
 * The process label each registered engine puts on its own line, keyed by
 * machine class — derived from the engines, never maintained as a list.
 *
 * Replaces a hardcoded four-entry map in cost-engine.ts that named only
 * fiber_laser / co2_laser / turret_punch / waterjet, so every other applied
 * route had no name available and fell back to whatever catalog field happened
 * to be on the persisted row (for the press family, the route GROUP
 * "Bending/Floating /Forming" rather than a process name).
 */
export function getProcessLabelForClass(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const engine of MANUFACTURING_PROCESS_REGISTRY) {
    if (engine.processLabel) map[engine.machineClass] = engine.processLabel;
  }
  return map;
}

/**
 * Every machine class that can be the CORE process of an applied sheet-metal
 * route: each registered cutting or forming engine, plus press_brake.
 *
 * Derived from the registry, in one place, because it is read twice on the
 * same code path and the two reads must not be allowed to disagree.
 * getCostSummary() loads the applied route with
 * `.in('machine_class', ...)` and then hands the SAME concept to
 * applyPersistedRouteToSummary() as its coreProcessClasses argument. Those
 * were two independent lists — a 17-entry string literal for the query and a
 * getEnginesForFamily() derivation for the overlay. They happened to agree
 * exactly, which is what made it dangerous rather than obviously broken:
 * registering a new cutting engine grows the derivation and not the literal,
 * so the applied row is filtered out of the query, `appliedRows` comes back
 * empty, the overlay never runs, and the Cost Guide silently shows the live
 * pre-apply preview instead — which for cutting only ever composes a Laser
 * Cutting line. A user who applied that new route would see a laser quote.
 *
 * press_brake is a member because it is independently overridable through the
 * Edit Process Cost dialog, so a persisted press-brake row must load and
 * overlay even when the route's core cutting row is unchanged. It is a
 * secondary-ops engine, hence named here rather than coming from a family.
 */
export function getRouteCoreProcessClasses(): ReadonlySet<string> {
  return new Set<string>([
    ...getEnginesForFamily('sheet_metal_cutting').map((e) => e.machineClass as string),
    ...getEnginesForFamily('sheet_metal_forming').map((e) => e.machineClass as string),
    'press_brake',
  ]);
}

/** The registered classes that bend in-process, so their route needs no press brake. */
export function getFormingProcessClasses(): ReadonlySet<string> {
  return new Set<string>(
    getEnginesForFamily('sheet_metal_forming').map((e) => e.machineClass as string),
  );
}
