import { SHEARING_CUTS_PER_BLANK } from '../../shared/core/default-rates.constants';
import { computePressStrokeCost } from './press-stroke-engine';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { BaseCuttingEngine } from '../../shared/core/engine-orchestrator';

// Thin ManufacturingProcessEngine wrapper around computePressStrokeCost()
// (press-stroke-engine.ts) — no formula rewrite, same discrete-stroke
// physics Standard/Tandem/Progressive-Die Press already use. A guillotine
// shear trims a rectangular blank from oversized raw stock in exactly
// SHEARING_CUTS_PER_BLANK straight strokes (Euclidean necessity, not a
// fabricated count — see that constant's own doc comment). Registered under
// processFamily 'sheet_metal_cutting' (not 'sheet_metal_forming' like the
// Press family) — it is a real cutting alternative offered alongside Laser/
// Waterjet/Turret/Router/OxyFuel, machineClass 'shear' wired to the 10 real
// machines in machine_library.json's "Shearing Machine" category
// (2026-09-01).
export class ShearingEngine extends BaseCuttingEngine {
  readonly machineClass = 'shear';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computePressStrokeCost('Shearing', 'shear', {
      numberOfStrokes: SHEARING_CUTS_PER_BLANK,
      batchSize: context.batchSize,
      partWeightKg: context.partWeightKg,
      pressRate: context.rate,
      processIdentity: context.processIdentity,
      setupMin: context.opSetupMin,
      dlrPerHr: context.dlrPerHr,
      qairPerHr: context.qairPerHr,
      inspTimeMin: context.inspTimeMin,
      samplingRate: context.samplingRate,
      yieldPct: context.yieldPct,
      netMatCost: context.netMatCost,
      netWeightKg: context.netWeightKg,
      scrapPricePerKg: context.scrapPricePerKg,
    });
  }
}
