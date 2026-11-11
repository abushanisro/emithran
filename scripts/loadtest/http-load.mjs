// Staged load against signed-in endpoints, measuring what a user feels: latency percentiles, requests/second and failures at each concurrency step.
//   node scripts/loadtest/http-load.mjs --cookie-file <file> --base https://app.emithran.com --steps 10,25,50,100 --seconds 20 --paths /api/v1/projects,...
// Read-only GETs only. It stops climbing when a step fails more than --max-fail (default 5 %), so a weak server is found, not flattened.
import autocannon from 'autocannon';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const cookie = readFileSync(arg('cookie-file'), 'utf8').trim();
const base = arg('base', 'https://app.emithran.com');
const steps = arg('steps', '10,25,50,100').split(',').map(Number);
const seconds = Number(arg('seconds', '20'));
const maxFail = Number(arg('max-fail', '0.05'));
const paths = arg('paths').split(',');
const label = arg('label', 'mixed');
const results = [];

for (const connections of steps) {
  const r = await autocannon({
    url: base, connections, duration: seconds, timeout: 30, pipelining: 1,
    headers: { cookie, accept: 'application/json' },
    requests: paths.map((p) => ({ method: 'GET', path: p })),
  });
  const total = r.requests.total + r.errors + r.timeouts;
  const bad = r.non2xx + r.errors + r.timeouts;
  const row = { label, connections, rps: Math.round(r.requests.average), p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max,
    requests: r.requests.total, non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts, failRate: total ? +(bad / total).toFixed(4) : 0, mbps: +(r.throughput.average / 1e6).toFixed(2) };
  results.push(row);
  console.log(`${label} @${String(connections).padStart(3)} conn: ${String(row.rps).padStart(4)} req/s  p50 ${String(row.p50).padStart(5)} ms  p99 ${String(row.p99).padStart(5)} ms  fail ${(row.failRate * 100).toFixed(1)}%  (non-2xx ${row.non2xx}, errors ${row.errors}, timeouts ${row.timeouts})`);
  if (row.failRate > maxFail) { console.log(`stopping: more than ${maxFail * 100}% failed at ${connections} connections`); break; }
  await new Promise((res) => setTimeout(res, 8000)); // let the servers drain between steps
}
if (arg('out')) writeFileSync(arg('out'), JSON.stringify(results, null, 2));
