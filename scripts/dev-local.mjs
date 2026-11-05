#!/usr/bin/env node
/**
 * npm run dev:local - the whole local stack with one command, in the order sign-in needs it:
 *   1. the local data containers (Postgres, file store, data API), started as they are; nothing is rebuilt or deleted
 *   2. every migration newer than the local database (local only: the address is fixed to 127.0.0.1, never stage or production),
 *      then the data API reloads the schema, so code pulled since yesterday finds the tables and functions it expects
 *   3. the backend (port 4000) and the web app (port 3000), unless one is already running; Ctrl+C stops what this started
 * A stale database or a backend that is not running both look like "sign-in sends me back to the sign-in page"; this removes both.
 * First-time setup (loading a baseline) is still backend/scripts/local-data.sh load.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const LOCAL_DB = `postgres://postgres:postgres@127.0.0.1:${process.env.LOCAL_PG_PORT ?? '54322'}/postgres`;
const COMPOSE = ['compose', '-f', path.join(root, 'docker-compose.local-data.yml'), '--profile', 'api'];
const isWindows = process.platform === 'win32';
const children = [];

const step = (text) => console.log(`\n\x1b[36m==> ${text}\x1b[0m`);
function fail(text) {
  console.error(`\n\x1b[31mx ${text}\x1b[0m`);
  stopChildren();
  process.exit(1);
}
// Only npm needs a shell on Windows (it is npm.cmd). docker is a real program, and a shell would split quoted SQL into pieces.
const needsShell = (command) => isWindows && command === 'npm';
function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: needsShell(command), ...options });
}
function quiet(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: 'ignore', shell: needsShell(command) });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}
async function waitFor(what, check, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await check()) return;
    await sleep(1000);
  }
  fail(`timed out after ${seconds}s waiting for ${what}`);
}

/**
 * Why a started process refused to boot, by name. Nest's watch mode does not exit when the app fails to start (it waits for a file
 * change), so the port would simply never open; the reason is read from its output instead, and the wait ends at once.
 */
const bootFailures = {};
const BOOT_FAILURE = /ERROR \[ExceptionHandler\]|Configuration validation error|EADDRINUSE|has failed the following constraints/;

/** Runs a long-lived npm script with its output prefixed, so the backend and the web app can share one window. */
function start(name, color, cwd, script) {
  const child = spawn('npm', ['run', script], { cwd, shell: isWindows, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let partial = '';
    stream.on('data', (chunk) => {
      // Nest's watch mode clears the screen on every rebuild, which would wipe the other process's output.
      const lines = (partial + chunk.toString().replace(/\x1b\[[0-9;]*[HJ]/g, '')).split(/\r?\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        process.stdout.write(prefix + line + '\n');
        if (BOOT_FAILURE.test(line)) (bootFailures[name] ??= []).push(line.replace(/\x1b\[[0-9;]*m/g, '').trim());
      }
    });
  }
  child.on('exit', (code) => {
    console.log(`${prefix}stopped (exit code ${code ?? 'signal'})`);
    if (!stopping) console.log(`${prefix}\x1b[33mrun npm run dev:local again to restart it\x1b[0m`);
  });
}

let stopping = false;
function stopChildren() {
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    // npm on Windows runs in a shell; only taskkill /T reaches the node process under it.
    if (isWindows) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGINT');
  }
}
process.on('SIGINT', () => { stopChildren(); process.exit(0); });
process.on('SIGTERM', () => { stopChildren(); process.exit(0); });

async function main() {
  step('1/4 Docker and the local data containers');
  if (quiet('docker', ['info']).status !== 0) fail('Docker Desktop is not running. Start it, wait until it says "running", then run npm run dev:local again.');
  if (run('docker', [...COMPOSE, 'start']).status !== 0) {
    fail('the local data containers could not start. If they were never created, do the first-time setup: backend/scripts/local-data.sh load');
  }
  await waitFor('Postgres', () => quiet('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0, 60);

  step('2/4 Database migrations (local database only)');
  const migrate = run('npm', ['run', '-s', 'db:migrate', '--', '--env', 'local'], {
    cwd: backendDir,
    env: { ...process.env, MIGRATE_DATABASE_URL: LOCAL_DB },
  });
  if (migrate.status !== 0) fail('a migration failed (see above). The backend was not started, because sign-in would fail against this database.');
  run('docker', [...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-qc', "NOTIFY pgrst, 'reload schema'"]);

  step('3/4 Backend (port 4000) and web app (port 3000)');
  if (await portOpen(4000)) console.log('backend is already running on port 4000: leaving it as it is');
  else start('backend', '35', backendDir, 'start:dev');
  if (await portOpen(3000)) console.log('web app is already running on port 3000: leaving it as it is');
  else start('web', '32', root, 'dev');

  step('4/4 Waiting for the backend to answer (the first build takes a few minutes)');
  const refused = (name) => {
    if (!bootFailures[name]) return false;
    fail(
      `the ${name} refused to start:\n  ${bootFailures[name].join('\n  ')}\n` +
        (name === 'backend'
          ? 'Usually a setting in the root .env is missing or malformed after new code was pulled: compare it with .env.example ' +
            '(the line named above), fix it, then run npm run dev:local again.'
          : 'See the lines above.'),
    );
  };
  await waitFor('the backend on port 4000', async () => { refused('backend'); return portOpen(4000); }, 600);
  await waitFor('the web app on port 3000', async () => { refused('web'); return portOpen(3000); }, 300);
  await checkApiAddress();
  console.log('\n\x1b[32m✓ Ready: open http://localhost:3000 and sign in. Keep this window open; Ctrl+C stops everything it started.\x1b[0m\n');
}

/**
 * The web app forwards every API call to NEXT_PUBLIC_API_URL (or API_URL). When the backend's routes move (as /v1/api became /api/v1
 * in #107) and the .env still names the old address, every call 404s and sign-in can never complete, though both servers run.
 * The "who is this" route answers 401 without a login when the address is right, and 404 when it is not.
 */
async function checkApiAddress() {
  const envFile = path.join(root, '.env');
  const settings = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const apiBase = (process.env.API_URL ?? settings.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? settings.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
  if (!apiBase) fail('NEXT_PUBLIC_API_URL is not set in the root .env (see .env.example).');
  let status;
  try {
    status = (await fetch(`${apiBase}/auth/me`, { signal: AbortSignal.timeout(10_000) })).status;
  } catch (error) {
    fail(`the backend could not be reached at ${apiBase} (${error instanceof Error ? error.message : String(error)}). Check NEXT_PUBLIC_API_URL in the root .env.`);
  }
  if (status === 404) {
    const example = fs.existsSync(path.join(root, '.env.example'))
      ? parseEnv(fs.readFileSync(path.join(root, '.env.example'), 'utf8')).NEXT_PUBLIC_API_URL
      : undefined;
    fail(
      `the web app sends API calls to ${apiBase}, but the backend has no such address (404), so sign-in cannot complete.\n` +
        `  Set NEXT_PUBLIC_API_URL in the root .env to the backend's current address${example ? ` (.env.example: ${example})` : ''}, then run npm run dev:local again.`,
    );
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
