/* eslint-disable @typescript-eslint/no-require-imports */
// Real exporters against a collector that is dead (connection refused) or hanging (accepts, never answers).
// Measures what the application would feel: request latency, memory while flooding spans, bounded shutdown,
// and that nothing surfaces as an unhandled rejection or uncaught exception.
//   node -r ts-node/register/transpile-only failopen.fixture.ts <dead|hanging>
process.env.NODE_ENV = 'production';

import * as net from 'net';

import { startTelemetry } from '../../src/telemetry/start';
import { Traced } from '../../src/telemetry/traced';
import { finish } from './exit';

const mode = process.argv[2] === 'hanging' ? 'hanging' : 'dead';
let unhandled = 0;
let uncaught = 0;
process.on('unhandledRejection', () => { unhandled += 1; });
process.on('uncaughtException', () => { uncaught += 1; });

class Costing {
  @Traced('route_comparison')
  async compare(): Promise<number> {
    return 1;
  }
}

async function main() {
  let collectorPort = 1; // reserved port: connection refused
  let collector: net.Server | undefined;
  let connections = 0;
  const heldSockets: net.Socket[] = [];
  if (mode === 'hanging') {
    collector = net.createServer((socket) => { connections += 1; heldSockets.push(socket); socket.on('data', () => undefined); socket.on('error', () => undefined); });
    await new Promise<void>((resolve) => collector!.listen(0, '127.0.0.1', resolve));
    collectorPort = (collector.address() as net.AddressInfo).port;
  }

  const handle = startTelemetry({
    env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorPort}`, OTEL_TRACES_SAMPLER_ARG: '1' },
  });
  if (!handle) throw new Error('telemetry did not start');

  // A real instrumented HTTP server doing @Traced work, like an API route.
  const http = require('http') as typeof import('http');
  const costing = new Costing();
  const server = http.createServer(async (_req, res) => {
    await costing.compare();
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;

  const measure = async (count: number): Promise<number[]> => {
    const samples: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = process.hrtime.bigint();
      await (await fetch(url)).text();
      samples.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    return samples.sort((a, b) => a - b);
  };
  const latencies = await measure(100);

  // Far more spans than the queue holds, with the exporter unable to drain: they must be dropped, not piled up.
  const { trace } = require('@opentelemetry/api') as typeof import('@opentelemetry/api');
  const tracer = trace.getTracer('flood');
  const heapBefore = process.memoryUsage().heapUsed;
  const floodStart = process.hrtime.bigint();
  // 'noflood' leaves the export slots free, so shutdown's flush really goes to the collector and hangs there.
  if (process.argv[3] !== 'noflood') for (let i = 0; i < 50_000; i += 1) tracer.startSpan('flood').end();
  else for (let i = 0; i < 10; i += 1) tracer.startSpan('few').end();
  const floodMs = Number(process.hrtime.bigint() - floodStart) / 1e6;
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);

  // Let the event loop run so the queued exports actually reach the collector (and, if hanging, hang there),
  // then measure requests again WHILE exports are stuck.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const connectionsDuringHang = connections;
  const latenciesWhileStuck = await measure(100);

  const shutdownStart = process.hrtime.bigint();
  await handle.shutdown();
  const shutdownMs = Number(process.hrtime.bigint() - shutdownStart) / 1e6;

  // eslint-disable-next-line no-console
  console.log(`RESULT:${JSON.stringify({
    mode,
    p50Ms: latencies[50],
    maxMs: latencies[latencies.length - 1],
    p50StuckMs: latenciesWhileStuck[50],
    maxStuckMs: latenciesWhileStuck[latenciesWhileStuck.length - 1],
    floodMs,
    heapDeltaMb,
    shutdownMs,
    connections: connectionsDuringHang,
    unhandled,
    uncaught,
  })}`);
  server.close();
  for (const socket of heldSockets) socket.destroy(); // the hung exports' connections, so the process can end
  collector?.close();
}

main().then(() => finish(0), (error) => { console.error(error); void finish(1); });
