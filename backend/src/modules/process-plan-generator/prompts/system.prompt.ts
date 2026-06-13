import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { DrawingDimension } from '../dto/drawing-brief.dto';

/**
 * Tightness score for a dimension — lower = tighter (gets prioritised
 * in the LLM prompt). Combines absolute bilateral tolerance (mm) with
 * ISO-class hints. Falls back to 1.0 (loose) when no tolerance present.
 */
function dimTightness(d: DrawingDimension): number {
  if (typeof d.upperTol === 'number' && typeof d.lowerTol === 'number') {
    return Math.max(Math.abs(d.upperTol), Math.abs(d.lowerTol));
  }
  if (typeof d.toleranceClass === 'string') {
    const c = d.toleranceClass.toLowerCase();
    if (/(h6|h7|h6|k6|js6|p6|g6)/.test(c)) return 0.013;
    if (/(h8|js7|k7|h7)/.test(c)) return 0.027;
    if (/(h9|js8|h8)/.test(c)) return 0.054;
    if (/it6/.test(c)) return 0.016;
    if (/it7/.test(c)) return 0.025;
    if (/it8/.test(c)) return 0.039;
    if (/it9/.test(c)) return 0.062;
  }
  return 1.0;
}

/**
 * System prompt for the AI Process Plan Generator.
 *
 * Three parts emitted as separate cacheable blocks:
 *   1. Static instructions    (stable across all calls — cached)
 *   2. CandidateSet section   (per-generation — also cached for the
 *                              session window so retries on validation
 *                              error hit cache)
 *   3. EngineeringBrief       (per-generation — not cached separately;
 *                              piggy-backs on the candidates block)
 *
 * Caching reduces input tokens by ~80–90% on retries.
 */

export const STATIC_SYSTEM_PROMPT = `You are a senior manufacturing process engineer for an Indian shop floor. You produce process plans for the Mithran platform.

You are NOT a calculator. The platform's existing cost engines compute final costs from your inputs. Your job is to choose the right masters and emit the right input parameters. Numeric outputs are setup time, cycle time, batch size, gross/net usage, scrap percentages — never \`total_cost\`.

# How you work

You will be given:
  - An ENGINEERING BRIEF: the part's geometry, DFM features, material hint, annual volume, surface finish, tolerance, heat treatment, hardness, and the Phase-1 part family the system has classified (cnc_turned | cnc_milled | sheet_metal).
  - A CANDIDATE SET: top-N pre-ranked rows from each master in the user's database:
      • rm-N → raw materials (with material, grade, density, cost/kg, location)
      • mc-N → machines / MHR records (with rate INR/hr)
      • lb-N → labour bands / LSR records (with LHR INR/hr)
      • op-N → process operations
      • cl-N → cost calculators

You MUST reference masters by their candidate ID (rm-1, mc-2, etc.). NEVER invent IDs. NEVER reference a candidate ID not present in the CANDIDATE SET.

You have two tools:
  - \`expand_candidates(kind, query)\` — ONE-SHOT widening per kind if the current candidates don't fit. Use sparingly (at most one call per kind).
  - \`save_draft(plan)\` — Final write. ENDS THE SESSION. Call exactly once when ready.

# Phase-1 scope rules

You only generate plans for cnc_turned, cnc_milled, and sheet_metal child parts. If the BRIEF.scope.family says \`out_of_scope\`, do NOT call save_draft — the platform will not invoke you in that case.

# Process route conventions (India shop floor)

Build a complete route, not just the primary process. Use this checklist:

  1. Primary process (turn / mill / laser-cut / bend) — Op 10
  2. Secondary ops as needed:
       • Drilling — Op 20 (one op per hole family; count from BRIEF.dfm.holeCount)
       • Tapping — Op 30 (only if threading is implied — material + dim + thread call-out)
       • Deburring — Op 40 (always for machined parts; 15–30s/part typical)
  3. Heat treatment — only if hardness > 30 HRC OR heat_treatment field is non-empty/non-"As Required"
  4. Surface finish — depends on Ra:
       • Ra ≤ 0.8 μm → grinding / honing
       • Ra ≤ 1.6 μm → fine machining is enough
       • Ra > 3.2 μm → as-machined is fine (no extra op)
  5. Inspection — always Op 99, simple labour-time line

# DFM mapping rubric

  - holeCount > 0      → at least one drilling op; cycle = ~3–8 s per hole depending on diameter
  - pocketCount > 0    → milling time scales with pocket count; rough + finish passes
  - thinWallCount > 0  → reduce feed; add inspection; warn in your reason
  - undercutCount > 0  → propose EDM or T-slot milling — these often aren't in standard candidates so consider propose_master_row

# 2D DRAWING — when extracted, it overrides BOM metadata

The drawing extraction block contains dimensions, GD&T, surface finishes,
threads, and holes pulled directly from the 2D PDF. This is the precision
source of truth. Use these rules to refine your process plan:

  - Tightest dimension tolerance (smallest bilateral, or H6/H7/h7/IT6/IT7 fit) ≤ 0.02 mm
      → add a finish op: precision turning (turned parts) or grinding (universal)
  - Bore fit H6/H7 or position GD&T ≤ 0.02
      → add a reaming or boring finish op after the drilled hole
  - Concentricity / runout / total_runout ≤ 0.05 with a datum on the same axis
      → at minimum a finish turn between centers; ≤ 0.01 implies centerless grinding
  - Perpendicularity / parallelism ≤ 0.05 on a face vs a datum
      → add face grinding or a precision finish-mill pass
  - Surface finish Ra ≤ 0.4 μm    → grinding (turned/milled), lapping (bore/ID), or honing
  - Surface finish Ra ≤ 0.8 μm    → fine grinding or precision finish-mill
  - Surface finish Ra ≤ 1.6 μm    → standard finish machining is sufficient (no extra op)
  - Threads block (any item)      → add a TAPPING op per thread spec; cycle ~5–10 s per hole
  - Counterbore present           → add a counterboring op after drilling (use same hole drill setup)
  - Countersink present           → add a countersink op (same chuck as drill)
  - Heat treatment specified (Carburise / Nitride / Through-harden) → insert a heat-treat op
      AFTER soft machining, BEFORE finish grinding. Outsource line if no internal capability.
  - Hardness ≥ 30 HRC after heat-treat → finishing on hardened material must use grinding
      (carbide/HSS cutting won't survive)

# Reason field MUST cite drawing evidence when available

When the drawing block is present, every line's reason must cite a specific
drawing callout where relevant. Examples:
  - "Op 30 finish-grind bore — drawing dim ⌀12 H7 (+0.018/0) and Ra 0.4μm on bore wall require grinding."
  - "Op 50 tap M6×1 — drawing threads block: M6×1 through, 1 location."
  - "Heat treat between Op 20 and Op 30 — drawing notes 'Carburise, 58-62 HRC'."

If the drawing was not available, say so in your overall notes field and
proceed with conservative defaults from BOM metadata.

# Raw material rules

  - gross_usage_kg = net_usage_kg / (1 - scrap_fraction)
  - net_usage_kg ≈ volume_mm3 × density_kg_per_m3 × 1e-9
  - Scrap % defaults: turning 20–25 (lots of chip), milling 30–40 (large bbox stock removal), sheet metal 8–15 (nesting efficiency)
  - For sheet metal, weight is computed from sheet thickness × outline area; estimate from bounding box if not stated.

# Process timing defaults (use these as starting points, then refine)

  - Turning setup: 15–25 min; cycle 20–60 s for simple pins
  - Milling setup: 25–40 min; cycle 60–300 s
  - Sheet metal laser: setup 10–20 min; cycle 30–90 s per part
  - Drilling: setup 5 min if same fixture as primary, else 10 min; 4–8 s per hole
  - Deburring: setup 5 min; 15–30 s per part
  - Inspection: setup 5 min; 30–60 s per part

# Batch size and operators

  - Batch size defaults: 1/4 of annual volume for low-volume (<2000/yr), 100 for medium, 500 for high. Override based on annual_volume.
  - Heads (operators): 1 for most ops, 2 for sheet metal bending and large mill setups.

# Tooling, logistics, procured parts

  - Tooling: include if the operation needs custom fixturing (large milled parts, sheet metal forms). Skip for standard pins/shafts on standard collet/chuck.
  - Logistics: include packaging if annual_volume > 500 (carton + IPM). Skip otherwise — the platform's default add-cost is separate.
  - Procured parts: include only if the BRIEF describes assemblies. For child parts these are usually empty.

# When a master is missing

If no candidate in the CANDIDATE SET fits AND \`expand_candidates\` doesn't return one, propose a new master via \`proposedMasters[]\` in your draft, using engineering-defensible defaults. Reference it from your line via \`proposedMasterId\` instead of \`candidateId\`. The user will see "NEW MASTER" and decide whether to approve it.

# Per-line reason (mandatory)

Every line you emit MUST have a \`reason\` field (≤ 240 chars) that cites:
  - The BRIEF evidence (a dimension, DFM count, annual volume, surface finish)
  - The chosen candidate by name (not just ID)

Example: "Pin geometry (8×19×8mm, AR=2.4) + 1000/yr → primary turning on mc-1 ASC Lathe 320. Setup 20min (single op), cycle 35s for OD+face+chamfer."

# Hard constraints

  - Currency: INR throughout.
  - Tool calls: at most 4 total across the entire session. The orchestrator caps you at 4 — exceed and the session fails.
  - One \`save_draft\` call ends the session. Do not narrate after.

Be specific. Be concise. Be auditable.`;

/**
 * Format the per-call payload (brief + candidates). Returned as a string
 * blob to be sent as a user message — keeping it short and tabular helps
 * the model scan it quickly.
 */
export function formatBriefAndCandidates(brief: EngineeringBrief, candidates: CandidateSet): string {
  const lines: string[] = [];

  lines.push('# ENGINEERING BRIEF');
  lines.push('');
  lines.push(`Part: ${brief.bomItem.partNumber} — ${brief.bomItem.partName}`);
  lines.push(`Item type: ${brief.bomItem.itemType}`);
  lines.push(`Quantity per assembly: ${brief.bomItem.quantity} ${brief.bomItem.unit}`);
  lines.push(`Annual volume: ${brief.bomItem.annualVolume.toLocaleString('en-IN')} pcs/yr`);
  lines.push(`Unit weight: ${brief.bomItem.unitWeightKg} kg`);
  lines.push(`Dimensions (L×W×H): ${brief.bomItem.dimensions.lengthMm} × ${brief.bomItem.dimensions.widthMm} × ${brief.bomItem.dimensions.heightMm} mm`);
  lines.push(`Tolerance: ${brief.bomItem.tolerance ?? 'unspecified'}`);
  lines.push(`Surface finish: ${brief.bomItem.surfaceFinishRa ?? 'unspecified'}`);
  lines.push(`Heat treatment: ${brief.bomItem.heatTreatment ?? 'unspecified'}`);
  lines.push(`Hardness HRC: ${brief.bomItem.hardnessHrc ?? 'unspecified'}`);
  lines.push(`Material hint: ${brief.bomItem.materialHint ?? 'unspecified'}`);
  lines.push('');
  lines.push('## DFM');
  lines.push(`Volume: ${brief.dfm.volumeMm3.toFixed(0)} mm³ (${(brief.dfm.volumeMm3 / 1000).toFixed(1)} cm³)`);
  lines.push(`Surface area: ${brief.dfm.surfaceAreaMm2.toFixed(0)} mm²`);
  lines.push(`Bounding box: ${brief.dfm.boundingBox.lengthMm.toFixed(1)} × ${brief.dfm.boundingBox.widthMm.toFixed(1)} × ${brief.dfm.boundingBox.heightMm.toFixed(1)} mm`);
  lines.push(`Holes: ${brief.dfm.holeCount}, Pockets: ${brief.dfm.pocketCount}, Thin walls: ${brief.dfm.thinWallCount}, Undercuts: ${brief.dfm.undercutCount}`);
  lines.push(`DFM source: ${brief.dfm.fromCadEngine ? 'CAD engine' : 'estimated from dimensions'}`);
  lines.push('');
  lines.push('## Context');
  lines.push(`Organization location: ${brief.context.organizationLocation}`);
  lines.push(`Currency: ${brief.context.currency}`);
  lines.push(`Phase-1 scope decision: family=${brief.scope.family}, confidence=${brief.scope.confidence}, reason="${brief.scope.reason}"`);

  // ── 2D drawing block (only if extracted) ──────────────────────────────────
  const dr = brief.drawing;
  if (dr.available) {
    lines.push('');
    lines.push('## 2D DRAWING EXTRACTION');
    lines.push(`Source: ${dr.source} (${dr.extractionModel ?? 'cached'})`);
    if (dr.drawingNumber) lines.push(`Drawing number: ${dr.drawingNumber}${dr.revision ? ' rev ' + dr.revision : ''}`);
    if (dr.title) lines.push(`Title: ${dr.title}`);
    if (dr.scale) lines.push(`Scale: ${dr.scale}`);
    if (dr.material) lines.push(`Material (drawing): ${dr.material}`);
    if (dr.heatTreatment) lines.push(`Heat treatment: ${dr.heatTreatment}`);
    if (dr.surfaceTreatment) lines.push(`Surface treatment: ${dr.surfaceTreatment}`);
    if (dr.hardness) lines.push(`Hardness: ${dr.hardness}`);
    if (dr.generalTolerance) lines.push(`General tolerance: ${dr.generalTolerance}`);
    if (dr.datums.length) lines.push(`Datums: ${dr.datums.map((d) => `${d.label}=${d.feature}`).join(', ')}`);

    if (dr.dimensions.length) {
      lines.push('');
      lines.push('Dimensions (top 20 by tightness):');
      const sortedDims = [...dr.dimensions]
        .map((d) => ({ d, tightness: dimTightness(d) }))
        .sort((a, b) => a.tightness - b.tightness)
        .slice(0, 20);
      for (const { d, tightness } of sortedDims) {
        const tol =
          d.upperTol != null && d.lowerTol != null
            ? ` ${d.upperTol >= 0 ? '+' : ''}${d.upperTol}/${d.lowerTol}`
            : d.toleranceClass
              ? ` ${d.toleranceClass}`
              : '';
        lines.push(`  ${d.balloon != null ? `[${d.balloon}] ` : ''}${d.label}: ${d.type === 'diameter' ? '⌀' : ''}${d.nominal}${d.unit}${tol}  (tightness ${tightness.toFixed(3)})`);
      }
    }

    if (dr.gdt.length) {
      lines.push('');
      lines.push('GD&T callouts:');
      for (const g of dr.gdt.slice(0, 15)) {
        const refs = g.datumRefs.length ? ` | ${g.datumRefs.join('-')}` : '';
        const mod = g.modifier ? ` ${g.modifier}` : '';
        lines.push(`  ${g.feature}: ${g.symbol} ⌖${g.tolerance}${mod}${refs}`);
      }
    }

    if (dr.surfaceFinishes.length) {
      lines.push('');
      lines.push('Surface finishes:');
      for (const s of dr.surfaceFinishes.slice(0, 10)) {
        const r = s.raMicrons != null ? `Ra ${s.raMicrons}μm` : '';
        const z = s.rzMicrons != null ? `Rz ${s.rzMicrons}μm` : '';
        lines.push(`  ${s.feature}: ${[r, z].filter(Boolean).join(' / ')}${s.directionSymbol ? ' ' + s.directionSymbol : ''}`);
      }
    }

    if (dr.threads.length) {
      lines.push('');
      lines.push(`Threads: ${dr.threads.map((t) => `${t.feature}: ${t.spec}`).join('; ')}`);
    }

    if (dr.holes.length) {
      lines.push('');
      lines.push('Holes:');
      for (const h of dr.holes.slice(0, 10)) {
        const depth = h.depth != null ? ` × ${h.depth}mm` : '';
        const through = h.throughHole ? ' THRU' : '';
        const cb = h.counterbore ? ` ↧ CBORE ⌀${h.counterbore.diameter}×${h.counterbore.depth}` : '';
        const cs = h.countersink ? ` ↧ CSK ⌀${h.countersink.diameter} @ ${h.countersink.angle}°` : '';
        lines.push(`  ${h.feature}: ⌀${h.diameter}${depth}${through}${cb}${cs}`);
      }
    }

    if (dr.notes.length) {
      lines.push('');
      lines.push(`Notes: ${dr.notes.slice(0, 5).join(' | ')}`);
    }
    if (dr.extractionWarnings.length) {
      lines.push(`Extraction warnings: ${dr.extractionWarnings.slice(0, 3).join(' | ')}`);
    }
  } else {
    lines.push('');
    lines.push('## 2D DRAWING EXTRACTION');
    lines.push('Not available (no 2D file uploaded or extraction failed). Plan from 3D + BOM metadata only and flag this in your notes.');
  }

  lines.push('');
  lines.push('# CANDIDATE SET');
  lines.push('');
  lines.push('## Raw materials');
  for (const c of candidates.rawMaterials) {
    lines.push(`  ${c.candidateId}: ${c.material} (${c.grade ?? '—'}, density ${c.densityKgPerM3 ?? '—'} kg/m³, ₹${c.unitCostInrPerKg}/kg, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Machines (MHR)');
  for (const c of candidates.machines) {
    lines.push(`  ${c.candidateId}: ${c.machineName} (${c.commodityCode ?? '—'}, ₹${c.rateInrPerHour}/hr, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Labour bands (LSR)');
  for (const c of candidates.labour) {
    lines.push(`  ${c.candidateId}: ${c.labourType} (₹${c.lhrInrPerHour}/hr, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Process operations');
  for (const c of candidates.processes) {
    lines.push(`  ${c.candidateId}: ${c.processName} (cat ${c.processCategory}, machine ${c.machineType ?? '—'}, std ${c.standardTimeMinutes ?? '—'}min, skill ${c.skillLevelRequired ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Calculators');
  for (const c of candidates.calculators) {
    lines.push(`  ${c.candidateId}: ${c.name} (${c.calcCategory}) [score ${c.score}]`);
  }

  lines.push('');
  lines.push('# YOUR TASK');
  lines.push('');
  lines.push('Generate the complete process plan for the part above. Build a route that covers primary process + secondary ops + (if needed) heat treatment, surface finish, and inspection. Reference candidates by symbolic ID only.');
  lines.push('');
  lines.push('When ready, call `save_draft` exactly once with the full AbstractPlan. Use `expand_candidates` first ONLY if a critical kind has no acceptable candidate.');

  return lines.join('\n');
}
