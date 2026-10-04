// Which die-casting process (High Pressure / Gravity) a die-cast part is quoted
// on (user decision 2026-10-04): the Cost Guide choice when set; otherwise the
// cheapest feasible one, comparing piece cost + die tooling per part. Pure.
// When any option's die cannot be amortised (no annual volume / production
// life, or tooling not priced), every option is compared on piece cost alone,
// so the comparison never puts one process's die cost against another's none.
//
// Feasible: the casting line is costed (alloy, machine fit and cycle all on
// file) and the part walls are within the process tblWallThickness row
// (wallFeasibility). An undecided wall check (no row, not measured) does not
// rule a process out; its detail says so.

import type { DieCastingProcessChoiceDto, DieCastingProcessOptionDto } from '../../dto/cost-breakdown.dto';
import { GDC_PROCESS } from './gdc-engine';
import { HPDC_PROCESS } from './hpdc-engine';

/** The die-casting processes a die-cast part is compared and quoted on. */
export const DIE_CASTING_PROCESSES = [HPDC_PROCESS, GDC_PROCESS] as const;

/** Route id of a die-casting process in the route comparison ("die-casting-gravity-die-casting"). */
export function dieCastingRouteId(process: string): string {
  return `die-casting-${process.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function chooseDieCastingProcess(
  options: readonly DieCastingProcessOptionDto[],
  override: string | null,
): DieCastingProcessChoiceDto {
  if (options.length === 0) throw new Error('chooseDieCastingProcess: no process options');
  const costed = options.filter((o) => o.pieceCost != null);
  const basis: DieCastingProcessChoiceDto['basis'] =
    costed.length > 0 && costed.every((o) => o.toolingPerPart != null) ? 'piece_and_tooling' : 'piece_only';
  // total = what is compared, on the one basis every option shares.
  const opts = options.map((o) => ({
    ...o,
    total: o.pieceCost == null ? null : basis === 'piece_and_tooling' ? o.pieceCost + o.toolingPerPart! : o.pieceCost,
  }));
  if (override && opts.some((o) => o.process === override)) {
    return { chosen: override, chosenBy: 'user', basis, options: opts };
  }
  const eligible = opts
    .filter((o) => o.feasible !== false && o.total != null)
    .sort((a, b) => a.total! - b.total!);
  if (eligible.length > 0) return { chosen: eligible[0]!.process, chosenBy: 'auto', basis, options: opts };
  return { chosen: opts[0]!.process, chosenBy: 'none_feasible', basis, options: opts };
}

/** The Cost Guide override key and its accepted values. */
export function resolveScenarioDieCastingProcess(
  scenarioOverrides: Record<string, unknown> | null | undefined,
  processes: readonly string[],
): string | null {
  const raw = scenarioOverrides?.['dieCastingProcess'];
  return typeof raw === 'string' && processes.includes(raw) ? raw : null;
}
