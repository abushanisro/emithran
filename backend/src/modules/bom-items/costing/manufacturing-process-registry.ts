import type { ManufacturingProcessEngine } from './manufacturing-process-engine';
import { LaserCuttingEngine, Co2LaserCuttingEngine } from './laser-cutting-engine';
import { TurretPunchEngine } from './turret-punch-engine';
import { WaterjetEngine } from './waterjet-engine';
import { RouterEngine } from './router-engine';
import { PressStrokeEngine } from './press-stroke-engine';

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
export const MANUFACTURING_PROCESS_REGISTRY: ManufacturingProcessEngine[] = [
  new LaserCuttingEngine(),
  new Co2LaserCuttingEngine(),
  new TurretPunchEngine(),
  new WaterjetEngine(),
  new RouterEngine(),
  new PressStrokeEngine('standard_press', 'Standard Press'),
  new PressStrokeEngine('tandem_press', 'Tandem Press'),
];

export function getEnginesForFamily(processFamily: string): ManufacturingProcessEngine[] {
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
  standard_press: 'sm-standard-press',
  tandem_press: 'sm-tandem-press',
};
export const ROUTE_LABEL_FOR_CLASS: Record<string, string> = {
  fiber_laser: 'Fiber Laser + Press Brake',
  co2_laser: 'CO2 Laser + Press Brake',
  turret_punch: 'Turret Punch + Press Brake',
  waterjet: 'Waterjet + Press Brake',
  router_2axis: '2-Axis Router + Press Brake',
  standard_press: 'Standard Press',
  tandem_press: 'Tandem Press',
};

export function getCuttingRouteIds(): string[] {
  return getEnginesForFamily('sheet_metal_cutting').map((e) => ROUTE_ID_FOR_CLASS[e.machineClass] ?? e.machineClass);
}
