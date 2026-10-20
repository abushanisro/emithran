/* eslint-disable @typescript-eslint/no-require-imports */
// Prints READY, then waits to be terminated. With a hanging collector, SIGTERM must still end the process
// within the shutdown bound, and by the original signal (flushOnTermination re-raises it).
process.env.NODE_ENV = 'production';

import * as net from 'net';

import { startTelemetry, flushOnTermination } from '../../src/telemetry/start';

async function main() {
  const collector = net.createServer((socket) => { socket.on('data', () => undefined); socket.on('error', () => undefined); });
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  const port = (collector.address() as net.AddressInfo).port;

  const handle = startTelemetry({ env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_TRACES_SAMPLER_ARG: '1' } });
  if (!handle) throw new Error('telemetry did not start');
  // Report how long the bounded shutdown actually took (printed before the signal is re-raised).
  const boundedShutdown = handle.shutdown.bind(handle);
  handle.shutdown = () => {
    const started = Date.now();
    return boundedShutdown().finally(() => console.log(`SHUTDOWN_MS:${Date.now() - started}`));
  };
  flushOnTermination(handle);

  const { trace } = require('@opentelemetry/api') as typeof import('@opentelemetry/api');
  for (let i = 0; i < 100; i += 1) trace.getTracer('t').startSpan('s').end();

  setInterval(() => undefined, 1_000); // keep the process alive until the signal arrives
  // eslint-disable-next-line no-console
  console.log('READY');
}

main().catch((error) => { console.error(error); process.exit(1); });
