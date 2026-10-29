"""Engine telemetry: continues the caller's trace, records bounded stages, leaks nothing, never hurts a request.

Identical in cad-engine (test/test_telemetry.py) and ecad-engine (tests/): the module under test is the same file.
"""
import io
import json
import logging
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

try:
    import telemetry  # ecad-engine
    MODULE, CWD = "telemetry", Path(telemetry.__file__).resolve().parent
except ImportError:  # cad-engine keeps it in shared/
    from shared import telemetry
    MODULE, CWD = "shared.telemetry", Path(telemetry.__file__).resolve().parent.parent

UPSTREAM_TRACE = "0af7651916cd43dd8448eb211c80319c"
UPSTREAM_SPAN = "b7ad6b7169203331"
TRACEPARENT = f"00-{UPSTREAM_TRACE}-{UPSTREAM_SPAN}-01"
ON = {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:9", "OTEL_TRACES_SAMPLER_ARG": "1"}  # endpoint only switches telemetry on; in-memory exporters replace it


def make_app() -> FastAPI:
    app = FastAPI()

    @app.get("/work/{item}")
    def work(item: str, token: str = "", file: str = "") -> dict:
        logging.getLogger("engine-test").info("working")
        with telemetry.stage("extract_board"):
            pass
        return {"ok": True}

    @app.get("/boom")
    def boom() -> None:
        with telemetry.stage("render_board"):
            raise ValueError("constraint violated for customer ACME, file bracket.step")

    @app.get("/refuse")
    def refuse() -> None:
        with telemetry.stage("extract_board", expected=(KeyError,)):
            raise KeyError("missing outline")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


@pytest.fixture
def started():
    """(app, spans, metrics): telemetry on with in-memory exporters. Torn down after the test."""
    app, spans, metrics = make_app(), InMemorySpanExporter(), InMemoryMetricReader()
    assert telemetry.setup(app, service_name="engine-under-test", environment="test", env=ON, span_exporter=spans, metric_reader=metrics)
    yield app, spans, metrics
    telemetry.shutdown(1)


def finished(spans: InMemorySpanExporter):
    telemetry._state.tracer_provider.force_flush()
    return spans.get_finished_spans()


def metric_points(metrics: InMemoryMetricReader):
    data = metrics.get_metrics_data()
    out = {}
    for resource in (data.resource_metrics if data else []):
        for scope in resource.scope_metrics:
            for metric in scope.metrics:
                out.setdefault(metric.name, []).extend(dict(p.attributes) for p in metric.data.data_points)
    return out


def test_off_by_default_and_imports_nothing_from_opentelemetry():
    code = (
        "import sys, contextlib\n"
        f"import {MODULE} as t\n"
        "from fastapi import FastAPI\n"
        "app = FastAPI()\n"
        "on = t.setup(app, service_name='x', environment='test', env={})\n"
        "with t.stage('extract_board'):\n    pass\n"
        # FastAPI itself imports the OpenTelemetry *API* (an inert, no-op interface) when it is installed. What "off" must
        # guarantee is that nothing that does work is loaded: no SDK, no exporter, no instrumentation.
        "print(json.dumps({'on': on, 'active': t.is_active(), 'otel': [m for m in sys.modules if m.startswith(('opentelemetry.sdk', 'opentelemetry.exporter', 'opentelemetry.instrumentation'))], "
        "'stage_is_null': type(t.stage('extract_board')) is contextlib.nullcontext}))\n"
    ).replace("print(json", "import json; print(json")
    out = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {str(CWD)!r})\n{code}"], capture_output=True, text=True, cwd=CWD, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout.strip().splitlines()[-1])
    assert result == {"on": False, "active": False, "otel": [], "stage_is_null": True}


@pytest.mark.parametrize(
    "env",
    [{"OTEL_EXPORTER_OTLP_ENDPOINT": "not a url"}, {"OTEL_EXPORTER_OTLP_ENDPOINT": "ftp://c:4318"}, {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://"},
     {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318", "OTEL_TRACES_SAMPLER_ARG": "2"},
     {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://c:4318", "OTEL_TRACES_SAMPLER_ARG": "abc"}],
)
def test_bad_configuration_turns_telemetry_off_with_a_warning_and_never_raises(env, caplog):
    with caplog.at_level(logging.WARNING, logger="telemetry"):
        assert telemetry.setup(make_app(), service_name="x", environment="test", env=env) is False
    assert not telemetry.is_active()
    assert any("disabled" in r.getMessage() for r in caplog.records)


def test_config_defaults_and_bounds():
    config, warning = telemetry.read_config({"OTEL_EXPORTER_OTLP_ENDPOINT": "http://o2:5080/api/default/"}, "svc", "production")
    assert warning is None
    assert (config.endpoint, config.service_name, config.sampler_ratio) == ("http://o2:5080/api/default", "svc", 0.1)
    assert config.max_queue_size <= 2048 and config.max_export_batch_size <= config.max_queue_size
    assert config.export_timeout_ms <= 5_000 and config.shutdown_timeout_s <= 3.0
    assert telemetry.read_config({}, "svc", "t") == (None, None)


def test_metrics_endpoint_defaults_to_the_signal_path_and_can_be_split_off():
    base = {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://o2:5080/api/default/"}
    config, _ = telemetry.read_config(base, "svc", "t")
    assert config.metrics_endpoint == "http://o2:5080/api/default/v1/metrics"
    split, warning = telemetry.read_config({**base, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "http://prometheus:9090/api/v1/otlp/v1/metrics"}, "svc", "t")
    assert warning is None and split.metrics_endpoint == "http://prometheus:9090/api/v1/otlp/v1/metrics"
    assert split.endpoint == "http://o2:5080/api/default"
    bad, warning = telemetry.read_config({**base, "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT": "prometheus:9090"}, "svc", "t")
    assert bad is None and "disabled" in warning


def test_continues_the_callers_trace_and_nests_the_stage_in_it(started):
    app, spans, _ = started
    response = TestClient(app).get("/work/item-aaa-111?token=QUERY-SECRET&file=bracket.step", headers={"traceparent": TRACEPARENT})
    assert response.status_code == 200

    done = finished(spans)
    server = next(s for s in done if s.kind.name == "SERVER")
    stage = next(s for s in done if s.name == "engine.extract_board")
    assert format(server.context.trace_id, "032x") == UPSTREAM_TRACE
    assert format(server.parent.span_id, "016x") == UPSTREAM_SPAN
    assert stage.context.trace_id == server.context.trace_id
    assert stage.parent.span_id == server.context.span_id
    assert server.name == "GET /work/{item}"  # the route pattern, never the URL
    assert dict(stage.attributes) == {"emithran.stage": "extract_board", "emithran.outcome": "ok"}
    assert len([s for s in done if s.kind.name == "SERVER"]) == 1  # no receive/send child spans, no duplicates


def test_a_request_without_traceparent_starts_its_own_trace(started):
    app, spans, _ = started
    TestClient(app).get("/work/x")
    server = next(s for s in finished(spans) if s.kind.name == "SERVER")
    assert server.parent is None


def test_no_credential_query_string_filename_or_customer_value_leaves_the_process(started):
    app, spans, metrics = started
    client = TestClient(app, raise_server_exceptions=False)
    client.get("/work/item-aaa-111?token=QUERY-SECRET&file=bracket.step", headers={"traceparent": TRACEPARENT, "authorization": "Bearer SECRET-TOKEN"})
    assert client.get("/boom").status_code == 500

    done = finished(spans)
    exported = json.dumps(
        [{"name": s.name, "attributes": dict(s.attributes), "events": [dict(e.attributes or {}) for e in s.events]} for s in done]
        + [metric_points(metrics)],
        default=str,
    )
    for secret in ("SECRET-TOKEN", "QUERY-SECRET", "bracket.step", "item-aaa-111", "ACME", "constraint violated", "authorization", "?token="):
        assert secret not in exported
    allowed = telemetry._ALLOWED_SPAN_ATTRIBUTES
    for span in done:
        for key in span.attributes:
            assert key in allowed or key.startswith("emithran."), key


def test_an_error_keeps_only_the_exception_class_and_is_counted_as_an_error(started):
    app, spans, metrics = started
    assert TestClient(app, raise_server_exceptions=False).get("/boom").status_code == 500
    stage = next(s for s in finished(spans) if s.name == "engine.render_board")
    assert stage.status.status_code.name == "ERROR"
    assert [dict(e.attributes) for e in stage.events] == [{"exception.type": "ValueError"}]
    assert {"emithran.stage": "render_board", "emithran.outcome": "error"} in metric_points(metrics)["emithran.engine.stage.duration"]


def test_an_expected_refusal_is_a_rejection_not_an_error(started):
    app, spans, metrics = started
    TestClient(app, raise_server_exceptions=False).get("/refuse")
    stage = next(s for s in finished(spans) if s.name == "engine.extract_board")
    assert stage.attributes["emithran.outcome"] == "rejected"
    assert stage.status.status_code.name != "ERROR"
    assert {"emithran.stage": "extract_board", "emithran.outcome": "rejected"} in metric_points(metrics)["emithran.engine.stage.duration"]


def test_metric_labels_are_a_closed_set(started):
    app, _, metrics = started
    client = TestClient(app, raise_server_exceptions=False)
    for path in ("/work/item-aaa-111?x=1", "/work/item-bbb-222", "/boom", "/refuse", "/not-a-route/user-ccc-333"):
        client.get(path)
    points = metric_points(metrics)
    assert "emithran.engine.stage.duration" in points
    for name, labelled in points.items():
        for labels in labelled:
            if name == "emithran.engine.stage.duration":
                assert set(labels) == {"emithran.stage", "emithran.outcome"}
                assert labels["emithran.stage"] in telemetry.STAGES
            else:
                assert set(labels) <= telemetry._ALLOWED_HTTP_METRIC_KEYS, (name, labels)
    assert "item-aaa-111" not in json.dumps(points) and "user-ccc-333" not in json.dumps(points)


def test_health_probes_are_not_traced(started):
    app, spans, _ = started
    TestClient(app).get("/health")
    assert finished(spans) == ()


def test_stage_names_are_a_closed_set_even_when_off():
    with pytest.raises(ValueError):
        telemetry.stage("a-name-from-a-request")


def test_logs_gain_the_trace_id_inside_a_trace_and_are_untouched_outside():
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logging.getLogger().addHandler(handler)  # present before setup, as basicConfig's handler is in the engines
    app, spans = make_app(), InMemorySpanExporter()
    try:
        assert telemetry.setup(app, service_name="x", environment="test", env=ON, span_exporter=spans, metric_reader=InMemoryMetricReader())
        logging.getLogger().setLevel(logging.INFO)
        TestClient(app).get("/work/x", headers={"traceparent": TRACEPARENT})
        logging.getLogger("engine-test").info("outside any trace")
        lines = stream.getvalue().splitlines()
    finally:
        telemetry.shutdown(1)
        logging.getLogger().removeHandler(handler)
    inside = next(line for line in lines if line.startswith("working"))
    assert f"trace_id={UPSTREAM_TRACE}" in inside and "span_id=" in inside
    assert next(line for line in lines if "outside any trace" in line) == "outside any trace"
    # and after shutdown the filter is gone
    assert not [f for f in handler.filters if isinstance(f, telemetry._TraceCorrelationFilter)]


def test_the_trace_id_is_appended_once_however_many_handlers_the_record_passes_through():
    streams = [io.StringIO(), io.StringIO(), io.StringIO()]
    handlers = []
    for stream in streams:
        handler = logging.StreamHandler(stream)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logging.getLogger().addHandler(handler)
        handlers.append(handler)
    app = make_app()
    try:
        assert telemetry.setup(app, service_name="x", environment="test", env=ON, span_exporter=InMemorySpanExporter(), metric_reader=InMemoryMetricReader())
        logging.getLogger().setLevel(logging.INFO)
        TestClient(app).get("/work/x", headers={"traceparent": TRACEPARENT})
    finally:
        telemetry.shutdown(1)
        for handler in handlers:
            logging.getLogger().removeHandler(handler)
    for stream in streams:
        line = next(line for line in stream.getvalue().splitlines() if line.startswith("working"))
        assert line.count("trace_id=") == 1 and line.count("span_id=") == 1, line


def test_exporter_diagnostics_are_one_short_line_per_interval():
    now = [100.0]
    flt = telemetry._RateLimitedExporterLogs(60, clock=lambda: now[0])

    def record(msg="Failed to export span batch code: 503\nTraceback..."):
        r = logging.LogRecord("opentelemetry.sdk", logging.ERROR, __file__, 1, msg, None, (RuntimeError, RuntimeError("x"), None))
        return r, flt.filter(r)

    first, kept = record()
    assert kept and "\n" not in first.getMessage() and first.exc_info is None
    assert not any(record()[1] for _ in range(20))
    now[0] += 61
    again, kept = record()
    assert kept and "+20 similar" in again.getMessage()
    info = logging.LogRecord("opentelemetry.sdk", logging.INFO, __file__, 1, "fine", None, None)
    assert flt.filter(info)  # below WARNING is never held back


# --- fail open: the collector is dead or hanging ---------------------------------------------------------------------
def _hanging_collector():
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(16)
    stop = threading.Event()
    held = []

    def accept():
        server.settimeout(0.2)
        while not stop.is_set():
            try:
                held.append(server.accept()[0])  # accept, never answer
            except OSError:
                pass

    threading.Thread(target=accept, daemon=True).start()
    return server.getsockname()[1], lambda: (stop.set(), [c.close() for c in held], server.close())


@pytest.mark.parametrize("mode", ["dead", "hanging"])
def test_a_dead_or_hanging_collector_costs_requests_nothing_and_shutdown_is_bounded(mode):
    close = lambda: None  # noqa: E731
    port = 1  # reserved: connection refused
    if mode == "hanging":
        port, close = _hanging_collector()
    app = make_app()
    unraisable = []
    threading.excepthook = lambda args: unraisable.append(args)
    try:
        assert telemetry.setup(app, service_name="x", environment="test", env={**ON, "OTEL_EXPORTER_OTLP_ENDPOINT": f"http://127.0.0.1:{port}"})
        client = TestClient(app)
        latencies = []
        for _ in range(60):
            t = time.perf_counter()
            assert client.get("/work/x").status_code == 200
            latencies.append(time.perf_counter() - t)

        tracer = telemetry._state.tracer
        heap_before = _rss_mb()
        start = time.perf_counter()
        for _ in range(50_000):  # far past the 2048-span queue
            tracer.start_span("flood").end()
        flood_s = time.perf_counter() - start
        time.sleep(0.5)  # let exports reach the collector (and hang there)
        stuck = []
        for _ in range(60):
            t = time.perf_counter()
            assert client.get("/work/x").status_code == 200
            stuck.append(time.perf_counter() - t)

        began = time.perf_counter()
        telemetry.shutdown(3)
        shutdown_s = time.perf_counter() - began
    finally:
        telemetry.shutdown(1)
        close()
        threading.excepthook = threading.__excepthook__

    assert max(stuck) < 0.5, f"requests were delayed while exports were failing: {max(stuck):.3f}s"
    assert flood_s < 30
    if heap_before is not None:  # no `resource` module on Windows; this part runs on Linux (CI, Docker)
        assert _rss_mb() - heap_before < 200  # the flood did not pile up in memory
    assert shutdown_s < 3.7, f"shutdown was not bounded: {shutdown_s:.2f}s"
    assert unraisable == [], unraisable


def _rss_mb():
    try:
        import resource  # POSIX only
    except ImportError:
        return None
    # ru_maxrss is bytes on macOS, kilobytes on Linux
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024)


def test_a_failure_to_start_is_reported_and_the_engine_runs_without_telemetry(monkeypatch, caplog):
    import opentelemetry.sdk.trace as sdk_trace

    monkeypatch.setattr(sdk_trace, "TracerProvider", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with caplog.at_level(logging.WARNING, logger="telemetry"):
        assert telemetry.setup(make_app(), service_name="x", environment="test", env=ON, span_exporter=InMemorySpanExporter()) is False
    assert not telemetry.is_active()
    assert any("failed to start" in r.getMessage() for r in caplog.records)


def test_the_real_app_starts_with_telemetry_on_a_dead_collector_and_still_answers():
    """main.py's own wiring (setup call, lifespan shutdown, stage calls), not a stand-in app."""
    import os
    import tempfile

    code = (
        "import importlib, json\n"
        "import main\n"
        f"t = importlib.import_module({MODULE!r})\n"
        "from fastapi.testclient import TestClient\n"
        "with TestClient(main.app) as client:\n"
        "    health = client.get('/health')\n"
        "    ready = client.get('/ready')\n"
        "    active = t.is_active()\n"
        "print(json.dumps({'health': health.status_code, 'ready': ready.status_code, 'active': active, 'after_shutdown': t.is_active()}))\n"
    )
    env = {
        **os.environ,
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:1",  # connection refused
        "OTEL_TRACES_SAMPLER_ARG": "1",
        "ECAD_ENGINE_API_KEY": "test-key",
        "CAD_ENGINE_API_KEY": "test-key",
        "NODE_ENV": "development",
        "TEMP_DIR": tempfile.mkdtemp(),
        "LOG_LEVEL": "WARNING",
    }
    began = time.perf_counter()
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=CWD, env=env, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    result = json.loads(out.stdout.strip().splitlines()[-1])
    assert result == {"health": 200, "ready": 200, "active": True, "after_shutdown": False}
    assert time.perf_counter() - began < 100  # the lifespan shutdown did not wait on the dead collector


def test_the_dockerfile_ships_the_telemetry_module():
    dockerfile = CWD / "Dockerfile"
    if not dockerfile.exists():
        pytest.skip("no Dockerfile next to the service (running from a test image)")
    text = dockerfile.read_text(encoding="utf-8")
    assert "COPY . ." in text or "telemetry.py" in text, "main.py imports telemetry; the image must contain it"
