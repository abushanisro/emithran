/* eslint-disable @typescript-eslint/no-require-imports */
// Run by src/telemetry/telemetry.integration.spec.ts in a plain Node child process (OpenTelemetry patches
// http/undici through require hooks, which Jest's module registry bypasses). Starts REAL telemetry with
// in-memory exporters, boots a small Nest app on the real interceptor/loggers, makes it call an echo server
// through axios and through global fetch, and prints one RESULT line of JSON for the test to assert on.
process.env.NODE_ENV = 'production'; // winston: console transport only, no log files
process.env.LOG_LEVEL = 'info';
// argv: <sampling ratio, default 1> <flags of the incoming traceparent, default 01>
const RATIO = process.argv[2] ?? '1';
const INCOMING_FLAGS = process.argv[3] ?? '01';

import { startTelemetry } from '../../src/telemetry/start';
import { finish } from './exit';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import { InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';

const spanExporter = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const metricReader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 3_600_000 });

const handle = startTelemetry({
  env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9', OTEL_TRACES_SAMPLER_ARG: RATIO },
  traceExporter: spanExporter,
  metricReader,
});
if (!handle) throw new Error('telemetry did not start');

// Everything below is loaded AFTER startTelemetry(), as in main.ts.
const http = require('http') as typeof import('http');
const axios = require('axios').default as typeof import('axios').default;
const { Controller, Get, Module, Param, UseGuards, ForbiddenException, Logger: NestLogger } = require('@nestjs/common') as typeof import('@nestjs/common');
const { NestFactory } = require('@nestjs/core') as typeof import('@nestjs/core');
const { CorrelatedConsoleLogger } = require('../../src/telemetry/correlated-console-logger') as typeof import('../../src/telemetry/correlated-console-logger');
const { httpMetricsMiddleware } = require('../../src/telemetry/http-metrics.middleware') as typeof import('../../src/telemetry/http-metrics.middleware');
const { Traced } = require('../../src/telemetry/traced') as typeof import('../../src/telemetry/traced');
const { Logger: WinstonLogger } = require('../../src/common/logger/logger.service') as typeof import('../../src/common/logger/logger.service');

interface Seen { path: string; traceparent: string | null; authorization: string | null }
const seen: Seen[] = [];

const echo = http.createServer((req, res) => {
  seen.push({ path: req.url ?? '', traceparent: (req.headers.traceparent as string) ?? null, authorization: (req.headers.authorization as string) ?? null });
  res.end('ok');
});

class CostingStub {
  @Traced('route_comparison')
  async compare(): Promise<string> {
    return 'done';
  }
}

const winstonLogger = new WinstonLogger();
const nestLogger = new NestLogger('FixtureController');
const costing = new CostingStub();
let echoBase = '';

// Rejects before any interceptor runs, like the real auth/throttle guards.
class DenyGuard {
  canActivate(): boolean {
    throw new ForbiddenException();
  }
}

@Controller({ path: 'blocked' })
class BlockedController {
  @Get()
  @UseGuards(DenyGuard)
  never() {
    return { never: true };
  }
}

@Controller({ path: 'parts' })
class FixtureController {
  @Get(':id')
  async handle(@Param('id') id: string) {
    nestLogger.log(`nest-path line for ${id}`);
    winstonLogger.log(`winston-path line for ${id}`, 'FixtureController');
    await axios.get(`${echoBase}/via-axios?customer=ACME&file=bracket.step`, { headers: { authorization: 'Bearer SECRET-TOKEN' } });
    await fetch(`${echoBase}/via-fetch?file=bracket.step`, { headers: { authorization: 'Bearer SECRET-TOKEN' } });
    await costing.compare();
    return { ok: true };
  }
}

@Module({ controllers: [FixtureController, BlockedController] })
class FixtureModule {}

async function main() {
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve));
  echoBase = `http://127.0.0.1:${(echo.address() as import('net').AddressInfo).port}`;

  const app = await NestFactory.create(FixtureModule, { logger: new CorrelatedConsoleLogger({ logLevels: ['log', 'warn', 'error'] }) });
  app.use(httpMetricsMiddleware);
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${(app.getHttpServer().address() as import('net').AddressInfo).port}`;

  // 1) an upstream trace arrives with a traceparent; 2) a request with none starts a new root trace.
  const upstreamTrace = '0af7651916cd43dd8448eb211c80319c';
  await fetch(`${base}/parts/item-aaa-111?token=QUERY-SECRET`, { headers: { traceparent: `00-${upstreamTrace}-b7ad6b7169203331-${INCOMING_FLAGS}` } });
  const afterFirst = seen.length;
  await fetch(`${base}/parts/item-bbb-222`);
  const blocked = await fetch(`${base}/blocked`);
  const blockedStatus = blocked.status;
  await fetch(`${base}/no-such-route/user-ccc-333`);

  await handle!.flush();
  const spans = spanExporter.getFinishedSpans().map((s) => ({
    name: s.name,
    kind: s.kind,
    traceId: s.spanContext().traceId,
    spanId: s.spanContext().spanId,
    parentSpanId: s.parentSpanContext?.spanId ?? null,
    attributes: s.attributes,
    eventAttributes: s.events.map((e) => e.attributes ?? {}),
  }));
  const collected = await metricReader.collect();
  const metrics = (collected.resourceMetrics?.scopeMetrics ?? []).flatMap((scope) =>
    scope.metrics.map((m) => ({
      name: m.descriptor.name,
      labelKeys: [...new Set(m.dataPoints.flatMap((p) => Object.keys(p.attributes)))],
      labels: m.dataPoints.map((p) => p.attributes),
    })),
  );

  // eslint-disable-next-line no-console
  console.log(`RESULT:${JSON.stringify({ upstreamTrace, seen, firstRequestCalls: afterFirst, blockedStatus, spans, metrics })}`);
  await app.close();
  echo.close();
  await handle!.shutdown();
}

main().then(
  () => finish(0),
  (error) => {
    // eslint-disable-next-line no-console
    console.error('FIXTURE FAILED', error);
    void finish(1);
  },
);
