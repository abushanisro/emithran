/**
 * memory-reference-domains.json is the one list of memory/ reference folders.
 * These checks keep it true to the repo: every folder exists, versions are
 * unique and fit machining_reference_data.source_version (VARCHAR(20)), the
 * engines read the same versions, and migration 823 stages what it claims.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MEMORY_DOMAINS, REFERENCE_DOMAINS, REFERENCE_GROUP_DOMAIN } from '../../../modules/processes/reference-domains';
import { SECONDARY_SOURCE_VERSION } from '../../../modules/bom-items/costing/secondary/secondary-process-engine';
import { SURFACE_TREATMENT_SOURCE_VERSION } from '../../../modules/bom-items/costing/surface/surface-treatment-source';

const REPO = path.resolve(__dirname, '../../../../..');

describe('memory reference domains', () => {
  it('every folder exists under memory/', () => {
    for (const d of MEMORY_DOMAINS) expect(fs.existsSync(path.join(REPO, 'memory', d.folder))).toBe(true);
  });

  it('source versions are unique and fit VARCHAR(20)', () => {
    const v = MEMORY_DOMAINS.map((d) => d.sourceVersion);
    expect(new Set(v).size).toBe(v.length);
    for (const x of v) expect(x.length).toBeLessThanOrEqual(20);
  });

  it('the engines read the manifest versions', () => {
    expect(MEMORY_DOMAINS.find((d) => d.key === 'secondary_process')?.sourceVersion).toBe(SECONDARY_SOURCE_VERSION);
    expect(MEMORY_DOMAINS.find((d) => d.key === 'surface_treatment')?.sourceVersion).toBe(SURFACE_TREATMENT_SOURCE_VERSION);
  });

  it('Machining excludes every memory-folder version, so their variables never leak into it', () => {
    expect([...(REFERENCE_DOMAINS['machining']!.excludeVersions ?? [])].sort()).toEqual(MEMORY_DOMAINS.map((d) => d.sourceVersion).sort());
  });

  it('each process group opens its own folder lookups', () => {
    expect(REFERENCE_GROUP_DOMAIN['Surface Treatment']).toBe('surface_treatment');
    expect(REFERENCE_GROUP_DOMAIN['Forging']).toBe('forging');
  });

  it('migration 823 stages every folder marked stagedBy 823', () => {
    // Split into parts that fit the SQL editor (823_stage_memory_domains_partNofM.sql).
    const dir = path.join(REPO, 'backend/migrations');
    const parts = fs.readdirSync(dir).filter((f) => /^823_stage_memory_domains/.test(f));
    expect(parts.length).toBeGreaterThan(0);
    const sql = parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join(' ');
    for (const d of MEMORY_DOMAINS.filter((x) => x.stagedBy === '823')) {
      expect(sql).toContain(`'USA', $str$${d.sourceVersion}$str$`);
    }
  });

  it('migration 846 stages the Sand Casting folder under its own source version', () => {
    const dir = path.join(REPO, 'backend/migrations');
    const parts = fs.readdirSync(dir).filter((f) => /^846_stage_memory_domains/.test(f));
    expect(parts.length).toBeGreaterThan(0);
    const sql = parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join(' ');
    for (const d of MEMORY_DOMAINS.filter((x) => x.stagedBy === '846')) {
      expect(sql).toContain(`'USA', $str$${d.sourceVersion}$str$`);
    }
  });

  it('Plastic Molding lists the complete restage, including the tables the old key scheme lost', () => {
    expect(REFERENCE_DOMAINS['injection_molding']!.versions).toEqual(['2026-Plastic']);
    const dir = path.join(REPO, 'backend/migrations');
    const sql = fs.readdirSync(dir).filter((f) => /^823_stage_memory_domains/.test(f))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join(' ');
    // Each split export (X__records + X__fields/__columns) is ONE lookup table X.
    const lookups = fs.readdirSync(path.join(REPO, 'memory/Plastic Modeling/lookup'))
      .map((f) => f.replace(/__(records|rows|columns|fields)\.csv$/i, '').replace(/\.csv$/i, ''));
    for (const t of new Set(lookups)) {
      expect(sql).toContain(`($str$lookup_table$str$, 'USA', $str$2026-Plastic$str$, $str$${t}$str$`);
    }
    for (const lost of ['tblHrsPerSqInchComplex', 'tblHrsPerSqInchSimple', 'tblCorePlateDepthBorder']) expect(lookups).toContain(lost);
    // Wage grades (transcribed from memory/Plastic Modeling/wagegrade.png) stay on the Plastic list.
    expect(sql).toContain(`($str$wage_grade$str$, 'USA', $str$2026-Plastic$str$, $str$Injection Molding$str$, $str$3 - Plastic$str$`);
  });
});
