"use client";

import { useMemo, useState, type ReactNode } from "react";

import { CastingPartViewer } from "@/components/features/casting-viewer/CastingPartViewer";
import { DrawDirectionControl } from "@/components/features/casting-viewer/DrawDirectionControl";
import type { DfmFinding, SandDfmView } from "@/lib/api/casting-analyses";
import {
  useCastingAnalyses,
  useCastingAnalysisDetail,
  useCastingMeshUrl,
  useDrawDirection,
  useRequestCastingAnalysis,
  useSandDfm,
} from "@/lib/api/hooks/useCastingAnalyses";
import { analysisState, isReady } from "@/lib/casting/analysis-view";
import { castingFeatureProperties, groupCastingFeatures } from "@/lib/casting/features";
import { castingPartView } from "@/lib/casting/result-view";
import {
  gatingSolids,
  toGlbShape,
  type SandGatingLayout,
} from "@/lib/casting/gating-layout";
import {
  OVERLAYS,
  OVERLAY_COLORS,
  overlayFaceColors,
  type OverlayKind,
} from "@/lib/casting/face-overlay";

const SEVERITY_CLASS: Record<DfmFinding["severity"], string> = {
  Critical: "bg-red-500/15 text-red-600 border-red-500/30",
  Major: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  Minor: "bg-sky-500/15 text-sky-600 border-sky-500/30",
};

/**
 * The Features of a sand-cast part, from its casting analysis: the worker's own mesh with the selected feature, the features grouped as the
 * die-casting tree groups them, and the design-for-casting checks. Until there is a finished analysis, `fallback` (the cad-engine's features) is
 * shown, labelled as such, with the request button; an unmeasured part is never shown as having passed.
 */
export function SandCastingFeaturesPanel({
  itemId,
  fallback,
  gating = null,
}: {
  itemId: string;
  fallback: ReactNode;
  /** The designed gating system and risers from the cost summary: drawn around the part as a schematic. */
  gating?: SandGatingLayout | null;
}) {
  const list = useCastingAnalyses(itemId);
  const direction = useDrawDirection(itemId);
  const request = useRequestCastingAnalysis(itemId);
  const ready = list.data?.find((a) => isReady(a.status));
  const detail = useCastingAnalysisDetail(ready?.id);
  const view = useMemo(
    () => (detail.data ? castingPartView(detail.data.result) : null),
    [detail.data],
  );
  const part = view && !("reason" in view) ? view : null;
  const partMesh = useCastingMeshUrl(ready?.id, part?.glb);
  const coresMesh = useCastingMeshUrl(ready?.id, part?.coresGlb);
  const dfm = useSandDfm(itemId, ready?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCores, setShowCores] = useState(true);
  const [showParting, setShowParting] = useState(true);
  const [showGating, setShowGating] = useState(true);
  const [overlay, setOverlay] = useState<OverlayKind | "">("");
  const [selectedFaces, setSelectedFaces] = useState<number[] | null>(null);

  if (!ready || !part) {
    const state = analysisState(list.data, Date.now());
    return (
      <>
        <div className="mx-1 mb-1 rounded border border-border/60 bg-muted/30 p-2 text-[10px]">
          <div className="font-medium text-foreground">
            Casting analysis: {state.label}
          </div>
          {view && "reason" in view && (
            <div className="text-muted-foreground">{view.reason}</div>
          )}
          {state.detail && <div className="text-muted-foreground">{state.detail}</div>}
          <div className="text-muted-foreground">
            The features below are the cad-engine&apos;s, not the exact ones of the
            casting analysis.
          </div>
          {direction.data?.axis && (
            <div className="mt-1">
              <DrawDirectionControl
                itemId={itemId}
                direction={direction.data}
                autoAxis={null}
              />
            </div>
          )}
          {state.requestLabel && (
            <button
              type="button"
              disabled={request.isPending}
              onClick={() => {
                request.mutate();
              }}
              className="mt-1 rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              {request.isPending ? "Requesting…" : state.requestLabel}
            </button>
          )}
        </div>
        {fallback}
      </>
    );
  }

  const groups = groupCastingFeatures(part.features);
  // The designed system is laid out in the part's own coordinates (its box, draw axis and parting height from the same analysis), then into the viewer's frame.
  const gatingShapes =
    gating && part.box && part.drawAxis
      ? gatingSolids(
          gating,
          part.box.min,
          part.box.max,
          part.drawAxis,
          part.partingHeight,
        ).map(toGlbShape)
      : [];
  // A feature picked in the tree, or the faces of a design finding picked in the list (a finding about faces, such as a draft angle, has no feature).
  const selected = part.features.find((f) => f.id === selectedId) ?? null;
  const highlighted =
    selected ?? (selectedFaces ? { id: "faces", faces: selectedFaces, edges: [] } : null);
  // An overlay: each measured face coloured by what the design check found about it (draft angle, thin wall); nothing until the checks are read.
  const measuredBy: Record<OverlayKind, number[]> = {
    draft: part.draftFaces,
    wall: part.wallFaces,
  };
  const overlays = (Object.keys(OVERLAYS) as OverlayKind[]).filter(
    (k) => measuredBy[k].length > 0,
  );
  const faceColors =
    overlay && dfm.data?.result
      ? overlayFaceColors(overlay, dfm.data.result.findings, measuredBy[overlay])
      : null;
  const selectedRow = selected
    ? { feature: selected, label: selected.id, parent: selected.parent }
    : null;

  return (
    <div className="space-y-2 px-1 text-[10px]">
      <div className="h-64 overflow-hidden rounded border border-border/60">
        {partMesh.data ? (
          <CastingPartViewer
            partUrl={partMesh.data.url}
            coresUrl={coresMesh.data?.url ?? null}
            glbFaces={part.glbFaces}
            feature={highlighted}
            partingPoints={part.partingPoints}
            showCores={showCores}
            showParting={showParting}
            gating={gatingShapes}
            showGating={showGating}
            faceColors={faceColors}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {partMesh.isError
              ? "The 3D model of the analysis could not be loaded."
              : "Loading 3D model…"}
          </div>
        )}
      </div>
      <div className="flex gap-3 text-muted-foreground">
        {part.coresGlb && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showCores}
              onChange={(e) => {
                setShowCores(e.target.checked);
              }}
            />
            Cores
          </label>
        )}
        {part.partingPoints && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={showParting}
              onChange={(e) => {
                setShowParting(e.target.checked);
              }}
            />
            Parting line
          </label>
        )}
        {overlays.length > 0 && dfm.data?.result && (
          <label
            className="flex items-center gap-1"
            title={
              overlay
                ? OVERLAYS[overlay].title
                : "Colour the model face by face by a design check: draft angle or thin walls."
            }
          >
            Overlay
            <select
              value={overlay}
              onChange={(e) => {
                setOverlay(e.target.value as OverlayKind | "");
              }}
              className="rounded border border-border bg-background px-1 py-0.5"
            >
              <option value="">off</option>
              {overlays.map((k) => (
                <option key={k} value={k}>
                  {OVERLAYS[k].label}
                </option>
              ))}
            </select>
            {overlay && (
              <span className="flex items-center gap-1 text-[9px]">
                {(overlay === "draft"
                  ? (["Critical", "Major", "ok"] as const)
                  : (["Major", "ok"] as const)
                ).map((k) => (
                  <span key={k} className="flex items-center gap-0.5">
                    <i
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: OVERLAY_COLORS[k] }}
                    />
                    {k === "ok"
                      ? "fine"
                      : k === "Major" && overlay === "wall"
                        ? "too thin"
                        : k.toLowerCase()}
                  </span>
                ))}
              </span>
            )}
          </label>
        )}
        {gatingShapes.length > 0 && (
          <label
            className="flex items-center gap-1"
            title="The gating system and risers the route designed (sprue, well, runner, ingates, risers), laid out at the parting plane. A schematic placement: the part's CAD holds none of it."
          >
            <input
              type="checkbox"
              checked={showGating}
              onChange={(e) => {
                setShowGating(e.target.checked);
              }}
            />
            Gating (designed)
          </label>
        )}
        {part.drawAxis && (
          <span className="ml-auto">
            Draw axis: {part.drawAxis.toUpperCase()}
            {part.drawAxisSource === "requested" ? " (fixed)" : ""}
          </span>
        )}
      </div>

      <DrawDirectionControl
        itemId={itemId}
        direction={direction.data}
        autoAxis={part.drawAxisSource === "auto" ? part.drawAxis : null}
      />

      <Group title="Casting features (exact, from the casting analysis)">
        {groups.length === 0 && (
          <p className="text-muted-foreground">The analysis recognised no features.</p>
        )}
        {groups.map((c) => (
          <div key={c.key} className="border-t border-border/40 pt-0.5">
            <div className="flex justify-between font-medium text-foreground">
              <span>{c.label}</span>
              <span className="tabular-nums text-muted-foreground">{c.count}</span>
            </div>
            {c.types.map((t) => (
              <div key={t.type} className="pl-3">
                <div className="text-foreground">
                  {t.type}{" "}
                  <span className="text-muted-foreground">[{t.rows.length}]</span>
                </div>
                <div className="space-y-0.5 pl-3">
                  {t.rows.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => {
                        setSelectedFaces(null);
                        setSelectedId(selectedId === r.label ? null : r.label);
                      }}
                      className={`block w-full truncate rounded px-1 py-0.5 text-left font-mono ${selectedId === r.label ? "bg-primary/10 ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted/40"}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Group>

      {selectedRow && (
        <Group title={`Properties — ${selectedRow.label}`}>
          <div className="divide-y divide-border/30">
            {castingFeatureProperties(selectedRow).map((p) => (
              <div key={p.name} className="flex gap-2 py-0.5">
                <span className="w-28 shrink-0 text-muted-foreground">{p.name}</span>
                <span className="break-all font-mono text-foreground">{p.value}</span>
              </div>
            ))}
          </div>
        </Group>
      )}

      <DfmGroup
        dfm={dfm.data}
        loading={dfm.isLoading}
        failed={dfm.isError}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedFaces(null);
          setSelectedId(id);
        }}
        selectedFaces={selectedFaces}
        onSelectFaces={(faces) => {
          setSelectedId(null);
          setSelectedFaces(faces);
        }}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-0.5">
      <h4 className="border-b border-border/60 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function DfmGroup({
  dfm,
  loading,
  failed,
  selectedId,
  onSelect,
  selectedFaces,
  onSelectFaces,
}: {
  dfm: SandDfmView | undefined;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** The faces of the finding picked in the list, for a finding about faces (a draft angle) that has no feature. */
  selectedFaces: number[] | null;
  onSelectFaces: (faces: number[] | null) => void;
}) {
  if (loading)
    return (
      <Group title="Design for casting">
        <p className="text-muted-foreground">Checking…</p>
      </Group>
    );
  if (failed || !dfm)
    return (
      <Group title="Design for casting">
        <p className="text-muted-foreground">
          The checks could not be read. Try again later.
        </p>
      </Group>
    );
  if (!dfm.result)
    return (
      <Group title="Design for casting">
        <p className="text-muted-foreground">{dfm.reasons.join(" ")}</p>
      </Group>
    );
  const { findings, passed, notEvaluated, rulesetVersion, materialType } = dfm.result;
  return (
    <Group title="Design for casting">
      <p className="text-muted-foreground">
        {findings.length === 0
          ? "No rule is violated by what the analysis measured."
          : `${findings.length} finding${findings.length === 1 ? "" : "s"}`}{" "}
        · {passed.length} passed · {notEvaluated.length} not evaluated ·{" "}
        {materialType ?? "no material type"} · rules {rulesetVersion}
      </p>
      {dfm.reasons.map((r) => (
        <p key={r} className="text-amber-600">
          {r}
        </p>
      ))}
      <div className="space-y-1">
        {findings.map((f, i) => {
          const featureId = f.featureIds[0] ?? null;
          // A finding is about a feature, or (a draft angle) about a face with no feature: either can be shown on the model.
          const facesKey =
            featureId == null && f.faces.length > 0 ? f.faces.join(",") : null;
          const isSelected =
            (featureId != null && selectedId === featureId) ||
            (facesKey != null && selectedFaces?.join(",") === facesKey);
          return (
            <button
              key={`${f.rule}:${featureId ?? facesKey ?? i}`}
              type="button"
              disabled={featureId == null && facesKey == null}
              onClick={() => {
                if (featureId) onSelect(selectedId === featureId ? null : featureId);
                else if (facesKey) onSelectFaces(isSelected ? null : f.faces);
              }}
              className={`block w-full rounded border px-1.5 py-1 text-left ${SEVERITY_CLASS[f.severity]} ${isSelected ? "ring-1 ring-primary/40" : ""}`}
            >
              <span className="font-semibold">{f.severity}</span> · {f.title || f.rule}
              {featureId ? ` · ${featureId}` : facesKey ? ` · face ${facesKey}` : ""}
              <span className="block font-mono text-foreground">
                {fmt(f.measured)} {f.comparison} {fmt(f.threshold)}
                {f.unit ? ` ${f.unit}` : ""}
              </span>
              {f.note && <span className="block text-muted-foreground">{f.note}</span>}
            </button>
          );
        })}
      </div>
      {notEvaluated.length > 0 && (
        <details className="pt-1">
          <summary className="cursor-pointer text-muted-foreground">
            Not evaluated ({notEvaluated.length})
          </summary>
          <ul className="space-y-0.5 pt-0.5">
            {notEvaluated.map((n) => (
              <li key={n.rule}>
                <span className="font-mono text-foreground">{n.rule}</span>{" "}
                <span className="text-muted-foreground">— {n.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Group>
  );
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
