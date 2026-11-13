// What an analysis's configuration means for the worker call, and the check that the worker did what was asked. Pure.
import { type CastingAnalysisConfig } from "./casting-analysis.types";

/**
 * The reserved name of the input that carries the draw axis. The sandboxed host passes inputs as plain files and nothing else, so the
 * axis travels as a file whose whole content is x, y or z; the worker image's adapter (casting-worker/host-adapter.sh) turns it into
 * --draw-axis and never hands it to the worker as a STEP file. The same name is in the adapter: keep them equal.
 */
export const DRAW_AXIS_INPUT = "draw-axis";
/** The STEP file's input name. */
export const PART_INPUT = "part.step";

export interface WorkerInput {
  name: string;
  bytes: Buffer;
}

/** The inputs of one worker run: the part, and the draw axis when an engineer fixed it. */
export function workerInputs(step: Buffer, config: CastingAnalysisConfig): WorkerInput[] {
  const inputs: WorkerInput[] = [{ name: PART_INPUT, bytes: step }];
  if (config.drawDirection !== "auto") {
    inputs.push({
      name: DRAW_AXIS_INPUT,
      bytes: Buffer.from(config.drawDirection, "utf8"),
    });
  }
  return inputs;
}

/**
 * Whether the worker's result is the one asked for: every part it measured (a part with no valid solid has no casting block) was
 * measured along the requested axis and says so; an automatic analysis must say it chose the axis itself. Returns what is wrong, or null.
 */
export function drawDirectionMismatch(
  result: unknown,
  config: CastingAnalysisConfig,
): string | null {
  const parts =
    (
      result as {
        parts?: Array<{
          casting?: { draw_axis?: unknown; draw_axis_source?: unknown } | null;
        }>;
      } | null
    )?.parts ?? [];
  for (const part of parts) {
    const c = part.casting;
    if (!c) continue;
    if (config.drawDirection === "auto") {
      if (c.draw_axis_source !== "auto")
        return `asked for the automatic draw axis, the worker reports "${String(c.draw_axis_source)}"`;
    } else if (
      c.draw_axis_source !== "requested" ||
      c.draw_axis !== config.drawDirection
    ) {
      return `asked for draw axis ${config.drawDirection}, the worker reports ${String(c.draw_axis)} (${String(c.draw_axis_source)})`;
    }
  }
  return null;
}

/**
 * Whether a casting worker will run the analyses: its socket is set (CASTING_WORKER_SOCKET) and the runner is not switched off
 * (CASTING_ANALYSIS_RUNNER=off). The runner polls only then, and only then does Apply wait for a casting analysis.
 */
export function castingWorkerAvailable(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return !!env.CASTING_WORKER_SOCKET && env.CASTING_ANALYSIS_RUNNER !== "off";
}
