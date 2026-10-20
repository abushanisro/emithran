/* eslint-disable @typescript-eslint/no-require-imports */
// Telemetry OFF (no OTEL_EXPORTER_OTLP_ENDPOINT): proves the SDK is neither loaded nor initialised, the
// @Traced wrapper is a pass-through, and log entries carry no trace fields.
process.env.NODE_ENV = 'production';
delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

import { Writable } from 'stream';
import * as winston from 'winston';

import { startTelemetry } from '../../src/telemetry/start';
import { isTelemetryActive } from '../../src/telemetry/telemetry-state';
import { Traced } from '../../src/telemetry/traced';
import { Logger as WinstonLogger } from '../../src/common/logger/logger.service';
import { CorrelatedConsoleLogger } from '../../src/telemetry/correlated-console-logger';

const handle = startTelemetry();

const sentinel = Promise.resolve('original-promise');
class Service {
  @Traced('cost_summary')
  returnsStoredPromise(): Promise<string> {
    return sentinel;
  }
  @Traced('route_comparison')
  async rejects(): Promise<never> {
    throw new Error('boom');
  }
}

async function main() {
  const service = new Service();
  const samePromise = service.returnsStoredPromise() === sentinel;
  const rejection = await service.rejects().then(() => 'resolved', (e: Error) => e.message);

  const lines: string[] = [];
  const logger = new WinstonLogger();
  (logger as unknown as { logger: winston.Logger }).logger.add(
    new winston.transports.Stream({ stream: new Writable({ write: (chunk, _e, done) => { lines.push(String(chunk)); done(); } }) }),
  );
  logger.log('plain line', 'DisabledFixture');

  const stdout: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => { stdout.push(String(s)); return true; };
  new CorrelatedConsoleLogger({ logLevels: ['log'], colors: false }).log('console line', 'DisabledFixture');
  process.stdout.write = realWrite;

  const loaded = Object.keys(require.cache)
    .filter((key) => /node_modules[\\/]@opentelemetry[\\/](sdk-|exporter-|instrumentation|resources|core|otlp|semantic|context-async)/.test(key))
    .map((key) => key.replace(/.*node_modules[\\/]/, ''));

  // eslint-disable-next-line no-console
  console.log(`RESULT:${JSON.stringify({ handleIsNull: handle === null, active: isTelemetryActive(), loaded, samePromise, rejection, winstonLines: lines, consoleLines: stdout })}`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
