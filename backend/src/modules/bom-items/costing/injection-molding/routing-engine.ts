// Injection molding routing engine — decides WHICH operations a part gets.
//
// Consumes InjectionMoldingSignals (geometry + material evidence, with explicit
// null = "not measured yet") and returns an IMProcessTree. Deterministic rules
// only — no LLM, no rates, no costs. The cost engine consumes the tree; this
// module never sees a rupee. Same layering as sheet metal and CNC: route
// first, cost the route.
//
// Every rule that fires records WHY on the operation itself; every rule that
// cannot evaluate because its signal is missing records a routingWarning
// instead of silently guessing (CLAUDE.md: wrong zeros are worse than visible
// errors — the same applies to silently missing route steps).

import {
  IM_OPERATION_REGISTRY, IMOperationId, IMProcessTree, IMRoutedOperation,
  MoldingSubtype,
  isHygroscopicResin, isSiliconeGrade,
} from './process-tree';

// Bump when selection rules change — stored on every routed tree for audit.
// v1 → v2: added side_action rule (undercut features), insert_installation now
//          fed by real CAD insert_candidate_count rather than always null.
// v2 → v3: variant-aware routing (LSR Arrhenius path, insert_loading in-mold,
//          core_unscrewing, overmold/gas_assisted/two_shot stubs, moldingSubtype).
export const IM_ROUTING_VERSION = 'im_route_v3';

export interface InjectionMoldingSignals {
  // Material
  materialGrade: string | null;
  // Geometry (null = not extracted for this part yet; 0 = measured as zero)
  projectedAreaMm2: number | null;
  partVolumeMm3: number | null;
  partMassKg: number | null;
  wallThicknessNominalMm: number | null;
  wallThicknessMinMm: number | null;
  wallThicknessMaxMm: number | null;
  ribCount: number | null;          // Phase 1: pocket-count proxy from CAD
  bossCount: number | null;         // Phase 1: hole_or_boss_count proxy
  // Phase 2+ signals — the routing rules for these exist NOW so the tree is
  // complete; extraction feeds them later. null until the CAD engine measures.
  undercutCount: number | null;
  insertCount: number | null;
  textFeatureCount: number | null;  // molded-in text/logos → pad print/laser mark NOT needed
  assemblyFeatureCount: number | null; // snap fits / weld ribs → welding or assembly
  gateType: 'edge' | 'fan' | 'sub' | 'hot_tip' | null; // null = unknown (no gate prediction yet)
  partingComplexity: number | null; // 0–1; flash risk proxy
  // Phase 5+ signals — set manually via BOM annotation until CAD detection exists.
  unscrewingCoreCount: number | null; // helical blind holes requiring in-cycle core rotation
  overmoldSubstrate: string | null;   // substrate material grade (triggers overmold path)
}

// Deflashing threshold on partingComplexity (0–1). A flat parting line rarely
// flashes; a stepped/curved shutoff-heavy line does. 0.5 = mid-band until the
// parting-line extractor (Phase 2 plan) produces real values to tune against.
export const IM_DEFLASH_PARTING_COMPLEXITY_THRESHOLD = 0.5;

function op(id: IMOperationId, reason: string): IMRoutedOperation {
  const def = IM_OPERATION_REGISTRY[id];
  return { id, label: def.label, level: def.level, reason };
}

export function buildInjectionMoldingRoute(
  signals: InjectionMoldingSignals,
  moldingSubtype: MoldingSubtype = 'standard',
): IMProcessTree {
  const operations: IMRoutedOperation[] = [];
  const routingWarnings: string[] = [];
  const isLsr = moldingSubtype === 'lsr';

  // ── Stub path: overmolding / gas-assisted / two-shot ──────────────────────
  // These subtypes require manual annotation. Costing not yet automated —
  // surface a stub with a warning rather than producing wrong numbers.
  const STUB_SUBTYPES: MoldingSubtype[] = ['overmold', 'gas_assisted', 'two_shot'];
  if (STUB_SUBTYPES.includes(moldingSubtype)) {
    const label = moldingSubtype === 'overmold' ? 'Overmolding'
      : moldingSubtype === 'gas_assisted' ? 'Gas-Assisted Injection Molding (GAIM)'
      : 'Two-Shot / Multi-Material Molding';
    routingWarnings.push(
      `${label} subtype set manually — automated cost calculation not yet available; ` +
      `review all process lines before quoting. CAD detection for this variant is planned for a future sprint.`);
    // Still route baseline ops so the tree isn't empty.
    operations.push(op('mold_setup', `${label} — mold mounting (standard baseline)`));
    operations.push(op('injection', `${label} — first shot injection`));
    operations.push(op('ejection', `${label} — ejection`));
    operations.push(op('visual_inspection', 'Baseline QC'));
    return {
      family: 'plastic_molding',
      process: 'injection_molding',
      moldingSubtype,
      operations,
      routingWarnings,
      routingVersion: IM_ROUTING_VERSION,
    };
  }

  // ── Level 2: primary process ────────────────────────────────────────────────

  if (isLsr) {
    // LSR: no drying (two-component liquid, mixed at nozzle). Dosing unit instead.
    operations.push(op('lsr_compound_dosing',
      'LSR two-component A+B metering — mixing head purge before first shot'));
  } else if (isHygroscopicResin(signals.materialGrade)) {
    // Hygroscopic thermoplastics: PA66/PA6/PC/PET/PBT/ABS/PMMA must be dried.
    operations.push(op('material_drying',
      `${signals.materialGrade} is hygroscopic — pre-drying required before molding`));
  } else if (!signals.materialGrade) {
    routingWarnings.push(
      'Material grade not set — drying requirement cannot be evaluated (hygroscopic resins like PA66/PC require it)');
  }

  operations.push(op('mold_setup',
    isLsr
      ? 'Mold mounting + heated-mold temperature ramp to 180°C — every LSR batch'
      : 'Mold mounting, clamping, and process trial — every molding batch'));
  operations.push(op('injection', 'Melt injection into cavity — core molding cycle'));

  if (isLsr) {
    // LSR: thermoset cure replaces packing + cooling phases.
    operations.push(op('lsr_curing',
      `LSR thermoset cure at mold temperature ~180°C — Arrhenius cure model; ` +
      `time driven by wall thickness (replaces Menges cooling)`));
  } else {
    operations.push(op('packing', 'Pack/hold pressure to compensate volumetric shrinkage'));
    operations.push(op('cooling',
      signals.wallThicknessNominalMm != null && signals.wallThicknessNominalMm > 0
        ? `Cooling to ejection temperature — driven by ${signals.wallThicknessNominalMm.toFixed(1)}mm nominal wall`
        : 'Cooling to ejection temperature — wall thickness not measured, default gauge assumed'));
  }

  operations.push(op('ejection', 'Ejector stroke and part release'));

  if (isLsr) {
    // Post-mold oven cure: required for compression-set resistance (most LSR applications).
    operations.push(op('secondary_cure_oven',
      'Post-mold oven cure at 200°C for 4h — improves compression set and sealing performance (batch-amortized)'));
  }

  // ── Level 3: secondary operations ──────────────────────────────────────────

  // Gate Trimming — not needed for LSR (self-degating cold-deck) or hot-tip / sub gates.
  if (!isLsr && signals.gateType !== 'hot_tip' && signals.gateType !== 'sub') {
    operations.push(op('gate_trimming',
      signals.gateType
        ? `${signals.gateType} gate leaves a vestige — trim required`
        : 'Gate type unknown — cold edge gate assumed (conservative default), trim required'));
    if (!signals.gateType) {
      routingWarnings.push('Gate type not predicted yet — gate trimming routed by conservative default');
    }
  }

  // Deflashing — flash risk scales with parting-line complexity.
  if (signals.partingComplexity != null
      && signals.partingComplexity > IM_DEFLASH_PARTING_COMPLEXITY_THRESHOLD) {
    operations.push(op('deflashing',
      `Parting complexity ${signals.partingComplexity.toFixed(2)} > ${IM_DEFLASH_PARTING_COMPLEXITY_THRESHOLD} — stepped/complex shutoff line, flash removal expected`));
  }

  // Side Action — each undercut feature requires a slide or lifter (in cycle).
  if ((signals.undercutCount ?? 0) > 0) {
    operations.push(op('side_action',
      `${signals.undercutCount} undercut feature(s) detected — side action (slide/lifter) required`));
  } else if (signals.undercutCount === null) {
    routingWarnings.push(
      'Undercut detection not run (Phase 2 draft analysis required on STEP model) — side action requirement unknown');
  }

  // Unscrewing Cores — helical internal threads need in-cycle core rotation.
  if ((signals.unscrewingCoreCount ?? 0) > 0) {
    operations.push(op('core_unscrewing',
      `${signals.unscrewingCoreCount} unscrewing core(s) detected — hydraulic/servo core rotation required per shot`));
    routingWarnings.push(
      'Unscrewing cores detected — mold complexity increased; verify cavity count and cycle time with toolmaker');
  }

  // Insert Molding — in-mold placement (insert subtype) or legacy post-mold (standard).
  if ((signals.insertCount ?? 0) > 0) {
    if (moldingSubtype === 'insert') {
      const ic = signals.insertCount!;
      operations.push(op('insert_loading',
        `${ic} insert(s) — in-mold placement before shot; +${ic * 20}s cycle penalty (manual loading)`));
      operations.push(op('insert_inspection',
        `Pull test / torque verification on ${ic} insert(s) per part (sampled)`));
    } else {
      operations.push(op('insert_installation',
        `${signals.insertCount!} insert candidate(s) detected — post-mold press/heat-stake installation`));
    }
  }

  // Ultrasonic Welding — assembly features present.
  if ((signals.assemblyFeatureCount ?? 0) > 0) {
    operations.push(op('ultrasonic_welding',
      `${signals.assemblyFeatureCount} assembly/weld feature(s) detected`));
  }

  // ── Level 4: inspection ─────────────────────────────────────────────────────

  operations.push(op('visual_inspection',
    isLsr
      ? 'LSR QC — flash, tear, incomplete fill, surface defects (LSR has zero regrind tolerance)'
      : 'Baseline molding QC — splay, sink, short shot, flash, color streaks'));
  operations.push(op('dimensional_inspection',
    'Critical dimensions vs drawing — shrinkage compensation verification'));
  operations.push(op('weight_check',
    'Shot weight monitoring — detects short shots and pack pressure drift'));

  return {
    family: 'plastic_molding',
    process: 'injection_molding',
    moldingSubtype,
    operations,
    routingWarnings,
    routingVersion: IM_ROUTING_VERSION,
  };
}
