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
}: {
  itemId: string;
  fallback: ReactNode;
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
  const selected = part.features.find((f) => f.id === selectedId) ?? null;
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
            feature={selected}
            partingPoints={part.partingPoints}
            showCores={showCores}
            showParting={showParting}
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
        onSelect={setSelectedId}
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
}: {
  dfm: SandDfmView | undefined;
  loading: boolean;
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
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
          return (
            <button
              key={`${f.rule}:${featureId ?? i}`}
              type="button"
              disabled={!featureId}
              onClick={() => {
                if (featureId) onSelect(selectedId === featureId ? null : featureId);
              }}
              className={`block w-full rounded border px-1.5 py-1 text-left ${SEVERITY_CLASS[f.severity]} ${featureId && selectedId === featureId ? "ring-1 ring-primary/40" : ""}`}
            >
              <span className="font-semibold">{f.severity}</span> · {f.title || f.rule}
              {featureId ? ` · ${featureId}` : ""}
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
