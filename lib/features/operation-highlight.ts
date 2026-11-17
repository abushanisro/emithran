import { isBend, isBlankProfile, isPlainHole } from '@/lib/features/feature-graph';
import { type ProcessTreeNode } from '@/lib/features/process-tree';
import type { FeatureNodeV2, FaceMapEntry } from '@/lib/types/manufacturing';

// Maps one FeatureBreakdown row to the 3D-viewer highlight it represents, so
// clicking "Bend R1mm x2" shows exactly those 2 bends (not every bend in the
// part), "Pierces x19"/pierce cleanup shows all pierced holes, and cut-path/
// edge-length rows (no discrete feature — the cut path runs around the whole
// part) show the full model outline via the face map. Returns null when there's
// nothing to highlight (feature graph not loaded, or an unrecognized type),
// which the caller uses to disable the row rather than showing a dead click.
export function resolveFeatureOpHighlight(
  op: { name: string; featureType: string; featureIds?: string[] | undefined },
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): FeatureNodeV2 | null {
  if (op.featureType === 'bend') {
    const bendFeatures = v2Features.filter(isBend);
    const m = /R([\d.]+)mm/.exec(op.name);
    if (m) {
      const bucket = parseFloat(m[1]!);
      const matched = bendFeatures.filter((f) => Math.round((f.radius_mm ?? 0) * 2) / 2 === bucket);
      if (matched.length) return mergeFeaturesToHL(`fb_bend_r${bucket}`, matched);
    }
    return mergeFeaturesToHL('fb_bend_all', bendFeatures);
  }
  if (op.featureType === 'pierce' || op.featureType === 'deburr_pierce') {
    return mergeFeaturesToHL('fb_holes', v2Features.filter(isPlainHole));
  }
  if (op.featureType === 'pem_insertion') {
    // buildPemFeatureBreakdown (bom-items.service.ts) names each row
    // "<part spec> x<count> (ØXmm, Ys/insertion)" — extract the diameter and
    // match holes at that diameter (0.3mm tolerance, same as the backend's
    // own sm_lookup_pem_hardware match tolerance in getPemMatches), same
    // bucket-matching pattern as bend/radius above. The feature graph has no
    // separate "this hole is a PEM insertion point" tag, so diameter is the
    // real, available signal — not a guess.
    const holeFeatures = v2Features.filter(isPlainHole);
    const m = /Ø([\d.]+)mm/.exec(op.name);
    if (m) {
      const dia = parseFloat(m[1]!);
      const matched = holeFeatures.filter((f) => Math.abs((f.diameter_mm ?? 0) - dia) < 0.3);
      if (matched.length) return mergeFeaturesToHL(`fb_pem_d${dia}`, matched);
    }
    return mergeFeaturesToHL('fb_pem_all', holeFeatures);
  }
  if (op.featureType === 'laser_cut' || op.featureType === 'deburr_edge') {
    return buildFullModelHL('fb_outline', faceMap);
  }
  // Machining: the backend names the exact feature_graph_v2 entries each
  // operation machines (FeatureOp.featureIds, from the sequencer), so the
  // highlight is exactly those occurrences — never every feature of a type,
  // and never a diameter parsed back out of the display label.
  if (op.featureIds?.length) {
    const ids = new Set(op.featureIds);
    const matched = v2Features.filter((f) => ids.has(f.id));
    if (matched.length) return mergeFeaturesToHL(`fb_${op.featureIds.join('_')}`, matched);
  }
  return null;
}

export function mergeFeaturesToHL(id: string, features: FeatureNodeV2[]): FeatureNodeV2 | null {
  if (!features.length) return null;
  const first = features[0]!;
  const occurrences = features.flatMap((f) =>
    f.occurrences.map((occ) => ({ centroid: occ.centroid, face_ids: occ.face_ids })),
  );
  return { id, feature_type: first.feature_type, occurrences };
}

export type OperationVisual = { highlight: FeatureNodeV2; color: string } | null;

export function buildFullModelHL(id: string, faceMap: FaceMapEntry[]): FeatureNodeV2 | null {
  if (!faceMap.length) return null;
  return { id, feature_type: 'Blank', occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: faceMap.map((e) => e.face_id) }] };
}

export function computeOperationVisual(
  label: string,
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): OperationVisual {
  const l = label.toLowerCase();
  const merge = (id: string, feats: FeatureNodeV2[], color: string): OperationVisual => {
    const hl = mergeFeaturesToHL(id, feats);
    return hl ? { highlight: hl, color } : null;
  };
  if (l.includes('laser') || l.includes('cutting') || l.includes('punch') || l.includes('waterjet'))
    return merge('op-cutting', v2Features.filter((f) => isPlainHole(f) || isBlankProfile(f)), '#3b82f6');
  if (l.includes('press brake') || l.includes('bending'))
    return merge('op-bending', v2Features.filter(isBend), '#eab308');
  if (l.includes('tapping'))
    return merge('op-tapping',
      v2Features.filter((f) => isPlainHole(f) && (f.diameter_mm ?? 99) <= 6.0), '#f26822');
  if (l.includes('deburr')) {
    // Phase 2: replace with true edge highlight (EdgeHighlight component exists in EDrawingsViewer)
    return merge('op-deburr',
      v2Features.filter((f) => isPlainHole(f) || isBend(f)), '#06b6d4');
  }
  if (l.includes('surface treatment') || l.includes('coating')) {
    const hl = buildFullModelHL('op-surface', faceMap);
    return hl ? { highlight: hl, color: '#93c5fd' } : null;
  }
  if (l.includes('inspection')) {
    return merge('op-inspection', v2Features, '#e2e8f0');
  }
  if (l.includes('turning') || l.includes('milling') || l.includes('machining'))
    return merge('op-all', v2Features, '#64748b');
  // ── Injection molding operations ──
  // Real, confirmed live gap (2026-09-11): this section only ever matched
  // 'injection mould(ing)'/'injection mold(ing)' — the OLD coarse single-
  // recommendation label. The real per-step operations now populating the
  // tree (cost-injection-molding-engine.ts's own makeLine labels: 'Mold
  // Setup', 'Injection', 'Packing/Holding', 'Cooling', 'Ejection', 'Weight
  // Check') don't contain that substring, so clicking any of them produced
  // no highlight at all — confirmed live, the exact "no process-level
  // highlight" gap reported alongside the missing feature nodes. Each real
  // step gets the whole-part tint (none of these individual steps has its
  // own distinct face-level geometry beyond the undercut/undraft/parting
  // detail already handled by computeFeatureNodeVisual's feat_im_* nodes).
  if (l.includes('material drying') || l.includes('drying'))
    return null; // Pre-process — no part geometry involved yet
  if (l === 'mold setup' || l === 'mould setup') {
    const hl = buildFullModelHL('op-mold-setup', faceMap);
    return hl ? { highlight: hl, color: '#94a3b8' } : null; // slate — tooling/machine setup
  }
  if (l.includes('injection mould') || l.includes('injection mold') || l === 'injection') {
    const hl = buildFullModelHL('op-injection', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molten cavity fill
  }
  if (l.includes('packing') || l.includes('holding')) {
    const hl = buildFullModelHL('op-packing', faceMap);
    return hl ? { highlight: hl, color: '#fb923c' } : null; // amber-orange — pack/hold pressure
  }
  if (l === 'cooling') {
    const hl = buildFullModelHL('op-cooling', faceMap);
    return hl ? { highlight: hl, color: '#38bdf8' } : null; // sky blue — cooling
  }
  if (l === 'ejection') {
    const hl = buildFullModelHL('op-ejection', faceMap);
    return hl ? { highlight: hl, color: '#94a3b8' } : null; // slate — part release
  }
  if (l.includes('weight check')) {
    const hl = buildFullModelHL('op-weight-check', faceMap);
    return hl ? { highlight: hl, color: '#e2e8f0' } : null; // light — quality overlay
  }
  if (l.includes('gate trimming') || l.includes('degating') || l.includes('deflashing')) {
    const hl = buildFullModelHL('op-gate-trim', faceMap);
    return hl ? { highlight: hl, color: '#eab308' } : null; // yellow — secondary bench op
  }
  return null;
}

export function computeFeatureNodeVisual(
  node: ProcessTreeNode,
  v2Features: FeatureNodeV2[],
  faceMap: FaceMapEntry[],
): OperationVisual {
  const merge = (id: string, feats: FeatureNodeV2[], color: string): OperationVisual => {
    const hl = mergeFeaturesToHL(id, feats);
    return hl ? { highlight: hl, color } : null;
  };
  // Real canonical-operation CNC feature nodes (v2feat_*, built from
  // feature_graph_v2 entries the backend already classified) — match by the
  // exact feature id tagged at build time, never by re-deriving from label.
  if (node.v2FeatureId != null) {
    const exact = v2Features.find((f) => f.id === node.v2FeatureId);
    return exact ? merge(`hl-${node.v2FeatureId}`, [exact], '#f97316') : null;
  }
  if (node.faceOccurrences?.length) {
    // The faces are known, their positions are not: the viewer measures each occurrence's centre from its own triangles.
    const featureType = node.label.split(/[\s×]/)[0] ?? node.label;
    return {
      highlight: {
        id: `hl-${node.id}`,
        feature_type: featureType as FeatureNodeV2['feature_type'],
        occurrences: node.faceOccurrences.map((face_ids) => ({ centroid: [0, 0, 0] as [number, number, number], face_ids })),
        centroidFromFaces: true,
      },
      color: '#d97706',
    };
  }
  if (node.v2Occurrences?.length) {
    const occurrences = node.v2Occurrences.flatMap((r) => {
      const occ = v2Features.find((f) => f.id === r.featureId)?.occurrences[r.occurrenceIndex];
      return occ ? [{ centroid: occ.centroid, face_ids: occ.face_ids }] : [];
    });
    const first = v2Features.find((f) => f.id === node.v2Occurrences![0]!.featureId);
    return occurrences.length && first
      ? { highlight: { id: `hl-${node.id}`, feature_type: first.feature_type, occurrences }, color: '#d97706' }
      : null;
  }
  if (node.v2FeatureIds?.length) {
    const ids = new Set(node.v2FeatureIds);
    return merge(`hl-${node.id}`, v2Features.filter((f) => ids.has(f.id)), '#d97706');
  }
  if (node.wholePart) {
    const hl = buildFullModelHL(`hl-${node.id}`, faceMap);
    return hl ? { highlight: hl, color: '#22d3ee' } : null;
  }
  // ── Injection molding feature nodes ──
  if (node.id === 'feat_im_part') {
    const hl = buildFullModelHL('hl-im-part', faceMap);
    return hl ? { highlight: hl, color: '#f97316' } : null; // orange — molded geometry
  }
  // Individual hole-diameter-group rows ("Ø1.6 × 24") nested under Flat
  // Pattern — previously fell through every branch above to `return null`,
  // so clicking one never highlighted anything at all. Match by diameter
  // (tagged on the node at build time) rather than parsing the label.
  if (node.holeDiameterMm != null) {
    // Round both sides to 1dp before comparing — summary.holeGroups and
    // feature_graph_v2.features are computed by two separate backend calls
    // that both round to 1dp with the same formula, but comparing raw floats
    // risks a spurious mismatch from binary floating-point representation
    // (e.g. 1.6 stored as 1.5999999999999999 on one side).
    const targetD = Math.round(node.holeDiameterMm * 10) / 10;
    const matches = v2Features.filter(
      (f) => isPlainHole(f) && f.diameter_mm != null && Math.round(f.diameter_mm * 10) / 10 === targetD,
    );
    const hl = mergeFeaturesToHL(`hl-hole-${targetD}`, matches);
    if (hl) return { highlight: hl, color: '#3b82f6' };
    // No v2 occurrence matched this diameter (e.g. stale/out-of-sync feature
    // graph data) — fall back to the full-model tint rather than nothing,
    // same convention Flat Pattern's own highlight below uses.
    const full = buildFullModelHL(`hl-hole-${targetD}`, faceMap);
    return full ? { highlight: full, color: '#3b82f6' } : null;
  }
  if (node.label === 'Flat Pattern') {
    // The complete laser-cutting operation: every hole (every diameter group
    // — "symmetric" repeats — and any one-off/ungrouped "asymmetric" hole
    // alike) TOGETHER WITH every real cut boundary's side-wall faces
    // ('cut_profile' — every panel's outer perimeter AND any cutout in it,
    // whatever shape it is — what the laser actually cuts along, not the
    // flat panel surface itself), merged into one highlight. Falls back to
    // the full-model tint only when the part has neither (e.g.
    // feature_graph_v2 not yet computed for this part), so clicking Flat
    // Pattern always shows something.
    const cutFeatures = v2Features.filter((f) => isPlainHole(f) || isBlankProfile(f));
    const holeHl = mergeFeaturesToHL('hl-flat-pattern', cutFeatures);
    if (holeHl) return { highlight: holeHl, color: '#38bdf8' }; // sky blue — unfolded blank
    const hl = buildFullModelHL('hl-flat-pattern', faceMap);
    return hl ? { highlight: hl, color: '#38bdf8' } : null;
  }
  return null;
}

export function getVizLabel(node: ProcessTreeNode): string | null {
  const l = node.label.toLowerCase();
  if (node.id === 'feat_im_part') return 'Moulded part — full cavity geometry';
  if (node.id.startsWith('secondary_') || node.id.startsWith('secfeat_')) {
    return `${node.label} — ${node.wholePart ? 'whole part surface' : 'measured features'}`;
  }
  if (node.kind === 'operation') {
    if (l.includes('laser') || l.includes('cutting')) return 'Pierce holes';
    if (l.includes('press brake') || l.includes('bending')) return 'Bend lines';
    if (l.includes('tapping')) return 'Tapped holes';
    if (l.includes('deburr')) return 'All cut edges — holes & bends';
    if (l.includes('surface treatment') || l.includes('coating')) return 'Full exterior surface';
    if (l.includes('inspection')) return 'Holes & bends (geometric features)';
    if (l.includes('injection mould') || l.includes('injection mold')) return 'Cavity + core faces — full mold geometry';
    if (l.includes('gate trimming')) return 'Gate vestige — bench degating operation';
    if (l.includes('material drying')) return null; // pre-process, no geometry
  }
  return null;
}
