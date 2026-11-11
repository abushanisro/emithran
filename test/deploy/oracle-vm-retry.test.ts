import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

// vm-retry.sh is the unattended job that tries to get the free Oracle VM. It must never die silently (the previous long-running loop did, when
// its login expired and the CLI's "re-authenticate? [Y/n]" prompt was read as "not a capacity problem"). Each outcome is run against a fake vm.sh
// with fake osascript/launchctl, and what the job leaves behind is checked.
const ROOT = process.cwd();
let dir: string;
let state: string;

const run = (vmOutput: string, vmExit: number) => {
  writeFileSync(join(dir, 'vm.sh'), `#!/usr/bin/env bash\ncat <<'OUT'\n${vmOutput}\nOUT\nexit ${vmExit}\n`);
  const res = spawnSync('bash', [join(dir, 'vm-retry.sh')], {
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, HOME: dir, ORACLE_RETRY_STATE: state, ORACLE_ENV: join(dir, 'oracle.env') },
  });
  return { code: res.status, log: existsSync(join(state, 'retry.log')) ? readFileSync(join(state, 'retry.log'), 'utf8') : '' };
};
const calls = (tool: string) => (existsSync(join(dir, `${tool}.calls`)) ? readFileSync(join(dir, `${tool}.calls`), 'utf8').trim().split('\n').filter(Boolean) : []);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vm-retry-'));
  state = join(dir, 'state');
  mkdirSync(join(dir, 'bin'));
  for (const tool of ['osascript', 'launchctl']) {
    writeFileSync(join(dir, 'bin', tool), `#!/usr/bin/env bash\necho "$*" >> "${join(dir, `${tool}.calls`)}"\n`);
    chmodSync(join(dir, 'bin', tool), 0o755);
  }
  copyFileSync(join(ROOT, 'infra/oracle/vm-retry.sh'), join(dir, 'vm-retry.sh'));
  writeFileSync(join(dir, 'oracle.env'), 'COMPARTMENT_ID=x\n');
});

describe('infra/oracle/vm-retry.sh', () => {
  it('is syntactically valid bash and recorded as executable', () => {
    execFileSync('bash', ['-n', join(ROOT, 'infra/oracle/vm-retry.sh')]);
    const modes = execFileSync('git', ['ls-files', '-s', 'infra/oracle/vm-retry.sh', 'infra/oracle/launcher-setup.sh'], { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').map((l) => l.split(/\s+/)[0]);
    expect(modes).toEqual(['100755', '100755']);
  });

  it('no capacity is the normal case: logged, no notification, schedule kept', () => {
    const r = run('no capacity after 1 tries', 1);
    expect(r.code).toBe(0);
    expect(r.log).toContain('no capacity');
    expect(existsSync(join(state, 'RESULT'))).toBe(false);
    expect(calls('osascript')).toEqual([]);
    expect(calls('launchctl')).toEqual([]);
  });

  it('a created VM is recorded, announced, and stops the schedule', () => {
    const r = run('launched with 2:12 (OCPU:GB)\n203.0.113.7', 0);
    expect(r.code).toBe(0);
    expect(readFileSync(join(state, 'RESULT'), 'utf8')).toContain('ip=203.0.113.7');
    expect(calls('osascript')[0]).toContain('203.0.113.7');
    expect(calls('launchctl')[0]).toContain('bootout');
    // and once there is a result, later runs do nothing at all
    const again = run('no capacity after 1 tries', 1);
    expect(again.code).toBe(0);
    expect(calls('osascript')).toHaveLength(1);
  });

  it('an expired or rejected login is announced (once), not mistaken for capacity', () => {
    const msg = 'ERROR: This CLI session has expired\nDo you want to re-authenticate your CLI session profile? [Y/n]: Abort:';
    expect(run(msg, 1).code).toBe(0);
    expect(run(msg, 1).code).toBe(0);
    expect(calls('osascript')).toHaveLength(1);
    expect(calls('osascript')[0]).toContain('login');
    expect(readFileSync(join(state, 'retry.log'), 'utf8')).toContain('login problem');
    expect(existsSync(join(state, 'RESULT'))).toBe(false);
  });

  it('an unexpected error is logged with Oracle\'s words and announced', () => {
    const r = run('{"code": "LimitExceeded", "message": "a quota blocks this"}', 1);
    expect(r.log).toContain('unexpected');
    expect(r.log).toContain('LimitExceeded');
    expect(calls('osascript')).toHaveLength(1);
  });

  it('refuses to overlap with a run that is still going', () => {
    mkdirSync(state, { recursive: true });
    mkdirSync(join(state, 'lock'));
    const r = run('launched with 4:24 (OCPU:GB)\n203.0.113.9', 0);
    expect(r.log).toContain('still going');
    expect(existsSync(join(state, 'RESULT'))).toBe(false);
  });

  it('says so, instead of guessing, when the settings file is missing', () => {
    writeFileSync(join(dir, 'oracle.env'), '');
    execFileSync('rm', [join(dir, 'oracle.env')]);
    const r = run('whatever', 0);
    expect(r.code).toBe(2);
    expect(r.log).toContain('launcher-setup.sh');
  });
});

describe('infra/oracle/launcher-setup.sh INSTALL_ONLY', () => {
  it('installs its own copy of the scripts and schedules THAT, so switching git branches cannot break the job', () => {
    const home = mkdtempSync(join(tmpdir(), 'launcher-home-'));
    mkdirSync(join(home, 'Library/LaunchAgents'), { recursive: true });
    mkdirSync(join(home, 'bin'));
    const calls = join(home, 'launchctl.calls');
    writeFileSync(join(home, 'bin', 'launchctl'), `#!/usr/bin/env bash\necho "$*" >> "${calls}"\n`);
    chmodSync(join(home, 'bin', 'launchctl'), 0o755);
    const res = spawnSync('bash', [join(ROOT, 'infra/oracle/launcher-setup.sh')], {
      encoding: 'utf8',
      env: { PATH: `${join(home, 'bin')}:${process.env.PATH ?? ''}`, HOME: home, INSTALL_ONLY: '1' },
    });
    expect(res.status).toBe(0);
    for (const f of ['vm.sh', 'vm-retry.sh']) expect(existsSync(join(home, '.emithran/oracle', f))).toBe(true);
    const plist = readFileSync(join(home, 'Library/LaunchAgents/com.emithran.oracle-retry.plist'), 'utf8');
    expect(plist).toContain(join(home, '.emithran/oracle/vm-retry.sh'));
    expect(plist).not.toContain(ROOT); // never the repository folder
    expect(plist).toContain('<integer>600</integer>');
    expect(readFileSync(calls, 'utf8')).toContain('bootstrap');
  });
});

describe('infra/oracle/mac-prod.sh after production moved', () => {
  it('refuses to run (it would start a second tunnel connector and split traffic) and changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mac-prod-'));
    const marker = join(dir, 'MOVED_TO_ORACLE');
    writeFileSync(marker, 'moved to the Oracle servers on 2026-11-11\n');
    const res = spawnSync('bash', [join(ROOT, 'infra/oracle/mac-prod.sh'), 'HEAD'], { encoding: 'utf8', cwd: ROOT, env: { PATH: process.env.PATH ?? '', HOME: dir, PROD_MOVED_MARKER: marker } });
    expect(res.status).toBe(3);
    expect(res.stderr).toContain('no longer runs on this Mac');
    expect(res.stderr).toContain('micro-deploy.sh');
    expect(res.stdout).not.toContain('release :');
  });
});

describe('infra/oracle/micro-release.sh', () => {
  const env = (dir: string) => ({ PATH: process.env.PATH ?? '', HOME: dir, APP_HOST: '192.0.2.1', ENGINE_HOST: '192.0.2.2', ENGINE_PRIVATE_IP: '10.0.0.2', MICRO_ENV: join(dir, 'none.env') });

  it('is valid bash and recorded as executable', () => {
    execFileSync('bash', ['-n', join(ROOT, 'infra/oracle/micro-release.sh')]);
    expect(execFileSync('git', ['ls-files', '-s', 'infra/oracle/micro-release.sh'], { cwd: ROOT, encoding: 'utf8' }).split(/\s+/)[0]).toBe('100755');
  });

  it('refuses an unknown ref before touching any server', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const res = spawnSync('bash', [join(ROOT, 'infra/oracle/micro-release.sh'), 'no-such-ref-anywhere'], { encoding: 'utf8', cwd: ROOT, env: env(dir) });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('unknown git ref');
    expect(res.stdout).not.toContain('preflight');
  });

  it('refuses a release that lacks the micro files, naming the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const first = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')[0];
    const res = spawnSync('bash', [join(ROOT, 'infra/oracle/micro-release.sh'), first], { encoding: 'utf8', cwd: ROOT, env: env(dir) });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/does not contain .*nothing was changed/);
  });
});

