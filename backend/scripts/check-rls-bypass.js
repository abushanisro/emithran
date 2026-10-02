#!/usr/bin/env node
'use strict';

/**
 * Fails the build when code can reach the service-role database client, or a
 * second DB path, outside the audited SupabaseService boundary.
 * Run from backend/:  npm run check:rls
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanSource, scanRepoJwt } = require('./rls-bypass-rules');

const backendRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(backendRoot, 'src');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield full;
    }
  }
}

const errors = [];
const warnings = [];
for (const file of walk(srcRoot)) {
  const rel = path.relative(backendRoot, file).replace(/\\/g, '/');
  for (const v of scanSource(rel, fs.readFileSync(file, 'utf8'))) {
    (v.severity === 'error' ? errors : warnings).push(`${rel}:${v.line}  [${v.rule}] ${v.message}`);
  }
}

// Repository-wide secret scan over every tracked file. Fails closed: if the
// file list cannot be read, the check fails rather than silently passing.
const repoRoot = path.resolve(backendRoot, '..');
let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 1 << 28 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (err) {
  console.error(`error    cannot list tracked files via git (${err.message}); refusing to pass`);
  process.exit(1);
}
for (const rel of tracked) {
  const full = path.join(repoRoot, rel);
  let text;
  try {
    if (fs.statSync(full).size > 5 * 1024 * 1024) continue;
    text = fs.readFileSync(full, 'utf8');
  } catch {
    continue; // deleted in the working tree or unreadable binary
  }
  for (const v of scanRepoJwt(rel, text)) {
    (v.severity === 'error' ? errors : warnings).push(`${rel}:${v.line}  [${v.rule}] ${v.message}`);
  }
}

for (const w of warnings) console.warn(`warning  ${w}`);
for (const e of errors) console.error(`error    ${e}`);
console.log(`\nRLS boundary check: ${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
