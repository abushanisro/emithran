#!/usr/bin/env node
'use strict';

/**
 * Validates memory/Electronics against its format (scripts/lib/electronics-memory-format.js):
 * exact headers, numeric and enum columns, a source URL and ISO date on every row, no duplicate keys.
 * Header-only files pass. Run from backend/:  npm run check:electronics-memory
 */

const path = require('path');
const { validateDirectory } = require('./lib/electronics-memory-format');

const dir = path.resolve(__dirname, '../../memory/Electronics');
const problems = validateDirectory(dir);

for (const p of problems) console.error(`memory/Electronics/${p.file}${p.line ? `:${p.line}` : ''}  ${p.message}`);
if (problems.length > 0) {
  console.error(`memory/Electronics: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('memory/Electronics: format valid');
