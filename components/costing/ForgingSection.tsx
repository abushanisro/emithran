'use client';

import { Check } from 'lucide-react';

import { formatForming, shortReason, splitRouteLabel, type ForgingSummary } from '@/lib/costing/forging-view';

interface Props {
  forging: ForgingSummary | null | undefined;
  /** The part's own choices (unset: the data's default complexity, the cheapest complete route). */
  complexity: number | null;
  route: string | null;
  currency: string | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const money = (v: number, currency: string | null | undefined) => `${v.toFixed(2)}${currency ? ` ${currency}` : ''}`;

/**
 * The Cost Guide's forging settings: the part complexity, the route as a list (each route its price, or why it is not a route for this part),
 * and what the quoted route makes of the part.
 */
export function ForgingSection({ forging, complexity, route, currency, onChange }: Props) {
  const routes = forging?.options ?? [];
  const pick = (value: string | null) => { if (value !== route) onChange({ forgingRoute: value }); };
  return (
    <div className="space-y-3 text-xs">
      {/* The part complexity score sets the flash the forging carries and the pressure its finishing blow needs (memory/Forging
          partComplexityBasedData). Unset, the data's least score for a 3D part is used and the Cost tab says so. */}
      <label className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Part complexity <span className="text-muted-foreground/70">(1 simple, 12 complex)</span></span>
        <select
          value={complexity != null ? String(complexity) : ''}
          onChange={(e) => onChange({ forgingComplexity: e.target.value ? Number(e.target.value) : null })}
          className="w-28 border border-border rounded px-2 py-1 bg-background"
        >
          <option value="">{`Default (${forging?.complexity ?? 7})`}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      {forging && (
        <div>
          <div className="text-muted-foreground mb-1">Route</div>
          <div role="radiogroup" aria-label="Forging route" className="rounded border border-border divide-y divide-border overflow-hidden">
            <RouteRow selected={route == null} onSelect={() => pick(null)} title="The cheapest route that is fully costed is quoted.">
              <span className="font-medium text-foreground">Cheapest complete route</span>
              <span className="ml-auto text-muted-foreground">auto</span>
            </RouteRow>
            {routes.map((o) => {
              const { kind, machine } = splitRouteLabel(o.label);
              const priced = o.complete && o.totalCost != null;
              return (
                <RouteRow
                  key={o.route}
                  selected={route === o.route}
                  disabled={!priced}
                  onSelect={() => pick(o.route)}
                  title={priced ? `${o.label}: ${money(o.totalCost!, currency)} per part` : `${o.label}: ${o.reason ?? 'not fully costed'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className={priced ? 'text-foreground' : 'text-muted-foreground'}>{machine ?? kind}</span>
                    {machine && <span className="block text-[10px] text-muted-foreground truncate">{kind}</span>}
                    {!priced && <span className="block text-[10px] text-muted-foreground/80 truncate">{shortReason(o.reason) ?? 'not fully costed'}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {priced ? money(o.totalCost!, currency) : <span className="text-muted-foreground">not possible</span>}
                  </span>
                </RouteRow>
              );
            })}
          </div>
        </div>
      )}

      {forging && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-muted-foreground">Quoted</dt><dd className="text-foreground">{forging.routeLabel}</dd>
          <dt className="text-muted-foreground">Bar</dt><dd className="tabular-nums">Ø{forging.barDiameterMm} mm, {forging.multLengthMm} mm mults</dd>
          <dt className="text-muted-foreground">Heating</dt><dd>{forging.heating === 'induction' ? 'Induction' : 'Gas furnace'}</dd>
          <dt className="text-muted-foreground">Forming</dt><dd className="tabular-nums">{forging.hits} {forging.hits === 1 ? 'blow' : 'blows'}, {formatForming(forging.forming)}</dd>
          {forging.flash && <><dt className="text-muted-foreground">Flash land</dt><dd className="tabular-nums">{forging.flash.thicknessMm} × {forging.flash.widthMm} mm</dd></>}
        </dl>
      )}
    </div>
  );
}

function RouteRow({ selected, disabled, onSelect, title, children }: {
  selected: boolean; disabled?: boolean; onSelect: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      title={title}
      className={`w-full flex items-center gap-2 px-2 py-1.5 text-left ${selected ? 'bg-brand-500/10' : 'hover:bg-muted/40'} ${disabled ? 'cursor-not-allowed opacity-70 hover:bg-transparent' : ''}`}
    >
      <span className="w-3 shrink-0">{selected && <Check className="h-3 w-3 text-brand-500" />}</span>
      {children}
    </button>
  );
}
