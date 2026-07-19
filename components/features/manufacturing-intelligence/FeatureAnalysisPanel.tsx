"use client";

import React, { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  FeatureGraph,
  FeatureNodeV2,
  ManufacturingFamily,
} from "@/lib/types/manufacturing";
import type {
  ComponentFeatureAnalysis,
  SetupAxisSlide,
  GCDRelation,
  GCDRelationType,
  MainSurface,
  BlankAnalysis,
} from "@/lib/types/component-features";

// ── Types ────────────────────────────────────────────────────────────────────

type NodeStatus = "ok" | "blocked" | "warning";

type SelectedNode =
  | { kind: "base_props" }
  | { kind: "blank" }
  | { kind: "surface"; surface: MainSurface }
  | { kind: "setup_axis"; slide: SetupAxisSlide }
  | { kind: "sides_inside" }
  | { kind: "sides_outside" }
  | { kind: "gcd"; relation: GCDRelation }
  | { kind: "feature"; node: FeatureNodeV2; occurrenceIndex: number };

export interface FeatureAnalysisPanelProps {
  fg: FeatureGraph | null;
  componentFeatures: ComponentFeatureAnalysis | null;
  family: ManufacturingFamily | null;
  onSelectFeature: (node: FeatureNodeV2 | null, occurrenceIndex?: number) => void;
  selectedFeatureId: string | null;
}

// ── GCD taxonomy ─────────────────────────────────────────────────────────────

/** aPriori ordering — matches GCD panel left-column sort */
const GCD_ORDER: GCDRelationType[] = [
  "adjacent",
  "ends_on",
  "intersects",
  "is_accessible_from",
  "is_orthogonal",
  "lies_near",
  "lies_on",
  "lies_outside",
  "parallel",
];

const GCD_LABELS: Record<GCDRelationType, string> = {
  adjacent:            "Adjacent",
  ends_on:             "Ends On",
  intersects:          "Intersects",
  is_accessible_from:  "Is Accessible From",
  is_orthogonal:       "Is Orthogonal",
  lies_near:           "Lies Near",
  lies_on:             "Lies on",
  lies_outside:        "Lies Outside",
  parallel:            "Parallel",
};

const GCD_COLORS: Record<GCDRelationType, string> = {
  adjacent:            "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ends_on:             "bg-orange-500/15 text-orange-400 border-orange-500/30",
  intersects:          "bg-violet-500/20 text-violet-400 border-violet-500/30",
  is_accessible_from:  "bg-sky-500/20 text-sky-400 border-sky-500/30",
  is_orthogonal:       "bg-teal-500/20 text-teal-400 border-teal-500/30",
  lies_near:           "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lies_on:             "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  lies_outside:        "bg-slate-500/20 text-slate-400 border-slate-500/30",
  parallel:            "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const FAMILY_LABELS: Partial<Record<ManufacturingFamily, string>> = {
  sheet_metal:      "Sheet Metal",
  cnc_milled:       "CNC Milled",
  cnc_turned:       "CNC Turned",
  injection_molded: "Injection Molded",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, decimals = 1, suffix = ""): string {
  if (v == null) return "—";
  return `${v.toFixed(decimals)}${suffix}`;
}

function fmtBool(v: boolean | null | undefined): React.ReactElement {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return v ? (
    <span className="text-emerald-500 font-medium">✓ Yes</span>
  ) : (
    <span className="text-red-400 font-medium">✗ No</span>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: NodeStatus }) {
  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full inline-block shrink-0",
        status === "ok"      && "bg-emerald-500",
        status === "blocked" && "bg-red-500",
        status === "warning" && "bg-amber-400",
      )}
    />
  );
}

function TreeSection({
  id,
  label,
  badge,
  count,
  status,
  expanded,
  onToggle,
  onSelect,
  indent = false,
  dim = false,
  children,
}: {
  id: string;
  label: string;
  badge?: React.ReactNode;
  count?: number;
  status?: NodeStatus;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect?: () => void;
  indent?: boolean;
  dim?: boolean;
  children?: React.ReactNode;
}) {
  const isOpen = expanded.has(id);
  return (
    <div className={cn("select-none", indent && "ml-3")}>
      <button
        onClick={() => { onToggle(id); onSelect?.(); }}
        className={cn(
          "flex items-center gap-1.5 w-full text-left px-2 py-1 hover:bg-muted/40 transition-colors",
          dim && "opacity-50",
        )}
      >
        {status && <StatusDot status={status} />}
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-foreground truncate">{label}</span>
        {count != null && (
          <span className="ml-auto text-muted-foreground shrink-0">[{count}]</span>
        )}
        {badge && <span className="ml-1 shrink-0">{badge}</span>}
      </button>
      {isOpen && children && <div>{children}</div>}
    </div>
  );
}

function TreeLeaf({
  label,
  sub,
  badge,
  selected,
  onClick,
  indent = 1,
  status,
}: {
  label: string;
  sub?: string | undefined;
  badge?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  indent?: number;
  status?: NodeStatus;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-start gap-1.5 w-full text-left px-2 py-1 transition-colors rounded-none",
        selected
          ? "bg-primary/10 text-primary border-l-2 border-primary"
          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground border-l-2 border-transparent",
      )}
      style={{ paddingLeft: `${8 + indent * 12}px` }}
    >
      {status && <StatusDot status={status} />}
      <span className="shrink-0 mt-0.5 opacity-40 text-[8px]">●</span>
      <div className="flex-1 min-w-0">
        <span className="truncate block text-foreground font-mono font-medium">{label}</span>
        {sub && (
          <span className="truncate block text-muted-foreground text-[10px]">{sub}</span>
        )}
      </div>
      {badge && <span className="shrink-0 ml-1">{badge}</span>}
    </button>
  );
}

function PropRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="text-muted-foreground shrink-0 w-36">{label}</span>
      <span className="text-foreground font-mono text-[10px] truncate">{value}</span>
    </div>
  );
}

function SlideFeasibilityBadge({ slide }: { slide: SetupAxisSlide }) {
  return slide.is_feasible ? (
    <span className="text-[9px] px-1 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
      Feasible
    </span>
  ) : (
    <span className="text-[9px] px-1 rounded border bg-red-500/10 text-red-400 border-red-500/30">
      Blocked
    </span>
  );
}

function GCDTypeBadge({ type }: { type: GCDRelationType }) {
  return (
    <span className={cn("text-[9px] px-1.5 py-0.5 rounded border", GCD_COLORS[type])}>
      {GCD_LABELS[type]}
    </span>
  );
}

// ── Properties renderers ─────────────────────────────────────────────────────

function BlankProperties({ blank }: { blank: BlankAnalysis }) {
  return (
    <div className="space-y-0.5">
      <PropRow label="ID"         value={blank.id} />
      <PropRow label="Face ID"    value={blank.face_id} />
      <PropRow label="Volume"     value={`${fmtNum(blank.volume_mm3, 2)} mm³`} />
      <PropRow label="Area"       value={`${fmtNum(blank.area_mm2, 1)} mm²`} />
      <PropRow label="Edge Count" value={blank.edge_count} />
      <PropRow label="Centroid"   value={`(${fmtNum(blank.centroid.x, 1)}, ${fmtNum(blank.centroid.y, 1)}, ${fmtNum(blank.centroid.z, 1)}) mm`} />
    </div>
  );
}

function SurfaceProperties({ surface }: { surface: MainSurface }) {
  return (
    <div className="space-y-0.5">
      <PropRow label="ID"              value={surface.id} />
      <PropRow label="Face ID"         value={surface.face_id} />
      <PropRow label="Area"            value={`${fmtNum(surface.area_mm2, 1)} mm²`} />
      <PropRow label="Normal"          value={`(${fmtNum(surface.normal.x, 3)}, ${fmtNum(surface.normal.y, 3)}, ${fmtNum(surface.normal.z, 3)})`} />
      <PropRow label="Is Primary (Blank)" value={fmtBool(surface.is_primary)} />
    </div>
  );
}

function SetupAxisProperties({ slide }: { slide: SetupAxisSlide }) {
  return (
    <div className="space-y-0.5">
      <PropRow label="ID"                    value={slide.id} />
      <PropRow label="Direction"             value={`${slide.direction_label} (${slide.direction_type})`} />
      <PropRow label="Direction Vector"      value={`(${fmtNum(slide.direction_vector.x, 1)}, ${fmtNum(slide.direction_vector.y, 1)}, ${fmtNum(slide.direction_vector.z, 1)})`} />
      <PropRow label="Tool Reach"            value={`${fmtNum(slide.tool_reach_mm, 2)} mm`} />
      <PropRow label="Length"                value={`${fmtNum(slide.length_mm, 2)} mm`} />
      <PropRow label="Max Rules"             value={`${fmtNum(slide.max_rules_deg, 1)}°`} />
      <PropRow label="Wall Corner Ø"         value={`${fmtNum(slide.wall_corner_diameter_mm, 2)} mm`} />
      <PropRow label="Unobstr. Wall Corner Ø" value={`${fmtNum(slide.unobstructed_wall_corner_diameter_mm, 2)} mm`} />
      <PropRow label="Dist. to Obstruction"  value={`${fmtNum(slide.distance_to_obstruction_mm, 2)} mm`} />
      <PropRow label="Dist. to Tool Interf." value={`${fmtNum(slide.distance_to_tool_interference_mm, 2)} mm`} />
      <PropRow label="Is Feasible"           value={fmtBool(slide.is_feasible)} />
      <PropRow label="Feasible for Fillet"   value={fmtBool(slide.is_feasible_for_fillet)} />
      <PropRow label="Parallel Tangent Edges" value={fmtBool(slide.has_parallel_tangent_edges)} />
      <PropRow label="Dist. Shadow Border"   value={`${fmtNum(slide.distance_to_solid_shadow_border_mm, 2)} mm`} />
      <PropRow label="Parting Proj. Start"   value={slide.parting_projection_start_mm ? `(${fmtNum(slide.parting_projection_start_mm.x, 2)}, ${fmtNum(slide.parting_projection_start_mm.y, 2)}) mm` : "—"} />
      <PropRow label="Parting Proj. End"     value={slide.parting_projection_end_mm ? `(${fmtNum(slide.parting_projection_end_mm.x, 2)}, ${fmtNum(slide.parting_projection_end_mm.y, 2)}) mm` : "—"} />
      <PropRow label="Rect. Lower Left"      value={slide.rectangle_lower_left ? `(${fmtNum(slide.rectangle_lower_left.x, 2)}, ${fmtNum(slide.rectangle_lower_left.y, 2)})` : "—"} />
      <PropRow label="Rect. Upper Right"     value={slide.rectangle_upper_right ? `(${fmtNum(slide.rectangle_upper_right.x, 2)}, ${fmtNum(slide.rectangle_upper_right.y, 2)})` : "—"} />
      <PropRow label="Clearance Distance"    value={`${fmtNum(slide.clearance_distance_mm, 2)} mm`} />
      <PropRow label="Accessible Area"       value={`${fmtNum(slide.accessible_surface_area_mm2, 1)} mm²`} />
      <PropRow label="Has Blocked Volume"    value={fmtBool(slide.has_blocked_volume)} />
      <PropRow label="Oriented Box Center"   value={slide.oriented_box_center ? `(${fmtNum(slide.oriented_box_center.x, 2)}, ${fmtNum(slide.oriented_box_center.y, 2)}, ${fmtNum(slide.oriented_box_center.z, 2)})` : "—"} />
      <PropRow label="Largest Window Area"   value={`${fmtNum(slide.largest_window_area_mm2, 1)} mm²`} />
      <PropRow label="Largest Shadow Area"   value={`${fmtNum(slide.largest_shadow_area_mm2, 1)} mm²`} />
      <PropRow label="Shadow Depth"          value={`${fmtNum(slide.shadow_depth_mm, 2)} mm`} />
      <PropRow label="Draft Angle"           value={`${fmtNum(slide.draft_angle_deg, 1)}°`} />
      <PropRow label="Group ID"              value={slide.group_id} />
    </div>
  );
}

/** Matches aPriori's right-panel: "First / Second / ..." column layout */
function GCDProperties({ relation }: { relation: GCDRelation }) {
  return (
    <div className="space-y-0.5">
      <PropRow label="First"    value={relation.source_id} />
      <PropRow label="Second"   value={relation.target_id} />
      <PropRow label="Type"     value={<GCDTypeBadge type={relation.type} />} />
      <PropRow label="Distance" value={fmtNum(relation.distance_mm, 2, " mm")} />
      <PropRow label="Area"     value={fmtNum(relation.area_mm2, 1, " mm²")} />
      <PropRow label="Angle"    value={fmtNum(relation.angle_deg, 1, "°")} />
    </div>
  );
}

function FeatureNodeProperties({
  node,
  occurrenceIndex,
}: {
  node: FeatureNodeV2;
  occurrenceIndex: number;
}) {
  const occ = node.occurrences[occurrenceIndex];
  return (
    <div className="space-y-0.5">
      <PropRow label="Feature Type"   value={node.feature_type} />
      <PropRow label="ID"             value={node.id} />
      <PropRow label="Occurrences"    value={node.occurrences.length} />
      <PropRow label="Diameter"       value={`${fmtNum(node.diameter_mm, 2)} mm`} />
      <PropRow label="Radius"         value={`${fmtNum(node.radius_mm, 2)} mm`} />
      <PropRow label="Angle"          value={`${fmtNum(node.angle_deg, 1)}°`} />
      <PropRow label="Length"         value={`${fmtNum(node.length_mm, 2)} mm`} />
      <PropRow label="Depth"          value={`${fmtNum(node.depth_mm, 2)} mm`} />
      {occ && (
        <>
          <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border/40">
            Occurrence {occurrenceIndex + 1}
          </div>
          <PropRow label="Centroid"       value={`(${occ.centroid.map((v) => v.toFixed(1)).join(", ")}) mm`} />
          <PropRow label="Edge Clearance" value={`${fmtNum(occ.edge_clearance_mm, 2)} mm`} />
          <PropRow label="Nearest Hole"   value={`${fmtNum(occ.nearest_hole_distance_mm, 2)} mm`} />
          <PropRow label="Nearest Bend"   value={`${fmtNum(occ.nearest_bend_distance_mm, 2)} mm`} />
          <PropRow label="Local Density"  value={fmtNum(occ.local_feature_density, 0)} />
          <PropRow label="Bend Length"    value={`${fmtNum(occ.bend_length_mm, 2)} mm`} />
          <PropRow label="Bend Angle"     value={`${fmtNum(occ.bend_angle_deg, 1)}°`} />
          <PropRow label="L/D Ratio"      value={fmtNum(occ.ld_ratio, 2)} />
          <PropRow label="Tapped"         value={fmtBool(occ.tapped)} />
          {occ.spec && <PropRow label="Thread Spec" value={occ.spec} />}
          <PropRow label="Material Removed" value={`${fmtNum(occ.material_removed_mm3, 1)} mm³`} />
          {occ.risk_level && (
            <PropRow
              label="DFM Risk"
              value={
                <span
                  className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded font-medium",
                    occ.risk_level === "critical" && "bg-red-500/20 text-red-400",
                    occ.risk_level === "high"     && "bg-orange-500/20 text-orange-400",
                    occ.risk_level === "medium"   && "bg-yellow-500/20 text-yellow-400",
                    occ.risk_level === "low"      && "bg-emerald-500/20 text-emerald-400",
                  )}
                >
                  {occ.risk_level}
                </span>
              }
            />
          )}
        </>
      )}
    </div>
  );
}

// ── GCD section renderer ─────────────────────────────────────────────────────

function GCDRelationsSection({
  relations,
  expanded,
  toggle,
  selectedNode,
  setSelectedNode,
  onHighlightFaces,
}: {
  relations: GCDRelation[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedNode: SelectedNode | null;
  setSelectedNode: (n: SelectedNode) => void;
  onHighlightFaces?: (faceIds: number[]) => void;
}) {
  const byType = useMemo(() => {
    const map = new Map<GCDRelationType, GCDRelation[]>();
    for (const r of relations) {
      const bucket = map.get(r.type) ?? [];
      bucket.push(r);
      map.set(r.type, bucket);
    }
    return map;
  }, [relations]);

  return (
    <TreeSection
      id="gcd"
      label="GCD Relations"
      count={relations.length}
      expanded={expanded}
      onToggle={toggle}
      indent
    >
      {GCD_ORDER.map((type) => {
        const rels = byType.get(type) ?? [];
        const isEmpty = rels.length === 0;
        return (
          <TreeSection
            key={type}
            id={`gcd_${type}`}
            label={GCD_LABELS[type]}
            count={rels.length}
            expanded={expanded}
            onToggle={toggle}
            indent
            dim={isEmpty}
          >
            {rels.map((rel, i) => {
              const sub = [
                rel.distance_mm != null ? `${rel.distance_mm.toFixed(1)} mm` : null,
                rel.area_mm2    != null ? `${rel.area_mm2.toFixed(0)} mm²` : null,
                rel.angle_deg   != null ? `${rel.angle_deg.toFixed(1)}°` : null,
              ].filter(Boolean).join(" · ");
              return (
                <TreeLeaf
                  key={i}
                  label={`${rel.source_id} — ${rel.target_id}`}
                  sub={sub || undefined}
                  selected={selectedNode?.kind === "gcd" && selectedNode.relation === rel}
                  onClick={() => {
                    setSelectedNode({ kind: "gcd", relation: rel });
                    if (rel.face_ids && rel.face_ids.length > 0) {
                      onHighlightFaces?.(rel.face_ids);
                    }
                  }}
                  indent={3}
                />
              );
            })}
            {isEmpty && (
              <div className="py-0.5 text-muted-foreground text-[10px]" style={{ paddingLeft: "56px" }}>
                No relations
              </div>
            )}
          </TreeSection>
        );
      })}
    </TreeSection>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function FeatureAnalysisPanel({
  fg,
  componentFeatures,
  family,
  onSelectFeature,
  selectedFeatureId,
}: FeatureAnalysisPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        "component",
        "base_props",
        "component_1",
        "blank",
        "setup_axes",
        "bending",
        "holes",
        "surfaces",
      ]),
  );
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectFeature = (node: FeatureNodeV2, occIdx: number) => {
    setSelectedNode({ kind: "feature", node, occurrenceIndex: occIdx });
    onSelectFeature(node, occIdx);
  };

  // Build a synthetic FeatureNodeV2 from raw face IDs so the 3D viewer can
  // highlight the two faces that form an adjacent GCD pair.
  const highlightFaces = useCallback(
    (faceIds: number[]) => {
      onSelectFeature(
        {
          id: `gcd_faces_${faceIds.join("_")}`,
          feature_type: "hole", // arbitrary — viewer only reads occurrences[].face_ids
          occurrences: [{ centroid: [0, 0, 0] as [number, number, number], face_ids: faceIds }],
        },
        0,
      );
    },
    [onSelectFeature],
  );

  const clearSelection = () => {
    setSelectedNode(null);
    onSelectFeature(null);
  };

  // Partition feature_graph_v2 by type
  const v2Features = useMemo(() => fg?.feature_graph_v2?.features ?? [], [fg]);
  const bendNodes  = useMemo(() => v2Features.filter((f) => f.feature_type === "bend"), [v2Features]);
  const holeNodes  = useMemo(() => v2Features.filter((f) => f.feature_type === "hole"), [v2Features]);
  const flatNodes  = useMemo(
    () => v2Features.filter((f) => (f.feature_type as string) === "flat_pattern"),
    [v2Features],
  );
  const otherNodes = useMemo(
    () => v2Features.filter((f) => !["bend", "hole", "flat_pattern"].includes(f.feature_type as string)),
    [v2Features],
  );

  const hasAnyData = fg || componentFeatures;

  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
        <span className="text-[11px] text-muted-foreground">
          Upload a STEP file and run analysis to see aPriori-style feature decomposition.
        </span>
      </div>
    );
  }

  // Component status: ok if any setup axis is feasible, warning if all blocked
  const componentStatus: NodeStatus = componentFeatures
    ? componentFeatures.setup_axes_candidates.some((s) => s.is_feasible)
      ? "ok"
      : "warning"
    : "ok";

  // Accumulate bend occurrence index across all bend nodes for labelling
  let bendIdx = 0;

  return (
    <div className="flex flex-col h-full overflow-hidden text-[11px]">

      {/* ── Feature tree ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ─ COMPONENT ─ */}
        {componentFeatures && (
          <TreeSection
            id="component"
            label="Component"
            status={componentStatus}
            expanded={expanded}
            onToggle={toggle}
            badge={
              family ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/30">
                  {FAMILY_LABELS[family] ?? family}
                </span>
              ) : undefined
            }
          >

            {/* ── Base Properties → Component:1 → GCD Relations ── */}
            <TreeSection
              id="base_props"
              label="Base Properties"
              count={1}
              expanded={expanded}
              onToggle={toggle}
              indent
            >
              {/* Component:1 is expandable — GCD Relations lives inside it */}
              <TreeSection
                id="component_1"
                label="Component:1"
                expanded={expanded}
                onToggle={toggle}
                onSelect={() => setSelectedNode({ kind: "base_props" })}
                indent
              >
                {/* Sub-label for Component:1 */}
                <div
                  className="px-3 py-0.5 text-[10px] text-muted-foreground"
                  style={{ paddingLeft: "44px" }}
                >
                  {[
                    family ? (FAMILY_LABELS[family] ?? family) : null,
                    `${fmtNum(componentFeatures.blank.volume_mm3, 1)} mm³`,
                    `${v2Features.length} features`,
                  ].filter(Boolean).join(" · ")}
                </div>

                {/* GCD Relations — nested directly inside Component:1 */}
                <GCDRelationsSection
                  relations={componentFeatures.gcd_relations}
                  expanded={expanded}
                  toggle={toggle}
                  selectedNode={selectedNode}
                  setSelectedNode={setSelectedNode}
                  onHighlightFaces={highlightFaces}
                />
              </TreeSection>
            </TreeSection>

            {/* ── Blank ── */}
            <TreeSection
              id="blank"
              label="Blank"
              count={1}
              status="ok"
              expanded={expanded}
              onToggle={toggle}
              indent
            >
              {/* blank_1 leaf — expandable for Edges sub-tree */}
              <TreeSection
                id="blank_1"
                label="blank_1"
                expanded={expanded}
                onToggle={toggle}
                onSelect={() => setSelectedNode({ kind: "blank" })}
                indent
              >
                <div
                  className="px-3 py-0.5 text-[10px] text-muted-foreground"
                  style={{ paddingLeft: "44px" }}
                >
                  {`${fmtNum(componentFeatures.blank.area_mm2, 1)} mm² · ${fmtNum(componentFeatures.blank.volume_mm3, 1)} mm³`}
                </div>

                {/* Blank Edges */}
                {componentFeatures.blank.edge_segments.length > 0 && (
                  <TreeSection
                    id="blank_edges"
                    label="Edges"
                    count={componentFeatures.blank.edge_segments.length}
                    expanded={expanded}
                    onToggle={toggle}
                    indent
                  >
                    {componentFeatures.blank.edge_segments.map((seg) => (
                      <TreeLeaf
                        key={seg.id}
                        label={seg.id}
                        sub={`${fmtNum(seg.length_mm, 1)} mm`}
                        selected={false}
                        onClick={() => {}}
                        indent={3}
                      />
                    ))}
                  </TreeSection>
                )}
              </TreeSection>
            </TreeSection>

            {/* ── Main Surface ── */}
            <TreeSection
              id="main_surfaces"
              label="Main Surface"
              count={componentFeatures.main_surfaces.length}
              expanded={expanded}
              onToggle={toggle}
              indent
            >
              {componentFeatures.main_surfaces.map((s) => (
                <TreeLeaf
                  key={s.id}
                  label={s.id}
                  sub={`${fmtNum(s.area_mm2, 1)} mm²${s.is_primary ? " · blank face" : ""}`}
                  selected={selectedNode?.kind === "surface" && selectedNode.surface.id === s.id}
                  onClick={() => setSelectedNode({ kind: "surface", surface: s })}
                  indent={2}
                />
              ))}
            </TreeSection>

            {/* ── Setup Axes / Candidates ── */}
            <TreeSection
              id="setup_axes"
              label="Setup Axes/Candidates"
              count={componentFeatures.setup_axes_candidates.length}
              expanded={expanded}
              onToggle={toggle}
              indent
            >
              {componentFeatures.setup_axes_candidates.map((slide, idx) => (
                <TreeLeaf
                  key={slide.id}
                  label={`SetupAxis:${idx + 1}`}
                  sub={`${slide.direction_label} · reach ${fmtNum(slide.tool_reach_mm, 1)} mm`}
                  status={slide.is_feasible ? "ok" : "blocked"}
                  badge={<SlideFeasibilityBadge slide={slide} />}
                  selected={selectedNode?.kind === "setup_axis" && selectedNode.slide.id === slide.id}
                  onClick={() => setSelectedNode({ kind: "setup_axis", slide })}
                  indent={2}
                />
              ))}
            </TreeSection>

            {/* ── Sides ── */}
            <TreeSection
              id="sides"
              label="Sides"
              count={2}
              expanded={expanded}
              onToggle={toggle}
              indent
            >
              <TreeLeaf
                label={`Inside (${componentFeatures.sides.inside.length})`}
                selected={selectedNode?.kind === "sides_inside"}
                onClick={() => setSelectedNode({ kind: "sides_inside" })}
                indent={2}
              />
              <TreeLeaf
                label={`Outside (${componentFeatures.sides.outside.length})`}
                selected={selectedNode?.kind === "sides_outside"}
                onClick={() => setSelectedNode({ kind: "sides_outside" })}
                indent={2}
              />
            </TreeSection>

            {/* ── Divider ── */}
            {(bendNodes.length > 0 || holeNodes.length > 0 || flatNodes.length > 0 || otherNodes.length > 0) && (
              <div className="mx-2 my-1 border-t border-border/30" />
            )}

            {/* ── Bending / Forming (inside Component) ── */}
            {bendNodes.length > 0 && (
              <TreeSection
                id="bending"
                label="Bending / Forming"
                count={bendNodes.reduce((s, n) => s + n.occurrences.length, 0)}
                expanded={expanded}
                onToggle={toggle}
                indent
              >
                {bendNodes.flatMap((node) =>
                  node.occurrences.map((occ, i) => {
                    bendIdx += 1;
                    const label = `straightBend_${bendIdx}`;
                    const sub = [
                      node.radius_mm != null ? `R${node.radius_mm.toFixed(1)} mm` : null,
                      occ.bend_angle_deg != null
                        ? `${occ.bend_angle_deg.toFixed(0)}°`
                        : node.angle_deg != null
                        ? `${node.angle_deg.toFixed(0)}°`
                        : null,
                      occ.bend_length_mm != null ? `${occ.bend_length_mm.toFixed(1)} mm` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <TreeLeaf
                        key={`${node.id}_${i}`}
                        label={label}
                        sub={sub || undefined}
                        selected={
                          selectedFeatureId === node.id &&
                          selectedNode?.kind === "feature" &&
                          selectedNode.occurrenceIndex === i
                        }
                        onClick={() => selectFeature(node, i)}
                        indent={2}
                      />
                    );
                  }),
                )}
              </TreeSection>
            )}

            {/* ── Holes (inside Component) ── */}
            {holeNodes.length > 0 && (
              <TreeSection
                id="holes"
                label="Holes"
                count={holeNodes.reduce((s, n) => s + n.occurrences.length, 0)}
                expanded={expanded}
                onToggle={toggle}
                indent
              >
                {holeNodes.flatMap((node) => {
                  const isComplex = (node.diameter_mm ?? 0) > 10;
                  return node.occurrences.map((occ, i) => {
                    const label = isComplex ? `complexHole_${i + 1}` : `simpleHole_${i + 1}`;
                    const sub = [
                      node.diameter_mm != null ? `Ø${node.diameter_mm.toFixed(1)}` : null,
                      occ.tapped ? "tapped" : null,
                      occ.spec ?? null,
                      occ.depth_mm != null ? `${occ.depth_mm.toFixed(1)} mm deep` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <TreeLeaf
                        key={`${node.id}_${i}`}
                        label={label}
                        sub={sub || undefined}
                        selected={
                          selectedFeatureId === node.id &&
                          selectedNode?.kind === "feature" &&
                          selectedNode.occurrenceIndex === i
                        }
                        onClick={() => selectFeature(node, i)}
                        indent={2}
                      />
                    );
                  });
                })}
              </TreeSection>
            )}

            {/* ── Surfaces (inside Component) ── */}
            {flatNodes.length > 0 && (
              <TreeSection
                id="surfaces"
                label="Surfaces"
                count={flatNodes.length}
                expanded={expanded}
                onToggle={toggle}
                indent
              >
                {flatNodes.map((node, i) => (
                  <TreeLeaf
                    key={node.id}
                    label={`Flat Pattern ${i + 1}`}
                    sub={componentFeatures ? `${fmtNum(componentFeatures.blank.area_mm2, 1)} mm²` : undefined}
                    selected={selectedFeatureId === node.id}
                    onClick={() => selectFeature(node, 0)}
                    indent={2}
                  />
                ))}
              </TreeSection>
            )}

            {/* ── Other (inside Component) ── */}
            {otherNodes.length > 0 && (
              <TreeSection
                id="other"
                label="Other"
                count={otherNodes.reduce((s, n) => s + n.occurrences.length, 0)}
                expanded={expanded}
                onToggle={toggle}
                indent
              >
                {otherNodes.flatMap((node) =>
                  node.occurrences.map((_, i) => (
                    <TreeLeaf
                      key={`${node.id}_${i}`}
                      label={`${node.feature_type}_${i + 1}`}
                      selected={selectedFeatureId === node.id}
                      onClick={() => selectFeature(node, i)}
                      indent={2}
                    />
                  )),
                )}
              </TreeSection>
            )}

          </TreeSection>
        )}

        {/* Empty state when feature graph exists but no component features */}
        {fg && v2Features.length === 0 && !componentFeatures && (
          <div className="p-4 text-center text-muted-foreground">
            <span className="text-[11px]">No features extracted yet.</span>
            <br />
            <span className="text-[10px]">Re-analyze to populate the feature tree.</span>
          </div>
        )}
      </div>

      {/* ── Properties panel ── */}
      {selectedNode && (
        <div className="border-t bg-background shrink-0 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/10 sticky top-0 z-10">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Properties
            </span>
            <button
              onClick={clearSelection}
              className="text-muted-foreground hover:text-foreground text-[10px] px-1 leading-none"
            >
              ✕
            </button>
          </div>
          <div className="p-2 text-[10px]">
            {selectedNode.kind === "base_props" && componentFeatures && (
              <div className="space-y-0.5">
                <PropRow label="Family"        value={family ? (FAMILY_LABELS[family] ?? family) : "—"} />
                <PropRow label="Volume"        value={`${fmtNum(componentFeatures.blank.volume_mm3, 2)} mm³`} />
                <PropRow label="Blank Area"    value={`${fmtNum(componentFeatures.blank.area_mm2, 1)} mm²`} />
                <PropRow label="Features"      value={v2Features.length} />
                <PropRow label="Setup Axes"    value={componentFeatures.setup_axes_candidates.length} />
                <PropRow label="GCD Relations" value={componentFeatures.gcd_relations.length} />
              </div>
            )}
            {selectedNode.kind === "blank" && componentFeatures && (
              <BlankProperties blank={componentFeatures.blank} />
            )}
            {selectedNode.kind === "surface" && (
              <SurfaceProperties surface={selectedNode.surface} />
            )}
            {selectedNode.kind === "setup_axis" && (
              <SetupAxisProperties slide={selectedNode.slide} />
            )}
            {selectedNode.kind === "gcd" && (
              <GCDProperties relation={selectedNode.relation} />
            )}
            {selectedNode.kind === "feature" && (
              <FeatureNodeProperties
                node={selectedNode.node}
                occurrenceIndex={selectedNode.occurrenceIndex}
              />
            )}
            {(selectedNode.kind === "sides_inside" || selectedNode.kind === "sides_outside") &&
              componentFeatures && (
                <div className="space-y-0.5">
                  <PropRow
                    label="Side"
                    value={selectedNode.kind === "sides_inside" ? "Inside" : "Outside"}
                  />
                  <PropRow
                    label="Feature Count"
                    value={
                      selectedNode.kind === "sides_inside"
                        ? componentFeatures.sides.inside.length
                        : componentFeatures.sides.outside.length
                    }
                  />
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
