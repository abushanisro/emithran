// Shared display formatters for the Workflow Builder's route/step surfaces.
//
// Every money value that reaches these helpers is already in the route
// comparison's own local currency (RouteComparisonDto.currency /
// currencySymbol — see useRouteComparison), so the symbol is ALWAYS passed in
// by the caller rather than hardcoded. The previous RouteTree.tsx hardcoded
// '$' for values the backend had already converted to the factory's local
// currency, which silently mislabelled every non-USD factory's numbers.

/** `—` for genuinely absent values — never a fabricated 0. */
export function fmtMoney(value: number | null | undefined, currencySymbol: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${currencySymbol}${value.toFixed(2)}`;
}

export function fmtRate(value: number | null | undefined, currencySymbol: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${currencySymbol}${value.toFixed(2)}/hr`;
}

export function fmtMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} min`;
}

/** Signed delta, e.g. `+$0.25` / `−$0.10`. `null` when either side is absent. */
export function fmtSignedMoney(delta: number | null | undefined, currencySymbol: string): string | null {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${currencySymbol}${Math.abs(delta).toFixed(2)}`;
}
