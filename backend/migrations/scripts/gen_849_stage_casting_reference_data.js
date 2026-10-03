#!/usr/bin/env node
// Generates migration 849: stage every Casting reference file into
// machining_reference_data under its own source_version (the manifest entry
// stagedBy "849" in memory-reference-domains.json). Roles and checks:
// scripts/lib/memory-reference-stage.js. Machine/*.csv are in mhr_records
// (migration 848).
//
// memory/Casting/Raw Material holds the same 95 materials three ways:
// materials_FULL_raw_data_v2.csv (every property, numeric) is the material
// table; materials_FULL_raw_data.csv (the earlier transcription, with
// "N/A - not visible in screenshot" cells) and materials_identity.csv (names
// and codes only) are staged whole as lookup tables, so nothing is dropped.
//
// Run: node backend/migrations/scripts/gen_849_stage_casting_reference_data.js

const path = require('path');
const { stageDomain } = require('./lib/memory-reference-stage');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST = require(path.join(ROOT, 'backend', 'src', 'modules', 'processes', 'memory-reference-domains.json'));
const domains = MANIFEST.domains.filter((x) => x.stagedBy === '849');
if (domains.length !== 1) throw new Error('expected exactly one manifest domain stagedBy 849');

stageDomain({
  mem: path.join(ROOT, 'memory'),
  domain: domains[0],
  migration: '849',
  label: 'Casting',
  outPrefix: path.join(__dirname, '..', '849_stage_casting_reference_data'),
  generator: 'gen_849_stage_casting_reference_data.js',
  materialFile: 'Raw Material/materials_FULL_raw_data_v2.csv',
});
