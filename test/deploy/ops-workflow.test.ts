import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

// The nightly Operations workflow backs up and compares the schema of stage and production. It runs for an environment only once that
// environment is enabled (repository variable OPS_ENVIRONMENTS); an enabled environment keeps every fail-loud rule it always had.

const ROOT = process.cwd();
const SCRIPT = path.resolve(ROOT, '.github/scripts/ops-environments.mjs');
const workflowText = fs.readFileSync(path.resolve(ROOT, '.github/workflows/ops.yml'), 'utf8');

type Job = { needs?: string | string[]; if?: string; environment?: unknown; outputs?: Record<string, string>; strategy?: { matrix?: { environment?: unknown } }; steps: Array<{ uses?: string; run?: string }> };
const workflow = yaml.load(workflowText) as { jobs: Record<string, Job> };

function environmentsFor(value: string | undefined): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (value === undefined) delete env.OPS_ENVIRONMENTS;
  else env.OPS_ENVIRONMENTS = value;
  const r = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

describe('ops-environments.mjs: which environments the nightly Operations run is enabled for', () => {
  it('enables nothing when the variable is unset or empty, so an unprovisioned environment is not reported as a failed backup', () => {
    for (const v of [undefined, '', '   ', '\n', ' , ']) expect(environmentsFor(v)).toMatchObject({ status: 0, stdout: '[]' });
  });

  it('enables exactly the environments named, separated by spaces, commas or lines, in either case', () => {
    expect(environmentsFor('stage').stdout).toBe('["stage"]');
    expect(environmentsFor('production').stdout).toBe('["production"]');
    expect(environmentsFor('stage production').stdout).toBe('["stage","production"]');
    expect(environmentsFor('stage,production').stdout).toBe('["stage","production"]');
    expect(environmentsFor('Stage\nPRODUCTION\n').stdout).toBe('["stage","production"]');
  });

  it('always lists stage before production (production only runs once stage has passed) and lists each once', () => {
    expect(environmentsFor('production stage').stdout).toBe('["stage","production"]');
    expect(environmentsFor('stage stage production production').stdout).toBe('["stage","production"]');
  });

  it('refuses a name it does not know, so a typo cannot silently switch off the backups of a live environment', () => {
    const r = environmentsFor('stage prod');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/"prod".*not an environment Operations knows \(stage, production\)/);
    expect(environmentsFor('staging').status).toBe(1);
  });
});

describe('.github/workflows/ops.yml', () => {
  const { plan, ops, 'schema-drift': drift } = workflow.jobs;

  it('plans first: the plan job reads the variable, enters no environment (so it creates no deployment record) and exposes the list', () => {
    expect(plan).toBeDefined();
    expect(plan!.environment).toBeUndefined();
    expect(plan!.outputs?.environments).toContain('steps.plan.outputs.environments');
    expect(plan!.steps.some((s) => s.run?.includes('ops-environments.mjs'))).toBe(true);
    expect(workflowText).toContain('OPS_ENVIRONMENTS: ${{ vars.OPS_ENVIRONMENTS }}');
  });

  it('runs the backup and the schema comparison only for the planned environments, and not at all when there are none', () => {
    for (const job of [ops, drift]) {
      expect(job!.needs).toBe('plan');
      expect(job!.if).toBe("needs.plan.outputs.environments != '[]'");
      expect(job!.strategy?.matrix?.environment).toBe('${{ fromJSON(needs.plan.outputs.environments) }}');
      expect(job!.environment).toBe('${{ matrix.environment }}');
    }
  });

  it('says in plain words, as a warning and not a failure, that nothing is being backed up while no environment is enabled', () => {
    const run = plan!.steps.map((s) => s.run ?? '').join('\n');
    expect(run).toMatch(/::warning::Operations is not enabled for any environment/);
    expect(run).toMatch(/no database is being backed up and no schema is being checked/);
    expect(run).not.toMatch(/::error::/);
  });

  it('keeps every fail-loud rule for an enabled environment: a missing secret or baseline fails the job', () => {
    expect(workflowText).toContain('::error::SCHEMA_READER_DATABASE_URL is not set for $ENVIRONMENT');
    expect(workflowText).toContain('::error::no schema-only baseline in backend/migrations/baseline');
    expect(workflowText).toContain('set -euo pipefail');
    expect(workflowText).toMatch(/test -s backup\/db\.dump && test -s backup\/counts\.txt/);
    expect(workflowText).toMatch(/if-no-files-found: error/);
  });

  it('pins every action by commit SHA, like the other workflows', () => {
    const uses = Object.values(workflow.jobs).flatMap((j) => j.steps.flatMap((s) => (s.uses ? [s.uses] : [])));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}(\s|$)/);
  });
});
