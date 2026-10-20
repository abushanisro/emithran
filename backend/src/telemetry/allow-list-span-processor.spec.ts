import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type ReadableSpan, type SpanProcessor } from '@opentelemetry/sdk-trace';

import { AllowListSpanProcessor, isAllowedSpanAttribute } from './allow-list-span-processor';

function setup() {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new AllowListSpanProcessor(new SimpleSpanProcessor({ exporter }))] });
  return { exporter, tracer: provider.getTracer('test') };
}

describe('AllowListSpanProcessor: nothing outside the allow-list leaves the process', () => {
  it('drops URLs with query strings, headers, statements, filenames and customer fields; keeps the allow-listed ones', () => {
    const { exporter, tracer } = setup();
    const span = tracer.startSpan('GET /bom-items/:id');
    span.setAttributes({
      'http.request.method': 'GET',
      'http.route': '/bom-items/:id',
      'http.response.status_code': 200,
      'emithran.operation': 'route_comparison',
      'nestjs.controller': 'BOMItemsController',
      // unsafe, all of which an instrumentation could plausibly record
      'url.full': 'https://x.supabase.co/rest/v1/bom_items?name=eq.ACME-bracket',
      'http.url': 'https://x/y?token=SECRET',
      'http.target': '/bom-items/9c1f?file=bracket.step',
      'url.path': '/storage/v1/object/cad/bracket.step',
      'url.query': 'token=SECRET',
      'http.request.header.authorization': 'Bearer SECRET',
      'http.user_agent': 'curl',
      'db.statement': 'select * from bom_items where customer = ACME',
      'file.name': 'bracket.step',
      'enduser.id': 'user-123',
    });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(Object.keys(exported.attributes).sort()).toEqual(
      ['emithran.operation', 'http.request.method', 'http.response.status_code', 'http.route', 'nestjs.controller'].sort(),
    );
    expect(JSON.stringify(exported.attributes)).not.toMatch(/SECRET|ACME|bracket|user-123/);
  });

  it('keeps only the exception class on error events: the message and stack can carry values', () => {
    const { exporter, tracer } = setup();
    const span = tracer.startSpan('failing');
    span.recordException(new TypeError('constraint violated for customer ACME, file bracket.step'));
    span.end();

    const [exported] = exporter.getFinishedSpans();
    expect(exported.events).toHaveLength(1);
    expect(Object.keys(exported.events[0].attributes ?? {})).toEqual(['exception.type']);
    expect(JSON.stringify(exported.events)).not.toMatch(/ACME|bracket|constraint/);
  });

  it('strips a query string from a span name', () => {
    const { exporter, tracer } = setup();
    tracer.startSpan('GET /x?token=SECRET').end();
    expect(exporter.getFinishedSpans()[0].name).toBe('GET /x');
  });

  it('drops a span it cannot sanitise instead of exporting it unsanitised or throwing into the request', () => {
    const passedOn: ReadableSpan[] = [];
    const next = { onStart: () => undefined, onEnd: (s: ReadableSpan) => passedOn.push(s), forceFlush: async () => undefined, shutdown: async () => undefined } as SpanProcessor;
    const processor = new AllowListSpanProcessor(next);
    const broken = {
      name: 'broken',
      get attributes(): never {
        throw new Error('cannot read');
      },
      events: [],
    } as unknown as ReadableSpan;

    expect(() => processor.onEnd(broken)).not.toThrow();
    expect(passedOn).toHaveLength(0);
  });

  it('allows only the documented attribute names and prefixes', () => {
    expect(isAllowedSpanAttribute('http.route')).toBe(true);
    expect(isAllowedSpanAttribute('emithran.anything')).toBe(true);
    expect(isAllowedSpanAttribute('nestjs.type')).toBe(true);
    for (const key of ['url.full', 'http.url', 'http.target', 'db.statement', 'enduser.id', 'http.request.header.cookie', 'process.command_args']) {
      expect(isAllowedSpanAttribute(key)).toBe(false);
    }
  });
});
