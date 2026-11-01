#!/usr/bin/env ts-node
/**
 * Should-cost calibration, operator-run (it is not reachable over HTTP). Multiplies the global BENCHMARK mhr_records rates of each
 * (process_family, location) cell by the correction its actual/prediction pairs call for (src/modules/should-cost/calibration.ts),
 * logs the run in rate_calibration_history, and marks the pairs it used as consumed (migration 941) — in ONE transaction. A pair is
 * applied at most once, so a re-run with no new pairs changes nothing.
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

import { targetProblems } from '../src/common/migrations/migration-plan';
import { planCalibration, type CalibrationPair } from '../src/modules/should-cost/calibration';

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

function sslFor(databaseUrl: string): false | { rejectUnauthorized: boolean; ca?: string } {
  const host = new URL(databaseUrl).hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(host) || /sslmode=disable/.test(databaseUrl)) return false;
  const caFile = process.env.MIGRATE_DATABASE_SSL_CA;
  return caFile ? { rejectUnauthorized: true, ca: fs.readFileSync(caFile, 'utf8') } : { rejectUnauthorized: false };
}

async function main(): Promise<void> {
  const env = option('env') ?? '';
  const settings = loadSettings(env);
  const dryRun = flag('dry-run');
  const problems = targetProblems({ env, appEnv: settings.APP_ENV, databaseUrl: settings.MIGRATE_DATABASE_URL, confirm: flag('confirm'), dryRun });
  if (problems.length > 0) fail(problems);

  const databaseUrl = settings.MIGRATE_DATABASE_URL as string;
  const client = new Client({ connectionString: databaseUrl, ssl: sslFor(databaseUrl) });
  await client.connect();
  try {
    const missing = (await client.query<{ missing: string }>(
      `SELECT t AS missing FROM unnest(ARRAY['should_cost_actuals', 'should_cost_predictions', 'rate_calibration_history']) t
        WHERE to_regclass('public.' || t) IS NULL
       UNION ALL
       SELECT 'should_cost_actuals.calibration_consumed_at (migration 941)'
        WHERE to_regclass('public.should_cost_actuals') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'should_cost_actuals' AND column_name = 'calibration_consumed_at')`,
    )).rows.map((r) => r.missing);
    if (missing.length > 0) fail([`not in this database: ${missing.join(', ')}`]);

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK]);
    const { rows } = await client.query<{ id: string; actual: string | null; predicted: string | null; family: string | null; location: string | null }>(
      `SELECT a.id, a.actual_total_cost_usd AS actual, p.predicted_total_cost_usd AS predicted, p.process_family AS family, p.location
         FROM public.should_cost_actuals a JOIN public.should_cost_predictions p ON p.id = a.prediction_id
        WHERE a.calibration_consumed_at IS NULL
        FOR UPDATE OF a`,
    );
    const pairs: CalibrationPair[] = rows.map((r) => ({
      actualId: r.id, actualTotalCostUsd: r.actual, predictedTotalCostUsd: r.predicted, processFamily: r.family, location: r.location, consumed: false,
    }));
    const plan = planCalibration(pairs);
    console.log(`${env}: ${pairs.length} unconsumed pairs, ${plan.length} cells${dryRun ? ' (dry run)' : ''}`);

    for (const cell of plan) {
      const label = `${cell.processFamily}/${cell.location}`;
      if (cell.multiplier == null) {
        console.log(`  skip  ${label}: ${cell.skippedReason}`);
        continue;
      }
      const filter = `process_family = $1 AND source_type = 'BENCHMARK' AND lower(location) = lower($2) AND total_machine_hour_rate IS NOT NULL`;
      if (dryRun) {
        const { rows: count } = await client.query<{ n: string }>(`SELECT count(*) AS n FROM public.mhr_records WHERE ${filter}`, [cell.processFamily, cell.location]);
        console.log(`  would ×${cell.multiplier.toFixed(4)} ${label}: ${cell.sampleCount} pairs, ${count[0].n} benchmark rows`);
        continue;
      }
      const { rows: updated } = await client.query<{ id: string }>(
        `UPDATE public.mhr_records
            SET total_machine_hour_rate = round(total_machine_hour_rate * $3, 2),
                mhr_usd_per_hour = CASE WHEN mhr_usd_per_hour IS NULL THEN NULL ELSE round(mhr_usd_per_hour * $3, 2) END
          WHERE ${filter} RETURNING id`,
        [cell.processFamily, cell.location, cell.multiplier],
      );
      const { rows: history } = await client.query<{ id: string; calibrated_at: Date }>(
        `INSERT INTO public.rate_calibration_history
           (process_family, location, correction_multiplier, sample_count, mape_before, mape_after, bias_before, bias_after,
            pct_within_10pct_before, pct_within_10pct_after, method, applied_to_mhr_ids, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ridge_regression', $11, $12) RETURNING id, calibrated_at`,
        [cell.processFamily, cell.location, cell.multiplier, cell.sampleCount, cell.mapeBefore, cell.mapeAfter, cell.biasBefore, cell.biasAfter,
         cell.pctWithin10Before, cell.pctWithin10After, updated.map((u) => u.id),
         cell.rawMultiplier !== cell.multiplier ? `raw multiplier ${cell.rawMultiplier?.toFixed(4)} clamped to ${cell.multiplier.toFixed(4)}` : null],
      );
      const consumed = await client.query(
        `UPDATE public.should_cost_actuals SET calibration_consumed_at = $2, calibration_history_id = $3
          WHERE id = ANY($1::uuid[]) AND calibration_consumed_at IS NULL`,
        [cell.consumedActualIds, history[0].calibrated_at, history[0].id],
      );
      if (consumed.rowCount !== cell.consumedActualIds.length) {
        throw new Error(`${label}: expected to consume ${cell.consumedActualIds.length} pairs, consumed ${consumed.rowCount}`);
      }
      console.log(`  ×${cell.multiplier.toFixed(4)} ${label}: ${cell.sampleCount} pairs consumed, ${updated.length} benchmark rows, MAPE ${cell.mapeBefore}% → ${cell.mapeAfter}%`);
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
