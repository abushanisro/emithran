import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The Oracle scripts run on a machine that receives them through `git archive`, which keeps only the modes git RECORDS. With core.fileMode=false a
// script chmod'ed on disk is still committed as 100644, and the VM then answers "Permission denied" (it stopped the VM retry job and would have
// stopped the deploy). So the mode recorded in git is what is checked, not the file's.
const ROOT = process.cwd();
const recorded = execFileSync('git', ['ls-files', '-s', 'infra/oracle'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n').map((l) => ({ mode: l.split(/\s+/)[0], file: l.split('\t')[1] }));

describe('infra/oracle is runnable from a fresh clone and from git archive', () => {
  it('records every shell script as executable', () => {
    const scripts = recorded.filter((r) => r.file.endsWith('.sh'));
    expect(scripts.length).toBeGreaterThanOrEqual(6);
    expect(scripts.filter((r) => r.mode !== '100755').map((r) => r.file)).toEqual([]);
  });
});
