// The coarse manufacturing-domain grouping used by CLAUDE.md's roadmap
// language (Sheet Metal / Machining / Injection Molding). This is coarser
// than the real, already-live classification strings used throughout
// bom-items.service.ts (`family`/`familyClassification`/`geoFamily`):
// 'sheet_metal', 'cnc_milled', 'cnc_turned', 'injection_molded' — CNC alone
// already splits into milled vs turned. Do NOT replace those finer strings
// with this enum; this exists only for domain-level roadmap/freeze-status
// language (e.g. "is Sheet Metal frozen yet"), not for engine dispatch.
export enum ManufacturingDomain {
  SHEET_METAL = 'SHEET_METAL',
  MACHINING = 'MACHINING',
  INJECTION_MOLDING = 'INJECTION_MOLDING',
}

/** The real, already-live family/geoFamily strings each domain covers today. */
export const DOMAIN_FAMILY_CLASSIFICATIONS: Readonly<Record<ManufacturingDomain, readonly string[]>> = {
  [ManufacturingDomain.SHEET_METAL]: ['sheet_metal'],
  [ManufacturingDomain.MACHINING]: ['cnc_milled', 'cnc_turned'],
  [ManufacturingDomain.INJECTION_MOLDING]: ['injection_molded'],
};
