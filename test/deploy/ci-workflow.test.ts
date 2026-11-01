import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}
const workflow = yaml.load(fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>;
};

describe('.github/workflows/ci.yml', () => {
  // The compile-only build runs on pull requests and executes every dependency's build script: it gets public settings and
  // placeholders, never a server credential (Next reads those at request time, not at build time).
  it('gives the frontend build no server API key', () => {
    const build = workflow.jobs.frontend?.steps.find((s) => s.run === 'npm run build');
    expect(build).toBeTruthy();
    const env = build?.env ?? {};
    for (const name of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'CAD_ENGINE_API_KEY']) expect(env[name], name).toBeUndefined();
    const secretNames = Object.keys(env).filter((n) => !n.startsWith('NEXT_PUBLIC_') && /KEY|SECRET|TOKEN|PASSWORD/i.test(n));
    expect(secretNames).toEqual([]);
  });

  it('keeps the placeholder URLs for a build without secrets', () => {
    const env = workflow.jobs.frontend?.steps.find((s) => s.run === 'npm run build')?.env ?? {};
    expect(env.NEXT_PUBLIC_API_GATEWAY_URL).toMatch(/\.invalid'/);
    expect(env.API_URL).toMatch(/\.invalid\/v1\/api'/);
  });
});
