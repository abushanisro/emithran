// Live, read-only bridge between the real cost-engine lookup tables
// (backend/src/modules/bom-items/costing/sheet-metal-lookup.service.ts's
// sm_lookup_* tables — created by migrations 300/398/412-416) and the admin
// "Lookup Tables" dialog on the Process page, which previously only showed
// user-managed process_reference_tables rows (a completely separate system —
// the two had never been connected, which is why routes like "Cutting" and
// "Sheet Metal Fabrication" showed "No Reference Tables Yet" despite the
// engine actually having real lookup data for them).
//
// Keyed by (process_group, process_route) — NOT route name alone, since
// route names like "Inspection"/"Finishing" repeat across unrelated groups
// (Sheet Metal vs. Post Processing) and would otherwise leak the wrong
// tables into the wrong group's dialog.
//
// Each entry names a real sm_lookup_* table plus an optional row filter to
// scope a shared table (e.g. sm_lookup_op_setup_time, which holds rows for
// every operation) down to just the one relevant to this route.

export interface SmLookupBridgeEntry {
  table: string;
  displayName: string;
  description: string;
  filter?: { column: string; values: string[] };
  orderBy?: string;
  // ILIKE pattern(s) — e.g. '%laser%', or comma-separated for an OR match
  // like '%waterjet%,%oxyfuel%,%plasma%' — applied to sm_reference_data.key
  // only. Used exclusively by entries whose `table` is 'sm_reference_data',
  // to surface the staged reconciliation export (migrations 479+) relevant
  // to a route, without needing a hand-picked exact-match filter per topic.
  // A route with no genuinely matching staged data legitimately renders an
  // empty panel — that's an honest "nothing collected for this yet", not a
  // bug (user confirmed this is the desired behavior 2026-08-19).
  keyPattern?: string;
}

// sm_reference_data (migration 479) is internal staging, never a live
// cost-engine input — see its own table comment. Bridging it read-only into
// the Lookup Tables dialog (below) must never let it become editable through
// this generic table-update endpoint the way real sm_lookup_* tables are.
export const SM_LOOKUP_READONLY_TABLES = new Set(['sm_reference_data']);

export const SM_LOOKUP_BRIDGE: Record<string, Record<string, SmLookupBridgeEntry[]>> = {
  'Sheet Metal': {
    'Cutting': [
      {
        table: 'sm_lookup_waterjet_cut',
        displayName: 'Waterjet Cutting Speed',
        description: 'Cutting speed (mm/min), pierce time (sec), and kerf (mm) by material and thickness — migration 398',
        orderBy: 'material,thickness_mm',
      },
      {
        table: 'sm_lookup_waterjet_abrasive_rate',
        displayName: 'Waterjet Abrasive Consumption',
        description: 'Garnet abrasive consumption rate (kg/min of active cutting) by pump tier — migration 415',
      },
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Waterjet Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['waterjet'] },
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions waterjet, oxyfuel, or plasma — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%waterjet%,%oxyfuel%,%plasma%',
      },
    ],
    'Sheet Metal Fabrication': [
      {
        table: 'sm_lookup_turret_punch',
        displayName: 'Turret Punch Cycle-Time Params',
        description: 'Hits/min, nibble speed (mm/min), and tool-change time (sec) by thickness — migration 414',
        orderBy: 'thickness_mm',
      },
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Turret Punch Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['turret_punch'] },
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions turret, punch, or nibble — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%turret%,%punch%,%nibbl%',
      },
    ],
    'Laser Cutting': [
      {
        table: 'sm_lookup_laser_cut',
        displayName: 'Laser Cutting Speed',
        description: 'Cutting speed (m/min) and kerf (mm) by material, thickness, and laser power — migration 300',
        orderBy: 'material,thickness_mm',
      },
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Laser Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['fiber_laser'] },
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions laser — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%laser%',
      },
    ],
    'Bending/Floating /Forming': [
      {
        table: 'sm_lookup_manual_stroke',
        displayName: 'Press Brake Stroke Time',
        description: 'Manual stroke time (sec) by thickness, tonnage, and complexity — migration 300',
        orderBy: 'thickness_mm,tonnage',
      },
      {
        table: 'sm_lookup_tool_setup',
        displayName: 'Press Brake Tool Setup Time',
        description: 'Tool loading time (min) by tool length — migration 300',
        filter: { column: 'setup_type', values: ['brake'] },
      },
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Press Brake Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['press_brake'] },
      },
      // This route also hosts Stage Tool Forming/Deep Draw/Progressive
      // die/Offline Blank, whose real calculators ("Sheet Metal - Drawing/
      // Forming Manufacturing", "Sheet Metal - Stamping Manufacturing" —
      // migrations/calculators/047/051) are lookup-fed from the PRESS
      // variant of sm_lookup_tool_setup (Table 3A) and sm_lookup_handling_time
      // — a real dependency this bridge never surfaced before.
      {
        table: 'sm_lookup_tool_setup',
        displayName: 'Press Tool Setup Time (Drawing/Forming/Stamping)',
        description: 'Tool loading time (min) by tonnage — migration 300 (press variant, distinct rows from the brake variant above)',
        filter: { column: 'setup_type', values: ['press'] },
      },
      {
        table: 'sm_lookup_handling_time',
        displayName: 'Part Handling Time',
        description: 'Handling time (min) by part weight bracket — migration 300',
        orderBy: 'weight_max_kg',
      },
      {
        table: 'sm_lookup_roll_forming',
        displayName: 'Roll Forming Line Speed / Setup Time',
        description: 'Line speed (m/min) and tooling setup time (min) — migration 442',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions bend, draw, press, roll, form, or stamp — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%bend%,%draw%,%press%,%roll%,%form%,%stamp%',
      },
    ],
    // Migration 344 also seeded a SEPARATE 'Press Brake' route (Bend/Form/
    // Press Brake Bend — distinct rows from 'Bending/Floating /Forming''s own
    // 'Bend Brake' operation), but migration 369 maps both routes' bending
    // operations onto the SAME machine_class='press_brake' and therefore the
    // same "Sheet Metal - Bending Manufacturing" calculator — so this route's
    // real lookup dependencies are identical to the one above, not a
    // different table.
    'Press Brake': [
      {
        table: 'sm_lookup_manual_stroke',
        displayName: 'Press Brake Stroke Time',
        description: 'Manual stroke time (sec) by thickness, tonnage, and complexity — migration 300',
        orderBy: 'thickness_mm,tonnage',
      },
      {
        table: 'sm_lookup_tool_setup',
        displayName: 'Press Brake Tool Setup Time',
        description: 'Tool loading time (min) by tool length — migration 300',
        filter: { column: 'setup_type', values: ['brake'] },
      },
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Press Brake Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['press_brake'] },
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions bend or press — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%bend%,%press%',
      },
    ],
    // 'Forming' / 'Hole Extrusion (Burring)' (machine_class='hole_forming',
    // migration 404) resolves its own real forming-force physics via the
    // "Sheet Metal - Hole Extrusion (Burring)" calculator, then feeds the
    // tonnage it computes into this SAME stroke-time table — a real,
    // shared dependency with Press Brake, not a separate lookup table.
    'Forming': [
      {
        table: 'sm_lookup_manual_stroke',
        displayName: 'Hole Extrusion (Burring) Stroke Time',
        description: 'Manual stroke time (sec) by thickness, tonnage, and complexity — same table Press Brake uses, migration 300',
        orderBy: 'thickness_mm,tonnage',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions form, extrusion, or burr — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%form%,%extrus%,%burr%',
      },
    ],
    // 'Drilling' / 'Tapping' (machine_class='tapping') — cycle time itself is
    // real rigid-tapping physics (physics_key='tapping', migration 056), no
    // lookup table involved; only its per-batch setup time is lookup-sourced.
    'Drilling': [
      {
        table: 'sm_lookup_op_setup_time',
        displayName: 'Tapping Setup Time',
        description: 'Per-batch setup time (min) — migration 416',
        filter: { column: 'operation', values: ['tapping'] },
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions tap, drill, or hole — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%tap%,%drill%,%hole%',
      },
    ],
    'Finishing': [
      {
        table: 'sm_lookup_deburr_rate',
        displayName: 'Deburr Cycle-Time Rate',
        description: 'Manual deburr time (sec) per metre of cut edge and per pierce — migration 413',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions deburr, deslag, edge, or finish — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%deburr%,%deslag%,%edge%,%finish%',
      },
    ],
    'Inspection': [
      {
        table: 'sm_lookup_sampling_plan',
        displayName: 'AQL Sampling Plan',
        description: 'Sample quantity by batch-size range and complexity level — migration 300',
        orderBy: 'batch_size_from',
      },
      {
        table: 'sm_lookup_inspection_time',
        displayName: 'Per-Piece Inspection Time',
        description: 'Inspection time (min) by part complexity tier — migration 412',
        orderBy: 'complexity',
      },
      {
        table: 'inspection_operation_defaults',
        displayName: 'Feature Inspection Cycle Time',
        description: 'Cycle time (sec) per feature type and inspection method (visual/caliper/height_gauge/cmm) — migration 423',
        orderBy: 'feature,method',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions tolerance, inspection, sampling, aql, or cmm — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%tolerance%,%inspect%,%sampling%,%aql%,%cmm%',
      },
    ],
    // Real rate table is surface_treatment_rates (migrations 362/363), not an
    // sm_lookup_* table — bridged the same way regardless of naming, since
    // getSmLookupTables()/updateSmLookupRow() just take a table name. Not
    // filtered by treatment_type: an admin managing this route wants to see
    // every treatment's rate across every location in one place, the same
    // real table resolveSurfaceTreatmentDbRate() queries.
    'Surface Treatment': [
      {
        table: 'surface_treatment_rates',
        displayName: 'Surface Treatment Rates',
        description: 'Rate (USD/m²) and minimum lot charge (USD) by treatment type and location — migrations 362/363',
        orderBy: 'treatment_type,location',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions coating, plating, anodize, chromate, chem, or surface — read-only, not yet wired to a live calculator (migration 479+)',
        keyPattern: '%coating%,%plating%,%anodiz%,%chromate%,%chem%,%surface%',
      },
    ],
    // 'Gross Usage'/'Net Usage' (machine_class='sheet_metal_gross_usage_nesting'/
    // 'sheet_metal_net_usage') both resolve their "Material Density"/"Shear
    // Strength" calculator fields (field_type='database_lookup') from
    // raw_materials — the real live source, same table RawMaterialDialog.tsx
    // and the nesting engine query. raw_materials itself is NOT bridged
    // directly (512 rows x 72 columns, a shared master table used by every
    // process family, and every bridge payload here is unconditionally
    // row-editable — see migration 502's comment for why that combination is
    // unsafe for a narrow per-route admin dialog). Bridged via
    // sm_material_usage_reference (migration 502), a narrow read-only view
    // exposing only the two columns these calculators actually read. Route's
    // other real dependency — STANDARD_SHEETS, the candidate sheet sizes
    // Gross Usage evaluates — is a hardcoded TypeScript constant
    // (sheet-metal-nesting.engine.ts), not a DB table, so it cannot be
    // bridged here; noted for a future "make it database driven" pass, not
    // fixed in this migration.
    'Material Usage': [
      {
        table: 'sm_material_usage_reference',
        displayName: 'Material Density & Shear Strength',
        description: 'density_kg_m3 and shear_strength_mpa by material — the real live values Gross/Net Usage\'s "Material Density"/"Shear Strength" database-lookup fields resolve from (migration 502 view over raw_materials)',
        orderBy: 'material',
      },
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions material type or blank addendum — read-only, not yet wired to a live calculator (migration 479+). Deliberately narrow: broader terms like "material" or "sheet" would pull in unrelated cutting-rate data from other routes.',
        keyPattern: '%materialType%,%blankAddendum%',
      },
    ],
    // 'Raw Material' (Sheet/Flat/Coil/I-Beam/H-Beam/Angle/Channel/T-Sections/
    // Z-Sections) — checked once already (see project memory): every one of
    // these 9 operations has machine_class=NULL AND calculator_id=NULL in
    // process_calculator_mappings, a fully unwired taxonomy stub. Real
    // material costing runs through RawMaterialDialog.tsx/the nesting engine
    // directly, never through this calculator-mapping system — so unlike
    // Material Usage there is no real live sm_lookup_*/view dependency to
    // bridge here. Still gets a Reference Data panel per the "every route,
    // always show a panel" decision — this route was the one genuinely
    // missing an entry of ANY kind (not even blank), which is why the admin
    // UI's "Lookup Tables" link for it had nothing behind it at all.
    'Raw Material': [
      {
        table: 'sm_reference_data',
        displayName: 'Reference Data (Staged Import)',
        description: 'Staged reconciliation export rows whose key mentions material type — read-only, not yet wired to a live calculator (migration 479+). This route has no live sm_lookup_* dependency at all (see comment above); this panel is reference-only.',
        keyPattern: '%materialType%',
      },
    ],
  },
  // process_calculator_mappings (migration 381) seeds PEM Insertion under
  // group='Assembly', route='Hardware Insertion' — a genuinely different
  // group from 'Sheet Metal', not another Sheet Metal route.
  'Assembly': {
    'Hardware Insertion': [
      // machine_class='pem_press' — the "Sheet Metal - PEM Insertion"
      // calculator's Insertion Cycle Time field is lookup-driven
      // (sm_lookup_pem_hardware, migration 381/calculator 053), same as
      // every other bridged process; without an entry here the eye button's
      // request 400s (getAllSmLookupTableNames() is derived entirely from
      // this config — an unlisted table is never a real gap in the table
      // itself, always a missing bridge entry like this one was).
      {
        table: 'sm_lookup_pem_hardware',
        displayName: 'PEM Hardware Insertion Cycle Time',
        description: 'PEM part spec and insertion cycle time (sec) by hole diameter and sheet thickness — migration 381',
        orderBy: 'hole_diameter_mm,sheet_thickness_mm',
      },
    ],
  },
};

export function getSmLookupBridgeEntries(group: string, route: string): SmLookupBridgeEntry[] {
  return SM_LOOKUP_BRIDGE[group]?.[route] ?? [];
}

// Every real sm_lookup_* table name this bridge is allowed to touch — the
// SQL allowlist for the row-update endpoint. A request naming any other
// table (however it got there — bad client code, a crafted request) is
// rejected before it ever reaches a query, since `.from(table)` would
// otherwise let a caller UPDATE an arbitrary table by name.
export function getAllSmLookupTableNames(): Set<string> {
  const names = new Set<string>();
  for (const group of Object.values(SM_LOOKUP_BRIDGE)) {
    for (const entries of Object.values(group)) {
      for (const entry of entries) names.add(entry.table);
    }
  }
  return names;
}

// Columns a row update may never touch, regardless of table — the primary
// key and audit timestamps are structural, not cost data.
export const SM_LOOKUP_READONLY_COLUMNS = new Set(['id', 'created_at', 'updated_at']);
