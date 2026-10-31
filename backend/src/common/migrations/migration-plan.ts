// Decides which database migrations still have to run, and refuses the situations that corrupt a database quietly: an
// applied file that was edited afterwards, a new file that sorts before one already applied, and a run aimed at the
// wrong environment's database. Pure (no database, no files): scripts/migrate.ts supplies the facts.
import { createHash } from 'crypto';


export interface MigrationFile {
  name: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export interface Baseline {
  upToNumber: number;
  alsoIncluded: string[];
}

export interface MigrationPlan {
  pending: MigrationFile[];
  problems: string[];
  warnings: string[];
}

const MIGRATION_NAME = /^(\d{3,})[a-z]?_.+\.sql$/;

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/** The number a migration file starts with, or null for a file that is not a numbered migration (it is never run). */
export function migrationNumber(name: string): number | null {
  const match = MIGRATION_NAME.exec(name);
  return match ? Number(match[1]) : null;
}

/** Numbered order; files that share a number run in filename order. */
function byOrder(a: string, b: string): number {
  return (migrationNumber(a) ?? 0) - (migrationNumber(b) ?? 0) || a.localeCompare(b);
}

function inBaseline(name: string, baseline: Baseline): boolean {
  const number = migrationNumber(name);
  return number !== null && (number <= baseline.upToNumber || baseline.alsoIncluded.includes(name));
}

export function planMigrations(files: MigrationFile[], applied: AppliedMigration[], baseline: Baseline): MigrationPlan {
  const problems: string[] = [];
  const warnings: string[] = [];
  const tracked = files.filter((f) => migrationNumber(f.name) !== null && !inBaseline(f.name, baseline));
  const appliedByName = new Map(applied.map((a) => [a.name, a]));

  for (const file of tracked) {
    const done = appliedByName.get(file.name);
    if (done && done.checksum !== file.checksum) problems.push(`${file.name} was changed after it was applied; add a new migration instead of editing it`);
  }
  for (const done of applied) {
    if (!files.some((f) => f.name === done.name)) warnings.push(`${done.name} was applied but its file is no longer in the migrations folder`);
  }

  const pending = tracked.filter((f) => !appliedByName.has(f.name)).sort((a, b) => byOrder(a.name, b.name));
  const lastApplied = applied.map((a) => a.name).sort(byOrder).pop();
  if (lastApplied) {
    for (const file of pending) {
      if (byOrder(file.name, lastApplied) < 0) problems.push(`${file.name} sorts before ${lastApplied}, which is already applied; give it a higher number`);
    }
  }
  return { pending, problems, warnings };
}

/** What the runner was pointed at, from the env file and the command line. */
export interface Target {
  env: string;
  appEnv: string | undefined;
  databaseUrl: string | undefined;
  confirm: boolean;
  dryRun: boolean;
}

/**
 * Refuses a run whose pieces disagree: the env file must name the environment asked for, and production needs an explicit --confirm
 * (or --dry-run to see the plan). Returns the list of reasons; empty means go.
 */
export function targetProblems(t: Target): string[] {
  const problems: string[] = [];
  if (!['local', 'stage', 'prd'].includes(t.env)) problems.push(`--env must be local, stage or prd (got "${t.env}")`);
  if (!t.databaseUrl) problems.push('MIGRATE_DATABASE_URL is not set');
  if (t.env !== 'local' && t.appEnv !== t.env) problems.push(`the env file says APP_ENV=${t.appEnv ?? '(unset)'} but --env is ${t.env}`);
  if (t.env === 'prd' && !t.dryRun && !t.confirm) problems.push('production needs --confirm (or use --dry-run to see the plan)');
  return problems;
}
