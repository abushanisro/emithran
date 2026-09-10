// The coarse manufacturing-domain grouping used by CLAUDE.md's roadmap
// language (Sheet Metal / Machining / Plastic Molding). This is coarser
// than the real, already-live classification strings used throughout
// bom-items.service.ts (`family`/`familyClassification`/`geoFamily`):
// 'sheet_metal', 'cnc_milled', 'cnc_turned', 'plastic_molded' — CNC alone
// already splits into milled vs turned. Do NOT replace those finer strings
// with this enum; this exists only for domain-level roadmap/freeze-status
// language (e.g. "is Sheet Metal frozen yet"), not for engine dispatch.
// Plastic Molding is the family/domain; Injection Molding is one of its 4
// real sibling PROCESSES (alongside Compression Molding, Reaction Injection
// Molding, Structural Foam Molding) — see costing/plastic-molding/.
export enum ManufacturingDomain {
  SHEET_METAL = 'SHEET_METAL',
  MACHINING = 'MACHINING',
  PLASTIC_MOLDING = 'PLASTIC_MOLDING',
}

/** The real, already-live family/geoFamily strings each domain covers today. */
export const DOMAIN_FAMILY_CLASSIFICATIONS: Readonly<Record<ManufacturingDomain, readonly string[]>> = {
  [ManufacturingDomain.SHEET_METAL]: ['sheet_metal'],
  [ManufacturingDomain.MACHINING]: ['cnc_milled', 'cnc_turned'],
  [ManufacturingDomain.PLASTIC_MOLDING]: ['plastic_molded'],
};
