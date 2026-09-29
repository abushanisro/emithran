'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MHRRecord } from '@/lib/api/mhr';

// A machine's capability and process data, exactly as its HR Rates row holds
// it: the typed capability columns plus every entry of specs (the process
// data each memory/ machine file carries — press injection rate, platen size,
// mold efficiency, roll speeds, ...). Read-only; nothing here is computed or
// defaulted, and a field that is not on the record is not shown.

const TYPED: Array<{ key: keyof MHRRecord; label: string; unit?: string }> = [
  { key: 'maxTonnage', label: 'Clamp / press force', unit: 't' },
  { key: 'tieBarXMm', label: 'Tie-bar spacing horizontal', unit: 'mm' },
  { key: 'tieBarYMm', label: 'Tie-bar spacing vertical', unit: 'mm' },
  { key: 'shotCapacityGrams', label: 'Shot size (GPPS)', unit: 'g' },
  { key: 'minMoldHeightMm', label: 'Min mold height', unit: 'mm' },
  { key: 'maxMoldHeightMm', label: 'Max mold height', unit: 'mm' },
  { key: 'pressCycleTimeS', label: 'Dry cycle (mold open + close)', unit: 's' },
  { key: 'powerKw', label: 'Power', unit: 'kW' },
  { key: 'maxXMm', label: 'Max X', unit: 'mm' },
  { key: 'maxYMm', label: 'Max Y', unit: 'mm' },
  { key: 'maxZMm', label: 'Max Z', unit: 'mm' },
  { key: 'maxDiameterMm', label: 'Max diameter', unit: 'mm' },
  { key: 'maxLengthMm', label: 'Max length', unit: 'mm' },
  { key: 'maxThicknessMm', label: 'Max thickness', unit: 'mm' },
  { key: 'goodPartYield', label: 'Good part yield' },
  { key: 'avgUtilization', label: 'Average utilization' },
  { key: 'machinePowerKw', label: 'Installed power', unit: 'kW' },
  { key: 'machineLengthMm', label: 'Machine length', unit: 'mm' },
  { key: 'machineWidthMm', label: 'Machine width', unit: 'mm' },
  { key: 'machineLifeYr', label: 'Machine life', unit: 'yr' },
];

// "injection_rate_mm3_per_s" -> "Injection rate mm3 per s"
const labelOf = (key: string) => {
  const t = key.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const valueOf = (v: unknown) =>
  typeof v === 'boolean' ? (v ? 'Yes' : 'No')
    : typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : String(v);

export function MachineCapabilityCard({ record }: { record: MHRRecord }) {
  const typed = TYPED.filter((f) => record[f.key] != null && record[f.key] !== '');
  const specs = Object.entries(record.specs ?? {}).filter(([k, v]) => v != null && v !== '' && !/(^|_)source$/.test(k));
  const sources = Object.entries(record.specs ?? {}).filter(([k, v]) => /(^|_)source$/.test(k) && v).map(([, v]) => String(v));
  if (typed.length === 0 && specs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Capability &amp; process data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm">
          {typed.map((f) => (
            <div key={String(f.key)} className="flex justify-between gap-2 min-w-0">
              <span className="text-muted-foreground truncate">{f.label}</span>
              <span className="font-medium tabular-nums shrink-0">{valueOf(record[f.key])}{f.unit ? ` ${f.unit}` : ''}</span>
            </div>
          ))}
          {specs.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 min-w-0">
              <span className="text-muted-foreground truncate">{labelOf(k)}</span>
              <span className="font-medium tabular-nums shrink-0">{valueOf(v)}</span>
            </div>
          ))}
        </div>
        {(sources.length > 0 || record.capabilitySource) && (
          <p className="text-[11px] text-muted-foreground">
            Source: {[...new Set(sources)].join('; ') || 'machine record'}
            {record.capabilitySource ? ` · capability ${record.capabilitySource}` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
