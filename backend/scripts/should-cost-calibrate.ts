#!/usr/bin/env ts-node
/**
 * Should-cost calibration, operator-run (it is not reachable over HTTP). Sets the global BENCHMARK mhr_records rates of each
 * (process_family, location) cell to baseline × the cell's calibrated multiplier (src/modules/should-cost/calibration.ts), logs the
 * run in rate_calibration_history, and marks the pairs it used as consumed (migration 941) — in ONE transaction. A pair is applied at
 * most once, a cell needs pairs from at least SHOULD_COST_CALIBRATION_MIN_ORGANIZATIONS organizations (default 2), and rates are
 * computed from mhr_records.baseline_mhr (migration 953), never from the current rate, so a re-run changes nothing.
 *
 *   npm run should-cost:calibrate -- --env stage --dry-run     show what would change
 *   npm run should-cost:calibrate -- --env stage               apply
 *   npm run should-cost:calibrate -- --env prd --confirm       production needs the flag
 *
 * Connects with the service database URL of env/<env>.env (MIGRATE_DATABASE_URL, as db:migrate does), or --env-file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { Client } from 'pg';

import { caCertificate, databaseClientConfig } from '../src/common/migrations/db-connection';
import { targetProblems } from '../src/common/migrations/migration-plan';
import { cellKey, MIN_SAMPLES, minOrganizationsSetting, planCalibration, type CalibrationPair } from '../src/modules/should-cost/calibration';

const ADVISORY_LOCK = 727_002; // one calibration at a time per database

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
  if (!fs.existsSync(file)) fail([`env file not found: ${file}`]);
  return { ...parseEnv(fs.readFileSync(file, 'utf8')) };
}

// What the run reads and writes; a database without one of these has not had migrations 941, 952 and 953.
const REQUIRED_COLUMNS: [table: string, column: string][] = [
  ['should_cost_actuals', 'calibration_consumed_at'],
  ['should_cost_predictions', 'organization_id'],
  ['rate_calibration_history', 'baseline_multiplier'],
  ['mhr_records', 'baseline_mhr'],
  ['mhr_records', 'baseline_mhr_usd_per_hour'],
];

async function main(): Promise<void> {
  const env = option('env') ?? '';
  const settings = loadSettings(env);
  const dryRun = flag('dry-run');
  const problems = targetProblems({ env, appEnv: settings.APP_ENV, databaseUrl: settings.MIGRATE_DATABASE_URL, confirm: flag('confirm'), dryRun });
  let minOrganizations = 0;
  try {
    minOrganizations = minOrganizationsSetting(settings.SHOULD_COST_CALIBRATION_MIN_ORGANIZATIONS);
  } catch (error) {
    problems.push((error as Error).message);
  }
  if (problems.length > 0) fail(problems);

  const databaseUrl = settings.MIGRATE_DATABASE_URL as string;
  const client = new Client(databaseClientConfig(databaseUrl, caCertificate(settings)));
  await client.connect();
  try {
    const missing = (await client.query<{ missing: string }>(
      `SELECT r.t || '.' || r.c AS missing FROM unnest($1::text[], $2::text[]) AS r(t, c)
        WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = r.t AND column_name = r.c)`,
      [REQUIRED_COLUMNS.map(([t]) => t), REQUIRED_COLUMNS.map(([, c]) => c)],
    )).rows.map((r) => r.missing);
    if (missing.length > 0) fail([`not in this database (run db:migrate): ${missing.join(', ')}`]);

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK]);
    const { rows } = await client.query<{ id: string; actual: string | null; predicted: string | null; family: string | null; location: string | null; organization: string | null }>(
      `SELECT a.id, a.actual_total_cost_usd AS actual, p.predicted_total_cost_usd AS predicted, p.process_family AS family, p.location,
              p.organization_id AS organization
         FROM public.should_cost_actuals a JOIN public.should_cost_predictions p ON p.id = a.prediction_id
        WHERE a.calibration_consumed_at IS NULL
        FOR UPDATE OF a`,
    );
    const pairs: CalibrationPair[] = rows.map((r) => ({
      actualId: r.id, actualTotalCostUsd: r.actual, predictedTotalCostUsd: r.predicted, processFamily: r.family, location: r.location,
      organizationId: r.organization, consumed: false,
    }));
    // Each cell's multiplier over its baseline after its last run; a cell never calibrated against a baseline is at 1.
    const previous = new Map(
      (await client.query<{ family: string; location: string; m: string }>(
        `SELECT DISTINCT ON (process_family, lower(location)) process_family AS family, location, baseline_multiplier AS m
           FROM public.rate_calibration_history
          WHERE baseline_multiplier IS NOT NULL AND process_family IS NOT NULL AND location IS NOT NULL
          ORDER BY process_family, lower(location), calibrated_at DESC`,
      )).rows.map((r) => [cellKey(r.family, r.location), Number(r.m)] as const),
    );
    const plan = planCalibration(pairs, { minSamples: MIN_SAMPLES, minOrganizations }, previous);
    console.log(`${env}: ${pairs.length} unconsumed pairs, ${plan.length} cells, at least ${minOrganizations} organizations per cell${dryRun ? ' (dry run)' : ''}`);

    for (const cell of plan) {
      const label = `${cell.processFamily}/${cell.location}`;
      if (cell.multiplier == null || cell.baselineMultiplier == null) {
        console.log(`  skip  ${label}: ${cell.skippedReason}`);
        continue;
      }
      const filter = `process_family = $1 AND source_type = 'BENCHMARK' AND lower(location) = lower($2) AND total_machine_hour_rate IS NOT NULL`;
      if (dryRun) {
        const { rows: count } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM public.mhr_records WHERE ${filter}`, [cell.processFamily, cell.location]);
        console.log(`  would ×${cell.multiplier.toFixed(4)} (baseline ×${cell.baselineMultiplier.toFixed(4)}) ${label}: ${cell.sampleCount} pairs from ${cell.organizationCount} organizations, ${count[0].n} benchmark rows`);
        continue;
      }
      // A benchmark row loaded after migration 953 has no baseline yet: its current (uncalibrated) rate is its baseline.
      const { rows: updated } = await client.query<{ id: string }>(
        `UPDATE public.mhr_records
            SET baseline_mhr = COALESCE(baseline_mhr, total_machine_hour_rate),
                baseline_mhr_usd_per_hour = COALESCE(baseline_mhr_usd_per_hour, mhr_usd_per_hour),
                total_machine_hour_rate = round(COALESCE(baseline_mhr, total_machine_hour_rate) * $3, 2),
                mhr_usd_per_hour = round(COALESCE(baseline_mhr_usd_per_hour, mhr_usd_per_hour) * $3, 2)
          WHERE ${filter} RETURNING id`,
        [cell.processFamily, cell.location, cell.baselineMultiplier],
      );
      const { rows: history } = await client.query<{ id: string; calibrated_at: Date }>(
        `INSERT INTO public.rate_calibration_history
           (process_family, location, correction_multiplier, baseline_multiplier, sample_count, mape_before, mape_after, bias_before, bias_after,
            pct_within_10pct_before, pct_within_10pct_after, method, applied_to_mhr_ids, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ridge_regression', $12, $13) RETURNING id, calibrated_at`,
        [cell.processFamily, cell.location, cell.multiplier, cell.baselineMultiplier, cell.sampleCount, cell.mapeBefore, cell.mapeAfter,
         cell.biasBefore, cell.biasAfter, cell.pctWithin10Before, cell.pctWithin10After, updated.map((u) => u.id),
         `${cell.organizationCount} organizations; ridge correction ${cell.rawMultiplier?.toFixed(4)}` +
           (cell.multiplier.toFixed(4) !== cell.rawMultiplier?.toFixed(4) ? `, clamped to baseline ×${cell.baselineMultiplier.toFixed(4)}` : '')],
      );
      const consumed = await client.query(
        `UPDATE public.should_cost_actuals SET calibration_consumed_at = $2, calibration_history_id = $3
          WHERE id = ANY($1::uuid[]) AND calibration_consumed_at IS NULL`,
        [cell.consumedActualIds, history[0].calibrated_at, history[0].id],
      );
      if (consumed.rowCount !== cell.consumedActualIds.length) {
        throw new Error(`${label}: expected to consume ${cell.consumedActualIds.length} pairs, consumed ${consumed.rowCount}`);
      }
      console.log(`  ×${cell.multiplier.toFixed(4)} (baseline ×${cell.baselineMultiplier.toFixed(4)}) ${label}: ${cell.sampleCount} pairs from ${cell.organizationCount} organizations consumed, ${updated.length} benchmark rows, MAPE ${cell.mapeBefore}% → ${cell.mapeAfter}%`);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => fail([error instanceof Error ? error.message : String(error)]));
