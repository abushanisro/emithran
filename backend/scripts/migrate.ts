#!/usr/bin/env ts-node
/**
 * Applies the database migrations that came after the baseline, and records each one in public.schema_migrations.
 *
 *   npm run db:migrate -- --env stage --dry-run          show what would run
 *   npm run db:migrate -- --env stage                    apply
 *   npm run db:migrate -- --env prd --confirm         production needs the flag
 *
 * Settings come from env/<env>.env (or --env-file), which names the environment and the database. The runner refuses a
 * run whose pieces disagree (see targetProblems). There is deliberately no "reset": a stage database is rebuilt from the
 * baseline, and production is never wiped by a script.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { Client } from 'pg';

import { checksumOf, migrationNumber, planMigrations, targetProblems, type Baseline } from '../src/common/migrations/migration-plan';

const ADVISORY_LOCK = 727_001; // one runner at a time per database
const NO_TRANSACTION = /^--\s*migrate:\s*no-transaction/m;

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

function fail(messages: string[]): never {
  for (const m of messages) console.error(`  x ${m}`);
  process.exit(1);
}

function loadSettings(env: string): Record<string, string | undefined> {
  const file = option('env-file') ?? path.resolve(__dirname, `../../env/${env}.env`);
  if (!fs.existsSync(file)) {
    if (option('env-file')) fail([`env file not found: ${file}`]);
    return process.env; // e.g. a CI job that supplies the variables directly
  }
  return { ...parseEnv(fs.readFileSync(file, 'utf8')) };
}

function sslFor(databaseUrl: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const host = new URL(databaseUrl).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(host) || /sslmode=disable/.test(databaseUrl)) return false;
  // Supabase's certificates are signed by its own CA, which Node does not ship. Give the CA file to verify the server;
  // without it the connection is encrypted but the server is not authenticated.
  const caFile = process.env.MIGRATE_DATABASE_SSL_CA;
  return caFile ? { rejectUnauthorized: true, ca: fs.readFileSync(caFile, 'utf8') } : { rejectUnauthorized: false };
}

async function main(): Promise<void> {
  const env = option('env') ?? '';
  const settings = loadSettings(env);
  const dryRun = flag('dry-run');
  const problems = targetProblems({
    env,
    appEnv: settings.APP_ENV,
    supabaseUrl: settings.SUPABASE_URL,
    databaseUrl: settings.MIGRATE_DATABASE_URL,
    confirm: flag('confirm'),
    dryRun,
  });
  if (problems.length > 0) fail(problems);

  const dir = path.resolve(option('dir') ?? path.join(__dirname, '../migrations'));
  const baseline = JSON.parse(fs.readFileSync(option('baseline') ?? path.join(dir, 'BASELINE.json'), 'utf8')) as Baseline;
  const files = fs
    .readdirSync(dir)
    .filter((name) => migrationNumber(name) !== null)
    .map((name) => ({ name, checksum: checksumOf(fs.readFileSync(path.join(dir, name), 'utf8')) }));

  const databaseUrl = settings.MIGRATE_DATABASE_URL as string;
  const client = new Client({ connectionString: databaseUrl, ssl: sslFor(databaseUrl) });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK]);
    // No policies and RLS on: the tracking table is invisible to the API roles; only the service connection reads it.
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY');
    const applied = (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM public.schema_migrations')).rows;

    const plan = planMigrations(files, applied, baseline);
    for (const w of plan.warnings) console.warn(`  ! ${w}`);
    if (plan.problems.length > 0) fail(plan.problems);

    console.log(`${env}: ${applied.length} applied, ${plan.pending.length} pending${dryRun ? ' (dry run)' : ''}`);
    for (const m of plan.pending) console.log(`  ${dryRun ? 'would apply' : 'applying'} ${m.name}`);
    if (dryRun || plan.pending.length === 0) return;

    for (const m of plan.pending) {
      const sql = fs.readFileSync(path.join(dir, m.name), 'utf8');
      const transactional = !NO_TRANSACTION.test(sql);
      try {
        if (transactional) await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
        if (transactional) await client.query('COMMIT');
        console.log(`  applied ${m.name}`);
      } catch (error) {
        if (transactional) await client.query('ROLLBACK');
        fail([`${m.name} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`]);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => fail([error instanceof Error ? error.message : String(error)]));
