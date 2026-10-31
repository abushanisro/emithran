
import { checksumOf, migrationNumber, planMigrations, targetProblems, type Baseline, type Target } from './migration-plan';

const BASELINE: Baseline = { upToNumber: 917, alsoIncluded: ['999_fix_currency_code_trigger.sql'] };
const file = (name: string, sql = 'select 1') => ({ name, checksum: checksumOf(sql) });

describe('migrationNumber', () => {
  it('reads the leading number, with or without a letter suffix, and ignores anything else', () => {
    expect(migrationNumber('917_cad_uploads.sql')).toBe(917);
    expect(migrationNumber('814a_restore_mhr_records_specs.sql')).toBe(814);
    expect(migrationNumber('detailed-inspection-reports.sql')).toBeNull();
    expect(migrationNumber('README.md')).toBeNull();
    expect(migrationNumber('12_too_short.sql')).toBeNull();
  });
});

describe('planMigrations', () => {
  it('runs nothing that is part of the baseline, including the out-of-sequence 999', () => {
    const plan = planMigrations([file('916_x.sql'), file('917_cad_uploads.sql'), file('999_fix_currency_code_trigger.sql')], [], BASELINE);
    expect(plan.pending).toEqual([]);
    expect(plan.problems).toEqual([]);
  });

  it('runs new migrations after the baseline in number order, and files sharing a number by name', () => {
    const plan = planMigrations([file('920_c.sql'), file('918_b.sql'), file('918_a.sql'), file('notes.sql')], [], BASELINE);
    expect(plan.pending.map((f) => f.name)).toEqual(['918_a.sql', '918_b.sql', '920_c.sql']);
  });

  it('skips what is applied, and refuses a file that was edited after it was applied', () => {
    const applied = [{ name: '918_a.sql', checksum: checksumOf('select 1') }];
    expect(planMigrations([file('918_a.sql'), file('919_b.sql')], applied, BASELINE).pending.map((f) => f.name)).toEqual(['919_b.sql']);
    const edited = planMigrations([file('918_a.sql', 'select 2')], applied, BASELINE);
    expect(edited.problems).toEqual(['918_a.sql was changed after it was applied; add a new migration instead of editing it']);
  });

  it('refuses a new migration that sorts before one already applied', () => {
    const applied = [{ name: '920_c.sql', checksum: checksumOf('select 1') }];
    const plan = planMigrations([file('920_c.sql'), file('919_late.sql')], applied, BASELINE);
    expect(plan.problems).toEqual(['919_late.sql sorts before 920_c.sql, which is already applied; give it a higher number']);
  });

  it('only warns about an applied migration whose file has gone', () => {
    const plan = planMigrations([], [{ name: '918_gone.sql', checksum: 'x' }], BASELINE);
    expect(plan.problems).toEqual([]);
    expect(plan.warnings).toEqual(['918_gone.sql was applied but its file is no longer in the migrations folder']);
  });
});

describe('targetProblems', () => {
  const stage: Target = {
    env: 'stage', appEnv: 'stage', confirm: false, dryRun: false, databaseUrl: 'postgresql://migrator:pw@db.example:5432/emithran',
  };

  it('accepts a consistent stage target', () => {
    expect(targetProblems(stage)).toEqual([]);
  });

  it('accepts local with just a database URL', () => {
    expect(targetProblems({ env: 'local', appEnv: undefined, databaseUrl: 'postgresql://localhost/db', confirm: false, dryRun: false })).toEqual([]);
  });

  it('refuses an env file that names a different environment than --env', () => {
    expect(targetProblems({ ...stage, appEnv: 'prd' })).toEqual(['the env file says APP_ENV=prd but --env is stage']);
  });

  it('needs --confirm for production, or --dry-run to see the plan', () => {
    const prd = { ...stage, env: 'prd', appEnv: 'prd' };
    expect(targetProblems(prd).join()).toMatch(/production needs --confirm/);
    expect(targetProblems({ ...prd, confirm: true })).toEqual([]);
    expect(targetProblems({ ...prd, dryRun: true })).toEqual([]);
  });

  it('refuses an unknown environment name and a missing database URL', () => {
    expect(targetProblems({ ...stage, env: 'staging', appEnv: 'staging' }).join()).toMatch(/--env must be local, stage or prd/);
    expect(targetProblems({ ...stage, databaseUrl: undefined }).join()).toMatch(/MIGRATE_DATABASE_URL is not set/);
  });
});
