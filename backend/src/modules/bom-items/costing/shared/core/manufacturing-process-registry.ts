import type { ManufacturingProcessEngine } from './manufacturing-process.types';
import { LaserCuttingEngine, Co2LaserCuttingEngine } from '../../sheet-metal/process/laser-cutting-engine';
import { TurretPunchEngine } from '../../sheet-metal/process/turret-punch-engine';
import { WaterjetEngine } from '../../sheet-metal/process/waterjet-engine';
import { OxyfuelCuttingEngine } from '../../sheet-metal/process/oxyfuel-cutting-engine';
import { ShearingEngine } from '../../sheet-metal/process/shearing-engine';
import { LaserPunchEngine } from '../../sheet-metal/process/laser-punch-engine';
import { RouterEngine } from '../../sheet-metal/process/router-engine';
import { PressStrokeEngine } from '../../sheet-metal/process/press-stroke-engine';
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
  new TurretPunchEngine(),
  new WaterjetEngine(),
  new OxyfuelCuttingEngine(),
  new ShearingEngine(),
  new LaserPunchEngine(),
  new RouterEngine(),
  new PressStrokeEngine('standard_press', 'Standard Press'),
  new PressStrokeEngine('tandem_press', 'Tandem Press'),
  new PressStrokeEngine('progressive_die_press', 'Progressive Die'),
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
  turret_punch: 'sm-turret',
  waterjet: 'sm-waterjet',
  router_2axis: 'sm-router',
  oxyfuel_cut: 'sm-oxyfuel',
  shear: 'sm-shear',
  laser_punch: 'sm-laser-punch',
  standard_press: 'sm-standard-press',
  tandem_press: 'sm-tandem-press',
};
export const ROUTE_LABEL_FOR_CLASS: Record<string, string> = {
  fiber_laser: 'Fiber Laser + Press Brake',
  co2_laser: 'CO2 Laser + Press Brake',
  turret_punch: 'Turret Punch + Press Brake',
  waterjet: 'Waterjet + Press Brake',
  router_2axis: '2-Axis Router + Press Brake',
  oxyfuel_cut: 'OxyFuel Cut + Press Brake',
  shear: 'Shearing + Press Brake',
  laser_punch: 'Laser Punch + Press Brake',
  standard_press: 'Standard Press',
  tandem_press: 'Tandem Press',
};

export function getCuttingRouteIds(): string[] {
  return getEnginesForFamily('sheet_metal_cutting').map((e) => ROUTE_ID_FOR_CLASS[e.machineClass] ?? e.machineClass);
}
