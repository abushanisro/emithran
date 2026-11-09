#!/usr/bin/env node
// Which GitHub Environments the nightly Operations workflow (.github/workflows/ops.yml) runs for.
//
// Reads the repository variable OPS_ENVIRONMENTS (Settings -> Secrets and variables -> Actions -> Variables), a list separated by spaces,
// commas or newlines, and prints a JSON array for the workflow's matrix, always in the order stage, production: production only runs
// once stage's checks have passed.
//
//   unset or empty -> []  Operations is not enabled: nothing is backed up or checked, and the workflow says so in plain words.
//   a known name   -> that environment is enabled, and the workflow then fails loudly on any missing secret or baseline.
//   anything else  -> exit 1: a typo must not silently disable the backups of an environment that is live.
//
// Enabling an environment is a decision made when it is provisioned (docs/runbooks/schema-drift.md, "Enabling the nightly checks"),
// not a default: an environment whose database does not exist yet has nothing to back up and no schema to compare.

const ENVIRONMENTS = ['stage', 'production'];

const requested = (process.env.OPS_ENVIRONMENTS ?? '')
  .split(/[\s,]+/)
  .map((name) => name.trim().toLowerCase())
  .filter((name) => name !== '');

const unknown = [...new Set(requested.filter((name) => !ENVIRONMENTS.includes(name)))];
if (unknown.length > 0) {
  console.error(`OPS_ENVIRONMENTS names ${unknown.map((n) => `"${n}"`).join(', ')}, which is not an environment Operations knows (${ENVIRONMENTS.join(', ')}).`);
  process.exit(1);
}

console.log(JSON.stringify(ENVIRONMENTS.filter((name) => requested.includes(name))));
