import { Injectable } from "@nestjs/common";
import type { IOperationCalculator } from "../interfaces/operation-calculator.interface";
import { DrillingCalculator } from "./drilling.calculator";
import { TurningCalculator } from "./turning.calculator";
import { MillingCalculator } from "./milling.calculator";
import { TappingCalculator } from "./tapping.calculator";
import { LaserCuttingCalculator } from "./laser-cutting.calculator";
import { PressBrakeCalculator } from "./press-brake.calculator";
import { InjectionMoldingCalculator } from "./injection-molding.calculator";

// Maps non-canonical operation strings → canonical calculator keys.
// Canonical keys are registered directly in the registry; only aliases go here.
const OPERATION_ALIASES: Record<string, string> = {
  "drill":                  "drilling",
  "axial_hole":             "drilling",
  "cross_hole":             "drilling",
  "hole_making":            "drilling",
  "turn":                   "turning",
  "od_turning":             "turning",
  "face_turning":           "turning",
  "thread_turning":         "turning",
  "cnc_turning":            "turning",
  "cnc_milling":            "milling",
  "face_milling":           "milling",
  "pocket_milling":         "milling",
  "slot_milling":           "milling",
  "profile_milling":        "milling",
  "tap":                    "tapping",
  "thread_tapping":         "tapping",
  "internal_thread":        "tapping",
  "laser":                  "laser_cutting",
  "laser_cut":              "laser_cutting",
  "fiber_laser":            "laser_cutting",
  "bending":                "press_brake",
  "bend":                   "press_brake",
  "brake_bending":          "press_brake",
  "injection_moulding":     "injection_molding",
  "im":                     "injection_molding",
  "plastic_injection":      "injection_molding",
};

@Injectable()
export class CalculatorRegistry {
  private readonly registry = new Map<string, IOperationCalculator>();

  constructor(
    private readonly drilling: DrillingCalculator,
    private readonly turning: TurningCalculator,
    private readonly milling: MillingCalculator,
    private readonly tapping: TappingCalculator,
    private readonly laserCutting: LaserCuttingCalculator,
    private readonly pressBrake: PressBrakeCalculator,
    private readonly injectionMolding: InjectionMoldingCalculator,
  ) {
    [drilling, turning, milling, tapping, laserCutting, pressBrake, injectionMolding].forEach(
      (calc) => this.registry.set(calc.operationKey, calc),
    );
  }

  resolve(operation: string): IOperationCalculator | null {
    const lower = operation.toLowerCase().trim();
    // Direct key match
    if (this.registry.has(lower)) return this.registry.get(lower)!;
    // Alias map
    const canonical = OPERATION_ALIASES[lower];
    if (canonical && this.registry.has(canonical)) return this.registry.get(canonical)!;
    // Fuzzy: check if operation contains any registered key
    for (const [key, calc] of this.registry) {
      if (lower.includes(key) || key.includes(lower)) return calc;
    }
    return null;
  }

  list(): string[] {
    return Array.from(this.registry.keys());
  }
}
