/**
 * Formats a raw sm_reference_data.raw object (one machine's full
 * machine_library.json record) into labeled, grouped entries for read-only
 * display — replaces a "paste the JSON yourself" free-text field with the
 * real, sourced data, grouped by what part of the machine/process it
 * describes. Purely presentational: never edits or writes this data back.
 *
 * Keys arrive camelCase, not the snake_case they're stored as in Postgres —
 * every API response passes through the global TransformInterceptor
 * (backend/src/common/interceptors/transform.interceptor.ts), which
 * recursively snake_case -> camelCase's every plain object in the payload,
 * `raw`'s own keys included. Label/group logic below is written against
 * that camelCase shape, not the DB's original snake_case column names.
 */

export type MachineLibraryDetailGroup = {
  title: string;
  entries: { key: string; label: string; value: string }[];
};

// Fields already shown elsewhere in the dialog as their own real editable
// input (Basic Info / Costs / Labour / the dedicated Capability number
// fields) — skipped here so the same number/name isn't shown twice.
const ALREADY_SHOWN = new Set([
  'name', 'description', 'categoryDataNote',
  'laborRateUsdHr', 'directOverheadRateUsdHr', 'indirectOverheadRateUsdHr',
  'numberOfOperators', 'wageGradeName', 'machineCategory',
  'machinePriceUsd', 'setupTimeHr',
  // Injection Molding's real machine JSON (memory/Injection/machine/*.json)
  // names the same 4 fields above with a "UsdPerHr" suffix instead of
  // "UsdHr", plus its own primaryId duplicating name — same dedup intent.
  'primaryId', 'laborRateUsdPerHr', 'directOverheadRateUsdPerHr', 'indirectOverheadRateUsdPerHr',
]);

// camelCase key -> display label, for keys whose auto-generated label would
// otherwise come out awkward (acronyms, compound units).
const LABEL_OVERRIDES: Record<string, string> = {
  strokesPerMin: 'Strokes Per Minute',
  pressureNMm2: 'Pressure (N/mm²)',
  rapidTraverseRateMmMin: 'Rapid Traverse Rate (mm/min)',
  rollingSpeedMmS: 'Rolling Speed (mm/s)',
  nibbleRateCyclesMin: 'Nibble Rate (cycles/min)',
  punchRateCyclesMin: 'Punch Rate (cycles/min)',
  massCoeffHandlingTimeSKg: 'Mass Coeff Handling Time (s/kg)',
  perimeterAllowanceSPerMm: 'Perimeter Allowance (s/mm)',
  maxRpmRevMin: 'Max RPM (rev/min)',
  abrasiveFlowRateKgMin: 'Abrasive Flow Rate (kg/min)',
  machineManufacturerLocation: 'Reference Data Sourced From',
  isPreferred: 'Preferred Machine',
};

// Trailing camelCase word -> unit suffix to render in parens, e.g.
// "bedHeightMm" -> "Bed Height (mm)". Checked against the last split word.
const UNIT_SUFFIXES: Record<string, string> = {
  Mm: 'mm', S: 's', Kn: 'kN', Kw: 'kW', Hr: 'hr', Mpa: 'MPa', Min: 'min', Grams: 'g', Kg: 'kg', Usd: '$',
};

function splitCamel(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean);
}

function toLabel(key: string): string {
  if (LABEL_OVERRIDES[key]) return LABEL_OVERRIDES[key];
  let words = splitCamel(key);
  let unit: string | null = null;
  const last = words[words.length - 1] ?? '';
  if (UNIT_SUFFIXES[last]) {
    unit = UNIT_SUFFIXES[last];
    words = words.slice(0, -1);
  }
  words = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  let label = words.join(' ');
  if (unit) label += ` (${unit})`;
  return label;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ') || '-';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

// The rate/labour and machine-ownership inputs. These are skipped by default
// (ALREADY_SHOWN) because the MHR form renders them as real editable inputs —
// but on a COST surface nothing else shows them, and they are exactly the
// factors a quote is built from, so `includeCoreFields` opts them back in and
// these two groups give them a home.
const RATE_LABOUR_FIELDS = new Set([
  'laborRateUsdHr', 'laborRateUsdPerHr',
  'directOverheadRateUsdHr', 'directOverheadRateUsdPerHr',
  'indirectOverheadRateUsdHr', 'indirectOverheadRateUsdPerHr',
  'overheadMultiplier', 'numberOfOperators', 'laborTimeStandard',
  'wageGradeName', 'workCenterLaborRateFactor', 'setupTimeHr', 'specialToolSetupHr',
]);

const OWNERSHIP_FIELDS = new Set([
  'machinePriceUsd', 'machineLifeYr', 'machineUptimePct', 'avgUtilization',
  'goodPartYield', 'annualMaintenanceFactorPct', 'installationFactorPct',
  'salvageValueFactorPct', 'suppliesCostUsdYr', 'suppliesCostUsdPerHr',
  'footprintAllowanceFactor', 'machinePowerKw', 'powerWatts',
  'machineLengthMm', 'machineWidthMm', 'weightKg',
]);

function groupOf(key: string): string {
  const lower = key.toLowerCase();
  if (RATE_LABOUR_FIELDS.has(key)) return 'Rates & Labour';
  if (OWNERSHIP_FIELDS.has(key)) return 'Ownership & Economics';
  if (['machineCategory', 'isPreferred', 'machineManufacturerLocation', 'deNestingMethod', 'note'].includes(key)) {
    return 'Identity & Provenance';
  }
  if (lower.startsWith('maxthickness') || key === 'steelThicknessMm') return 'Thickness & Material Limits';
  if (/(bed[A-Z]|presstable|sheet[A-Z]|rollwidth|nominalsheet|shutheight|trimstrip|straightlength|maxsheet|maxpart)/.test(lower)) {
    return 'Geometry & Envelope';
  }
  if (/(costusd|tooloverlap|toolchangetime|toolsetup)/.test(lower)) return 'Tooling & Costs';
  if (/(cycletime|speed|rate|coeff|strokesper|prebend|nozzledelay|shuttletime)/.test(lower)) return 'Cycle Time & Speed';
  if (/(abrasive|orifice|mixingtube|pressurenmm2)/.test(lower)) return 'Waterjet Process';
  if (/(nibble|punchsize|numberoftoolstations)/.test(lower)) return 'Punch / Nibble Process';
  if (/(bendlength|formdepth|multipass|singlepass|radiustothickness|pairedform)/.test(lower)) return 'Bend / Form Process';
  if (/(pressforce|presscycle)/.test(lower)) return 'Press Process';
  return 'Other Process Parameters';
}

const GROUP_ORDER = [
  'Identity & Provenance',
  'Rates & Labour',
  'Ownership & Economics',
  'Geometry & Envelope',
  'Thickness & Material Limits',
  'Cycle Time & Speed',
  'Bend / Form Process',
  'Press Process',
  'Punch / Nibble Process',
  'Waterjet Process',
  'Tooling & Costs',
  'Other Process Parameters',
];

// Sheet Metal's machine_library.json rows are already flat. Injection
// Molding's real machine JSON (memory/Injection/machine/*.json) nests
// fields under accounting/time/rates/limits/other/yields/machine/
// bottomUpOverheadRateInputs/manufacturerInformation — this recurses those
// down to their leaf keys so the same grouping/labeling logic below handles
// both shapes with no per-domain branching. A no-op on an already-flat
// object. Leaf keys already follow this file's own camelCase+unit-suffix
// convention (laborRateUsdPerHr, clampingForceKn, ...), so no renaming is
// needed — only de-nesting.
function flattenRaw(raw: Record<string, any>): Record<string, any> {
  const flat: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flattenRaw(value));
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

/**
 * `alreadyShownElsewhere` lets a caller mark camelCase fields as "already
 * shown as a real editable number elsewhere on this page" (e.g.
 * maxXMm/maxYMm/maxTonnage) so this read-only dump doesn't duplicate them.
 */
export function groupMachineLibraryDetail(
  raw: Record<string, any> | null | undefined,
  alreadyShownElsewhere?: Record<string, number | string | undefined>,
  options?: {
    /**
     * Include the rate/labour and machine-ownership fields that ALREADY_SHOWN
     * suppresses by default. Those are hidden for the MHR form, which renders
     * each of them as its own editable input — but a cost surface shows none of
     * them, and they are precisely the factors the quote is built from. Default
     * false, so the existing caller is byte-for-byte unaffected.
     */
    includeCoreFields?: boolean;
  },
): MachineLibraryDetailGroup[] {
  if (!raw) return [];
  const extraSkip = new Set(
    Object.entries(alreadyShownElsewhere ?? {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k]) => k),
  );

  const byGroup = new Map<string, MachineLibraryDetailGroup>();
  const suppressed = options?.includeCoreFields
    // 'name'/'description'/'machineCategory' stay suppressed even then: the
    // caller already titles the panel with the machine name and category.
    ? new Set(['name', 'description', 'primaryId', 'categoryDataNote'])
    : ALREADY_SHOWN;

  for (const [key, value] of Object.entries(flattenRaw(raw))) {
    if (suppressed.has(key) || extraSkip.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    const group = groupOf(key);
    if (!byGroup.has(group)) byGroup.set(group, { title: group, entries: [] });
    byGroup.get(group)!.entries.push({ key, label: toLabel(key), value: formatValue(value) });
  }

  return GROUP_ORDER
    .map((g) => byGroup.get(g))
    .filter((g): g is MachineLibraryDetailGroup => !!g && g.entries.length > 0);
}
