import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NesterUnavailable, runNester, type NestBody } from './nester';

const body: NestBody = {
  outline_points_mm: [[0, 0], [10, 0], [10, 10], [0, 10]],
  holes_mm: [],
  sheet_width_mm: 100,
  sheet_length_mm: 100,
  quantity: 5,
  kerf_mm: 0,
  edge_margin_mm: 0,
};

const OK = '{"ok":true,"result":{"sheet_width_mm":100,"sheet_length_mm":100,"parts_per_sheet":100,"placements":[],"utilization_pct":100,"sheets_required":1,"capped":false}}';

/** A stand-in `nester`: a shell script, so the process handling is tested for real (spawn, pipes, exit codes, kill). */
function fake(script: string): void {
  const file = join(mkdtempSync(join(tmpdir(), 'nester-')), 'nester');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  process.env.NESTER_BIN = file;
}

afterEach(() => {
  delete process.env.NESTER_BIN;
  delete process.env.NESTER_CONCURRENCY;
});

describe('runNester', () => {
  it('sends the request on stdin and returns the answer', async () => {
    fake(`read input; case "$input" in *'"quantity":5'*) printf '%s' '${OK}';; *) exit 9;; esac`);
    await expect(runNester(body)).resolves.toMatchObject({ ok: true, result: { parts_per_sheet: 100 } });
  });

  it('passes a refusal through as an answer, not as a failure', async () => {
    fake(`cat > /dev/null; printf '%s' '{"ok":false,"reason":"outline has only 2 point(s)"}'`);
    await expect(runNester(body)).resolves.toEqual({ ok: false, reason: 'outline has only 2 point(s)' });
  });

  it('gives the child an empty environment', async () => {
    process.env.SECRET_FOR_TEST = 'leak';
    fake(`cat > /dev/null; [ -n "\${SECRET_FOR_TEST+x}" ] && exit 9; printf '%s' '${OK}'`);
    await expect(runNester(body)).resolves.toMatchObject({ ok: true });
    delete process.env.SECRET_FOR_TEST;
  });

  it.each([
    ['a missing binary', () => { process.env.NESTER_BIN = '/no/such/nester'; }, /cannot run the nester/],
    ['a crash', () => fake('cat > /dev/null; echo boom >&2; exit 139'), /exited with code 139: boom/],
    ['output that is not JSON', () => fake('cat > /dev/null; echo not-json'), /not JSON/],
    ['an answer outside the contract', () => fake(`cat > /dev/null; printf '%s' '{"ok":true}'`), /outside its contract/],
  ])('reports %s as the nester being unavailable (never as a verdict on the part)', async (_label, arrange, message) => {
    arrange();
    await expect(runNester(body)).rejects.toThrow(NesterUnavailable);
    await expect(runNester(body)).rejects.toThrow(message);
  });

  it('kills a nester that never answers', async () => {
    fake('while :; do :; done');
    const started = Date.now();
    await expect(runNester(body, 600)).rejects.toThrow(/did not answer within 600 ms/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('runs at most NESTER_CONCURRENCY children at a time', async () => {
    process.env.NESTER_CONCURRENCY = '1';
    // each child holds a lock folder for 150 ms; a second child running at the same time would find it taken
    const lock = join(mkdtempSync(join(tmpdir(), 'nester-lock-')), 'held');
    fake(`cat > /dev/null; mkdir '${lock}' || exit 9; sleep 0.15; rmdir '${lock}'; printf '%s' '${OK}'`);
    const answers = await Promise.all([runNester(body), runNester(body), runNester(body)]);
    expect(answers.every((a) => a.ok)).toBe(true);
  });
});
