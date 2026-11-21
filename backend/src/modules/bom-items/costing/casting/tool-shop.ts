// A tool shop of the Digital Factory (memory Plastic Modeling/process, staged with source_version 2026-Plastic): its hourly rates and the
// tool steel it builds with by default. The die-casting and forging dies are priced at its rates (die-tooling.ts); so is a hydroform tool.
// Pure: the caller loads the staged rows.

export interface ToolShop {
  name: string;
  designUsdPerHr: number;
  machiningUsdPerHr: number;
  assemblyUsdPerHr: number;
  tryoutUsdPerHr: number;
  /** Its default tool material (defaultToolMaterialName), priced from the tool materials table. */
  toolSteel: { name: string; usdPerKg: number };
}

type Rows = Readonly<Record<string, readonly Record<string, unknown>[] | undefined>>;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The tool shop `name` from the staged digital_factory_settings_usa and digital_factory_tool_materials_usa rows; what it lacks, named. */
export function resolveToolShop(rows: Rows, name = 'Default'): { shop: ToolShop | null; missing: string[] } {
  const settings = (rows.digital_factory_settings_usa ?? []).find((r) => r.name === name);
  if (!settings) return { shop: null, missing: [`tool shop ${name} (digital_factory_settings_usa)`] };
  const missing: string[] = [];
  const rate = (field: string) => {
    const n = num(settings[field]);
    if (n == null || n <= 0) missing.push(`tool shop ${name}: ${field}`);
    return n ?? NaN;
  };
  const steelName = typeof settings.defaultToolMaterialName === 'string' ? settings.defaultToolMaterialName.trim() : '';
  const steel = (rows.digital_factory_tool_materials_usa ?? []).find((r) => r.name === steelName);
  const steelPrice = num(steel?.materialCostUsdPerKg);
  if (!steelName || steelPrice == null || steelPrice <= 0) missing.push(`tool shop ${name}: the price of its default tool material ${steelName || '(none named)'}`);
  const shop: ToolShop = {
    name, designUsdPerHr: rate('designRateUsdPerHr'), machiningUsdPerHr: rate('machiningRateUsdPerHr'),
    assemblyUsdPerHr: rate('assemblyRateUsdPerHr'), tryoutUsdPerHr: rate('tryoutRateUsdPerHr'),
    toolSteel: { name: steelName, usdPerKg: steelPrice ?? NaN },
  };
  return missing.length ? { shop: null, missing } : { shop, missing: [] };
}
