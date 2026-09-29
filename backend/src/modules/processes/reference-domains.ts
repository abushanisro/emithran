import MANIFEST from './memory-reference-domains.json';

/**
 * The reference-data domains the Process page lists.
 *
 * Sheet Metal and Machining have their own staging tables. Plastic Molding's
 * old im_reference_data staging (migrations 636, 651-688) keyed lookup rows
 * without the table name and lost 38 rows (three tables entirely), so its
 * variables and tables are listed from the complete restage of
 * memory/Plastic Modeling (migration 823, 2026-Plastic) instead; its machine
 * rows in im_reference_data are still read by mhr.service. Every memory/ folder is staged into machining_reference_data under its
 * own source_version (memory-reference-domains.json: the one list the staging
 * generators, this file and the Process page all read). Those folders are shown
 * on their own and kept out of Machining: many variable names repeat across
 * folders (defaultMachineEfficiency, cycleTimeAdjustmentFactor, ...) and the
 * listing keeps the newest source_version per key, so mixing them would show
 * another folder's value under Machining.
 */
export interface MemoryDomain {
  key: string;
  label: string;
  folder: string;
  sourceVersion: string;
  processGroup: string | null;
  stagedBy: string;
}

export const MEMORY_DOMAINS: readonly MemoryDomain[] = MANIFEST.domains as MemoryDomain[];

type DomainConfig = {
  label: string;
  table: 'sm_reference_data' | 'im_reference_data' | 'machining_reference_data';
  versions: readonly string[] | null;
  excludeVersions: readonly string[] | null;
};

export const REFERENCE_DOMAINS: Readonly<Record<string, DomainConfig>> = {
  sheet_metal: { label: 'Sheet Metal', table: 'sm_reference_data', versions: null, excludeVersions: null },
  machining: {
    label: 'Machining',
    table: 'machining_reference_data',
    versions: null,
    excludeVersions: MEMORY_DOMAINS.map((d) => d.sourceVersion),
  },
  ...Object.fromEntries(MEMORY_DOMAINS.map((d) => [d.key, {
    label: d.label, table: 'machining_reference_data' as const, versions: [d.sourceVersion], excludeVersions: null,
  }])),
};

export type ReferenceDomain = string;

export const isReferenceDomain = (d: unknown): d is ReferenceDomain =>
  typeof d === 'string' && Object.prototype.hasOwnProperty.call(REFERENCE_DOMAINS, d);

/** Process groups whose Lookup Tables dialog lists their own staged reference
 *  folder (every staged lookup table of that domain). */
export const REFERENCE_GROUP_DOMAIN: Readonly<Record<string, ReferenceDomain>> = Object.fromEntries(
  MEMORY_DOMAINS.filter((d) => d.processGroup).map((d) => [d.processGroup!, d.key]),
);

/** For the Process page: every domain, in display order. */
export const referenceDomainList = () =>
  Object.entries(REFERENCE_DOMAINS).map(([key, d]) => ({ key, label: d.label }));
