import fs from 'node:fs';
import path from 'node:path';

import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

// The branching model (docs/BRANCHING.md): `main` is production, `develop` is the default branch and what stage runs, topic branches are
// short-lived. These tests keep the files that encode it in step, so one of them cannot be changed back alone.

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), 'utf8');
type Trigger = { branches?: string[] };
type Workflow = { on: { push?: Trigger; pull_request?: Trigger } };
type Rule = { type: string; parameters?: { allowed_merge_methods?: string[]; required_status_checks?: Array<{ context: string }>; strict_required_status_checks_policy?: boolean } };
type Ruleset = { name: string; target: string; enforcement: string; conditions: { ref_name: { include: string[] } }; rules: Rule[] };

const ruleset = (name: string) => JSON.parse(read(`.github/rulesets/${name}.json`)) as Ruleset;
const rule = (r: Ruleset, type: string) => r.rules.find((x) => x.type === type);

describe('CI and security run for both long-lived branches', () => {
  for (const file of ['ci.yml', 'security.yml']) {
    it(`${file} runs on pushes to and pull requests into main and develop`, () => {
      const on = (yaml.load(read(`.github/workflows/${file}`)) as Workflow).on;
      expect(on.push?.branches).toEqual(['main', 'develop']);
      expect(on.pull_request?.branches).toEqual(['main', 'develop']);
    });
  }
});

describe('Dependabot opens every update against develop', () => {
  const config = yaml.load(read('.github/dependabot.yml')) as { updates: Array<{ 'package-ecosystem': string; directory: string; 'target-branch'?: string }> };

  it('does not propose a major version of any @nestjs package for the backend: they move with @nestjs/core, and swagger 12 merged against Nest 11 broke every backend spec on main', () => {
    const backend = (config.updates as Array<{ directory: string; 'package-ecosystem': string; ignore?: Array<{ 'dependency-name': string; 'update-types'?: string[] }> }>).find((u) => u['package-ecosystem'] === 'npm' && u.directory === '/backend');
    expect(backend?.ignore).toContainEqual({ 'dependency-name': '@nestjs/*', 'update-types': ['version-update:semver-major'] });
  });

  it('has updates, each with target-branch develop (a missing one would open against the default branch and, for a security update, bypass the rule)', () => {
    expect(config.updates.length).toBeGreaterThan(5);
    for (const u of config.updates) expect(`${u['package-ecosystem']} ${u.directory}: ${u['target-branch']}`).toMatch(/: develop$/);
  });
});

describe('the two rulesets', () => {
  const main = ruleset('main');
  const develop = ruleset('develop');

  it('name their branch explicitly: the default branch is develop, so main can no longer be addressed as "the default"', () => {
    expect(main.conditions.ref_name.include).toEqual(['refs/heads/main']);
    expect(develop.conditions.ref_name.include).toEqual(['refs/heads/develop']);
    for (const r of [main, develop]) expect([r.target, r.enforcement]).toEqual(['branch', 'active']);
  });

  it('protect both branches the same way: no deletion, no force push, a pull request, strict required checks, CodeQL', () => {
    for (const r of [main, develop]) {
      for (const type of ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks', 'code_scanning']) expect(rule(r, type), `${r.name}: ${type}`).toBeDefined();
      expect(rule(r, 'required_status_checks')?.parameters?.strict_required_status_checks_policy).toBe(true);
    }
    const checks = (r: Ruleset) => rule(r, 'required_status_checks')?.parameters?.required_status_checks;
    expect(checks(develop)).toEqual(checks(main));
    expect(checks(main)?.length).toBeGreaterThan(10);
  });

  it('main takes only merge commits: a squashed release would give main a commit develop lacks, so the branches would diverge and need a back-merge each time', () => {
    expect(rule(main, 'pull_request')?.parameters?.allowed_merge_methods).toEqual(['merge']);
  });

  it('develop squashes topic branches and also allows the one merge commit it needs, the back-merge of a hotfix from main', () => {
    expect(rule(develop, 'pull_request')?.parameters?.allowed_merge_methods).toEqual(['squash', 'merge']);
  });

  it('are otherwise identical: the same rules apart from the name, the branch and the merge methods', () => {
    const strip = (r: Ruleset) => {
      const copy = JSON.parse(JSON.stringify(r)) as Ruleset;
      copy.name = '';
      copy.conditions.ref_name.include = [];
      const pr = rule(copy, 'pull_request');
      if (pr?.parameters) pr.parameters.allowed_merge_methods = [];
      return copy;
    };
    expect(strip(develop)).toEqual(strip(main));
  });
});

describe('the nightly Operations check compares each environment with the branch that builds it', () => {
  const text = read('.github/workflows/ops.yml');

  it('checks out main for production and develop for stage in the schema comparison (scheduled runs start from the default branch, develop, which is ahead of production between releases)', () => {
    expect(text).toContain("ref: ${{ matrix.environment == 'production' && 'main' || 'develop' }}");
  });
});

describe('the docs state the same model', () => {
  it('BRANCHING.md names both branches, the merge methods and the release and hotfix procedures, and the flow in DEPLOYMENT_SECURITY.md points to it', () => {
    const doc = read('docs/BRANCHING.md');
    for (const phrase of ['`main`', '`develop`', 'merge commit', 'squash', 'Release vX.Y.Z', 'hotfix/*', 'default branch', 'delete_branch_on_merge', 'Sync `develop` the same day', 'chore/sync-main-into-develop']) expect(doc).toContain(phrase);
    expect(read('docs/DEPLOYMENT_SECURITY.md')).toContain('BRANCHING.md');
    expect(read('docs/GOVERNANCE.md')).toContain('docs/BRANCHING.md');
  });
});
