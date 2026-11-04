// End to end: one STEP file through the real casting worker host over its Unix socket, with the backend's own client (WorkerHostClient), and the
// result checked against the worker's contract. Run by casting-worker/e2e.sh inside a container that shares the host's socket volume.
//   ts-node scripts/casting-worker-e2e.ts <socket> <good.step> <corrupt.step> <hollow-box.step>
import * as fs from 'fs';
import { parseCastingResult } from '../src/modules/sand-casting/casting-result';
import { CASTING_SCHEMA_VERSION, CASTING_WORKER_VERSION } from '../src/modules/sand-casting/casting-analysis.types';
import { DRAW_AXIS_INPUT, PART_INPUT, drawDirectionMismatch, workerInputs } from '../src/modules/sand-casting/casting-config';
import { WorkerHostClient, WorkerRunError } from '../src/modules/sand-casting/worker-host-client';

const [socket, goodPath, corruptPath, boxPath] = process.argv.slice(2);
if (!socket || !goodPath || !corruptPath || !boxPath) {
  console.error('usage: casting-worker-e2e.ts <socket> <good.step> <corrupt.step> <hollow-box.step>');
  process.exit(64);
}
const host = new WorkerHostClient(socket, { deadlineMs: 120_000, answerMarginMs: 30_000, maxOutputs: 200, maxOutputBytes: 512 * 1024 * 1024 });
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`);
  if (!ok) failed += 1;
};

async function main(): Promise<void> {
  // A good part: result.json comes back, valid against the contract, with the worker version this backend was built for, and a mesh per part.
  const out = await host.run([{ name: 'part.step', bytes: fs.readFileSync(goodPath!) }]);
  check('a result.json comes back', out.result !== null);
  const result = parseCastingResult(JSON.parse(out.result!.toString('utf8')));
  check('the result matches the worker contract (schema)', true);
  check(`the worker is the one this backend expects (${CASTING_WORKER_VERSION}, schema ${CASTING_SCHEMA_VERSION})`, result.diagnostics.worker_version === CASTING_WORKER_VERSION && result.schema_version === CASTING_SCHEMA_VERSION, result.diagnostics);
  check('the part was read completely', result.status === 'complete', result.status);
  check('there is a part with a casting analysis and a mesh file', result.parts.length > 0 && result.parts.every((p) => p.casting != null) && result.parts.every((p) => !p.glb || out.parts.has(p.glb.replace(/^parts\//, ''))), result.parts.length);

  // The engineer's draw direction, through the host's real sandbox: the axis travels as the draw-axis input, the adapter turns it into --draw-axis,
  // and the worker measures along it. hollow-box.step is 100 x 60 x 40 mm, so along x, y, z it is 100, 60, 40 mm deep; automatic picks x.
  const box = fs.readFileSync(boxPath!);
  const measured = async (config: { drawDirection: 'auto' | 'x' | 'y' | 'z' }) => {
    const run = await host.run(workerInputs(box, config));
    const r = parseCastingResult(JSON.parse(run.result!.toString('utf8')));
    return { r, c: r.parts[0]?.casting, mismatch: drawDirectionMismatch(r, config) };
  };
  const auto = await measured({ drawDirection: 'auto' });
  check('automatic draw axis: x, chosen by the worker, 100 mm deep', auto.c?.draw_axis === 'x' && auto.c.draw_axis_source === 'auto' && auto.c.draw_depth_mm === 100, auto.c);
  for (const [axis, depth] of [['y', 60], ['z', 40]] as const) {
    const m = await measured({ drawDirection: axis });
    check(`draw axis ${axis} through the host: measured along ${axis} (${depth} mm deep), reported as requested`, m.c?.draw_axis === axis && m.c.draw_axis_source === 'requested' && m.c.draw_depth_mm === depth && m.mismatch === null, m.c);
    check(`draw axis ${axis}: the draw-axis input is not read as a STEP file`, m.r.inputs.length === 1, m.r.inputs);
  }
  try {
    await host.run([{ name: PART_INPUT, bytes: box }, { name: DRAW_AXIS_INPUT, bytes: Buffer.from('w') }]);
    check('a draw-axis input that is not x, y or z is refused', false, 'it ran');
  } catch (error) {
    check('a draw-axis input that is not x, y or z is refused, not guessed', error instanceof WorkerRunError, String(error));
  }

  // A file that is not STEP: the file's fault (exit code 2), permanent, with the stable code.
  try {
    await host.run([{ name: 'part.step', bytes: fs.readFileSync(corruptPath!) }]);
    check('a corrupt file is refused', false, 'it ran');
  } catch (error) {
    check('a corrupt file is the file\'s fault: unreadable_step, permanent', error instanceof WorkerRunError && error.code === 'unreadable_step' && error.permanent, String(error));
  }
}

main().then(
  () => process.exit(failed === 0 ? 0 : 1),
  (error) => {
    console.error('FAIL  e2e crashed:', error);
    process.exit(1);
  },
);
