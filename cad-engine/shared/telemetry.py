"""OpenTelemetry for a mithran Python engine: tracing, one bounded metric, log correlation. Off by default.

Identical in cad-engine (shared/telemetry.py) and ecad-engine (telemetry.py): the two images have separate
build contexts and cannot share a file, so a change here is made in both.

Contract (the same one the NestJS backend keeps, backend/src/telemetry):
  * OFF unless OTEL_EXPORTER_OTLP_ENDPOINT is set. When off, nothing from opentelemetry is imported, stage() is a
    plain nullcontext, and logs are untouched. A bad value turns telemetry off with a warning; it never stops the engine.
  * Inbound W3C `traceparent` is continued, so a backend -> engine call is one trace. No baggage.
  * Fail open. Spans and metrics leave through bounded queues with hard export timeouts, in background threads, so a
    dead or hanging collector costs the request nothing; beyond the queue, spans are dropped. Shutdown is bounded.
  * Nothing sensitive leaves the process. Spans pass through an attribute allow-list (no URL, query, header, filename,
    exception message or stack); a span that cannot be sanitised is dropped, never exported raw. Metric labels are a
    closed set (stage name, outcome, HTTP method/status).
  * Exporter problems are logged at most once a minute, as one line, without a traceback.
"""
from __future__ import annotations

import atexit
import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, ContextManager, Mapping, Optional

log = logging.getLogger("telemetry")

# The only stage names that may become a span name or a metric label. Closed so a label can never carry request data.
STAGES = frozenset({"step_load", "geometry_analysis", "component_features", "assembly_analysis", "extract_board", "render_board"})

_ALLOWED_SPAN_ATTRIBUTES = frozenset(
    {
        "http.method", "http.request.method", "http.route", "http.status_code", "http.response.status_code",
        "http.scheme", "url.scheme", "http.flavor", "network.protocol.version", "http.server_name",
        "net.host.port", "server.port", "error.type", "asgi.event.type",
    }
)
_ALLOWED_SPAN_ATTRIBUTE_PREFIXES = ("emithran.",)
_ALLOWED_EVENT_ATTRIBUTES = frozenset({"exception.type"})
# Labels the FastAPI instrumentation's own http.server.* metrics may carry (never the raw target/path or host).
_ALLOWED_HTTP_METRIC_KEYS = frozenset(
    {"http.method", "http.request.method", "http.status_code", "http.response.status_code", "http.scheme", "url.scheme",
     "http.flavor", "network.protocol.version"}
)
# Health probes would dominate the traces and say nothing.
_EXCLUDED_URLS = "/health,/ready"


@dataclass(frozen=True)
class TelemetryConfig:
    endpoint: str
    service_name: str
    environment: str
    sampler_ratio: float
    max_queue_size: int = 2048
    max_export_batch_size: int = 512
    schedule_delay_ms: int = 5_000
    export_timeout_ms: int = 5_000
    metric_interval_ms: int = 30_000
    shutdown_timeout_s: float = 3.0


def read_config(env: Mapping[str, str], default_service: str, environment: str) -> tuple[Optional[TelemetryConfig], Optional[str]]:
    """(config, warning). config is None when telemetry is off or the configuration is unusable."""
    endpoint = (env.get("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    if not endpoint:
        return None, None
    if not endpoint.lower().startswith(("http://", "https://")) or "://" not in endpoint or not endpoint.split("://", 1)[1]:
        return None, "OTEL_EXPORTER_OTLP_ENDPOINT is not an http(s) URL; telemetry is disabled."
    ratio = 0.1
    raw = (env.get("OTEL_TRACES_SAMPLER_ARG") or "").strip()
    if raw:
        try:
            ratio = float(raw)
        except ValueError:
            ratio = -1.0
        if not 0.0 <= ratio <= 1.0:
            return None, "OTEL_TRACES_SAMPLER_ARG must be a number between 0 and 1; telemetry is disabled."
    return (
        TelemetryConfig(
            endpoint=endpoint.rstrip("/"),
            service_name=(env.get("OTEL_SERVICE_NAME") or "").strip() or default_service,
            environment=environment,
            sampler_ratio=ratio,
        ),
        None,
    )


class _State:
    def __init__(self) -> None:
        self.active = False
        self.tracer: Any = None
        self.histogram: Any = None
        self.tracer_provider: Any = None
        self.meter_provider: Any = None
        self.app: Any = None
        self.shutdown_timeout_s = 3.0
        self.filters: list[tuple[Any, logging.Filter]] = []
        self.atexit_registered = False


_state = _State()


def is_active() -> bool:
    return _state.active


# ---------------------------------------------------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------------------------------------------------
class _TraceCorrelationFilter(logging.Filter):
    """Appends the active trace and span id to a log message. Only while a trace is active; otherwise the record is untouched."""

    def filter(self, record: logging.LogRecord) -> bool:
        # The same record passes through every handler this filter is on; append the ids once.
        if getattr(record, "_trace_correlated", False):
            return True
        try:
            from opentelemetry import trace

            context = trace.get_current_span().get_span_context()
            if context.is_valid:
                record.msg = f"{record.getMessage()} trace_id={format(context.trace_id, '032x')} span_id={format(context.span_id, '016x')}"
                record.args = None
                record._trace_correlated = True  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - correlation must never break logging
            pass
        return True


class _RateLimitedExporterLogs(logging.Filter):
    """The SDK logs every failed export (with a traceback). Keep one short line a minute, with how many were held back."""

    def __init__(self, interval_s: float = 60.0, clock=time.monotonic) -> None:
        super().__init__()
        self._interval = interval_s
        self._clock = clock
        self._last = float("-inf")
        self._suppressed = 0
        self._lock = threading.Lock()

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno < logging.WARNING:
            return True
        with self._lock:
            now = self._clock()
            if now - self._last < self._interval:
                self._suppressed += 1
                return False
            more = f" (+{self._suppressed} similar in the last interval)" if self._suppressed else ""
            self._suppressed = 0
            self._last = now
        record.msg = f"{str(record.getMessage()).splitlines()[0][:200]}{more}"
        record.args = None
        record.exc_info = None
        record.exc_text = None
        return True


def _install_log_filters() -> None:
    correlation = _TraceCorrelationFilter()
    # Root handlers and uvicorn.error carry plain messages. uvicorn.access formats from record.args, so it is left alone.
    for owner in (logging.getLogger(), logging.getLogger("uvicorn.error")):
        for handler in owner.handlers:
            handler.addFilter(correlation)
            _state.filters.append((handler, correlation))
    limiter = _RateLimitedExporterLogs()
    otel_logger = logging.getLogger("opentelemetry")
    otel_logger.addFilter(limiter)
    _state.filters.append((otel_logger, limiter))


def _remove_log_filters() -> None:
    for owner, flt in _state.filters:
        owner.removeFilter(flt)
    _state.filters.clear()


# ---------------------------------------------------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------------------------------------------------
def setup(
    app: Any,
    *,
    service_name: str,
    environment: str,
    env: Optional[Mapping[str, str]] = None,
    span_exporter: Any = None,
    metric_reader: Any = None,
) -> bool:
    """Instrument `app` and start exporting. Returns whether telemetry is on. Never raises.

    span_exporter / metric_reader are test seams (in-memory exporters); production passes neither.
    """
    import os

    config, warning = read_config(env if env is not None else os.environ, service_name, environment)
    if warning:
        log.warning("[telemetry] %s", warning)
    if config is None:
        return False
    try:
        _start(app, config, span_exporter, metric_reader)
        return True
    except Exception as error:  # noqa: BLE001 - starting telemetry must never stop the engine
        log.warning("[telemetry] failed to start (%s); running without telemetry.", type(error).__name__)
        _teardown_quietly()
        return False


def _start(app: Any, config: TelemetryConfig, span_exporter: Any, metric_reader: Any) -> None:
    # Imported here, not at module top, so a disabled telemetry imports nothing from opentelemetry.
    from opentelemetry import propagate
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.metrics.view import View
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import Event, ReadableSpan, TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter, SpanExportResult
    from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

    class SanitizingExporter(SpanExporter):
        """Rebuilds each span with only allow-listed attributes. A span it cannot rebuild is dropped, never exported raw."""

        def __init__(self, inner: SpanExporter) -> None:
            self._inner = inner

        @staticmethod
        def _clean(span: ReadableSpan) -> ReadableSpan:
            attributes = {
                key: value
                for key, value in (span.attributes or {}).items()
                if key in _ALLOWED_SPAN_ATTRIBUTES or key.startswith(_ALLOWED_SPAN_ATTRIBUTE_PREFIXES)
            }
            events = tuple(
                Event(event.name, {k: v for k, v in (event.attributes or {}).items() if k in _ALLOWED_EVENT_ATTRIBUTES}, event.timestamp)
                for event in span.events
            )
            return ReadableSpan(
                name=span.name.split("?", 1)[0],
                context=span.context,
                parent=span.parent,
                resource=span.resource,
                attributes=attributes,
                events=events,
                links=span.links,
                kind=span.kind,
                status=span.status,
                start_time=span.start_time,
                end_time=span.end_time,
                instrumentation_scope=span.instrumentation_scope,
            )

        def export(self, spans):  # type: ignore[override]
            clean = []
            for span in spans:
                try:
                    clean.append(self._clean(span))
                except Exception:  # noqa: BLE001 - drop what cannot be sanitised
                    continue
            if not clean:
                return SpanExportResult.SUCCESS
            return self._inner.export(clean)

        def shutdown(self) -> None:
            self._inner.shutdown()

        def force_flush(self, timeout_millis: int = 30_000) -> bool:
            return self._inner.force_flush(timeout_millis)

    resource = Resource.create({"service.name": config.service_name, "deployment.environment.name": config.environment})
    timeout_s = config.export_timeout_ms / 1000

    exporter = span_exporter or OTLPSpanExporter(endpoint=f"{config.endpoint}/v1/traces", timeout=timeout_s)
    tracer_provider = TracerProvider(
        sampler=ParentBased(root=TraceIdRatioBased(config.sampler_ratio)),
        resource=resource,
        shutdown_on_exit=False,  # shutdown() below is the one, bounded, shutdown path
    )
    tracer_provider.add_span_processor(
        BatchSpanProcessor(
            SanitizingExporter(exporter),
            max_queue_size=config.max_queue_size,
            schedule_delay_millis=config.schedule_delay_ms,
            max_export_batch_size=config.max_export_batch_size,
            export_timeout_millis=config.export_timeout_ms,
        )
    )

    reader = metric_reader or PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{config.endpoint}/v1/metrics", timeout=timeout_s),
        export_interval_millis=config.metric_interval_ms,
        export_timeout_millis=config.export_timeout_ms,
    )
    meter_provider = MeterProvider(
        metric_readers=[reader],
        resource=resource,
        shutdown_on_exit=False,
        views=[View(instrument_name="http.server.*", attribute_keys=set(_ALLOWED_HTTP_METRIC_KEYS))],
    )

    # W3C trace context only: no baggage, so nothing a caller attaches is forwarded.
    propagate.set_global_textmap(TraceContextTextMapPropagator())
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=tracer_provider,
        meter_provider=meter_provider,
        excluded_urls=_EXCLUDED_URLS,
        exclude_spans=["receive", "send"],
    )

    _state.tracer = tracer_provider.get_tracer("emithran.engine")
    _state.histogram = meter_provider.get_meter("emithran.engine").create_histogram(
        "emithran.engine.stage.duration", unit="s", description="Duration of a heavy engine stage by stage name and outcome"
    )
    _state.tracer_provider = tracer_provider
    _state.meter_provider = meter_provider
    _state.app = app
    _state.shutdown_timeout_s = config.shutdown_timeout_s
    _state.active = True
    _install_log_filters()
    if not _state.atexit_registered:
        atexit.register(shutdown)
        _state.atexit_registered = True


# ---------------------------------------------------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------------------------------------------------
def stage(name: str, expected: tuple[type[BaseException], ...] = ()) -> ContextManager[Any]:
    """Span + duration around one heavy stage. `name` must be in STAGES.

    `expected` are exceptions that are a deterministic refusal, not a failure (a rejected upload): they are recorded
    with outcome "rejected" and still propagate. Off, this is a plain nullcontext: no behaviour added.
    """
    if name not in STAGES:
        raise ValueError(f"unknown telemetry stage {name!r}")
    if not _state.active:
        return contextlib.nullcontext()
    return _stage(name, expected)


@contextlib.contextmanager
def _stage(name: str, expected: tuple[type[BaseException], ...]):
    from opentelemetry.trace import Status, StatusCode

    started = time.perf_counter()
    outcome = "ok"
    # The SDK would otherwise record every exception and mark the span ERROR itself, which would paint an expected
    # refusal red and record the exception twice. The classification below is the only one.
    with _state.tracer.start_as_current_span(
        f"engine.{name}",
        attributes={"emithran.stage": name},
        record_exception=False,
        set_status_on_exception=False,
    ) as span:
        try:
            yield span
        except BaseException as error:
            if expected and isinstance(error, expected):
                outcome = "rejected"
            else:
                outcome = "error"
                span.record_exception(error)
                span.set_status(Status(StatusCode.ERROR))
            raise
        finally:
            span.set_attribute("emithran.outcome", outcome)
            try:
                _state.histogram.record(time.perf_counter() - started, {"emithran.stage": name, "emithran.outcome": outcome})
            except Exception:  # noqa: BLE001 - recording a metric must never throw into the request
                pass


# ---------------------------------------------------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------------------------------------------------
def _teardown_quietly() -> None:
    try:
        if _state.app is not None:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.uninstrument_app(_state.app)
    except Exception:  # noqa: BLE001
        pass
    _remove_log_filters()
    _state.active = False
    _state.tracer = _state.histogram = _state.tracer_provider = _state.meter_provider = _state.app = None


def shutdown(timeout_s: Optional[float] = None) -> None:
    """Flush and stop, bounded by the shutdown timeout. Idempotent; never raises; a hung collector cannot hold the process."""
    if not _state.active:
        return
    tracer_provider, meter_provider = _state.tracer_provider, _state.meter_provider
    bound = _state.shutdown_timeout_s if timeout_s is None else timeout_s
    _teardown_quietly()  # stop creating spans first

    def flush_and_stop() -> None:
        for provider in (tracer_provider, meter_provider):
            try:
                provider.shutdown()
            except Exception:  # noqa: BLE001
                pass

    worker = threading.Thread(target=flush_and_stop, name="telemetry-shutdown", daemon=True)
    worker.start()
    worker.join(bound)
