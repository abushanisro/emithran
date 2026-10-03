#!/usr/bin/env node
// Generates migration 846: stage every Die Casting reference file into
// machining_reference_data under its own source_version (the manifest entry
// stagedBy "846" in memory-reference-domains.json). Roles and checks:
// scripts/lib/memory-reference-stage.js. Machine/*.csv are in mhr_records
// (migration 845).
//
// Run: node backend/migrations/scripts/gen_846_stage_die_casting_reference_data.js

const path = require('path');
const { stageDomain } = require('./lib/memory-reference-stage');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST = require(path.join(ROOT, 'backend', 'src', 'modules', 'processes', 'memory-reference-domains.json'));
const domains = MANIFEST.domains.filter((x) => x.stagedBy === '846');
if (domains.length !== 1) throw new Error('expected exactly one manifest domain stagedBy 846');

stageDomain({
  mem: path.join(ROOT, 'memory'),
  domain: domains[0],
  migration: '846',
  label: 'Die Casting',
  outPrefix: path.join(__dirname, '..', '846_stage_die_casting_reference_data'),
  generator: 'gen_846_stage_die_casting_reference_data.js',
});
