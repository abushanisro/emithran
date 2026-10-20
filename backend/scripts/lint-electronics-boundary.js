#!/usr/bin/env node
'use strict';

/**
 * Enforces the electronics-costing domain import boundary (see
 * eslint.electronics-boundary.cjs). Fails when any file under
 * src/modules/electronics-costing/domain breaks it.
 * Run from backend/:  npm run lint:electronics-boundary
 */

const path = require('path');
const { FlatESLint } = require('eslint/use-at-your-own-risk');
const { electronicsDomainBoundary } = require('../eslint.electronics-boundary.cjs');

const backendRoot = path.resolve(__dirname, '..');

function createLinter() {
  return new FlatESLint({
    cwd: backendRoot,
    overrideConfigFile: true,
    baseConfig: [electronicsDomainBoundary],
  });
}

async function main() {
  const results = await createLinter().lintFiles(['src/modules/electronics-costing/domain/**/*.ts']);
  let errors = 0;
  for (const r of results) {
    for (const m of r.messages) {
      errors += m.severity === 2 ? 1 : 0;
      console.error(`${path.relative(backendRoot, r.filePath)}:${m.line}  ${m.ruleId}  ${m.message}`);
    }
  }
  if (errors > 0) {
    console.error(`electronics domain boundary: ${errors} violation(s)`);
    process.exit(1);
  }
  console.log(`electronics domain boundary: ${results.length} files clean`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { createLinter };
