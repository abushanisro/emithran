"""Heavy OCC requests must not block the event loop, and a burst queues behind a bounded number of slots."""
import os
import threading
import time

os.environ.setdefault("NODE_ENV", "development")
os.environ["MAX_CONCURRENT_ANALYSES"] = "1"
os.environ["QUEUE_WAIT_SECONDS"] = "1"
os.environ["LOG_LEVEL"] = "WARNING"

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

STEP = {"file": ("part.step", b"ISO-10303-21;", "application/step")}
AUTH = {"X-API-Key": main._CAD_API_KEY}


def test_health_answers_while_a_slow_analysis_is_running(monkeypatch):
    def slow_read(self, path):
        time.sleep(2)
        raise RuntimeError("stop after the slow part")

    monkeypatch.setattr(main.StepReader, "read", slow_read)
    with TestClient(main.app) as client:
        monkeypatch.setattr(client.app.state.file_validator, "validate_file", lambda *a: (".step", 1))
        answered = {}
        worker = threading.Thread(target=lambda: answered.update(r=client.post("/measure/geometry", files=STEP, headers=AUTH)))
        worker.start()
        time.sleep(0.3)
        started = time.monotonic()
        assert client.get("/health").status_code == 200
        assert time.monotonic() - started < 1.0  # was blocked for the whole analysis before
        worker.join()
        assert answered["r"].status_code == 422  # it reached the slow reader, not an auth or validation rejection


def test_a_request_gets_a_retryable_429_when_every_slot_is_busy():
    with TestClient(main.app) as client:
        assert main.analysis_gate._slots.acquire(timeout=1)
        try:
            r = client.post("/measure/geometry", files=STEP, headers=AUTH)
        finally:
            main.analysis_gate._slots.release()
    assert r.status_code == 429
    assert r.headers["retry-after"] == "15"


def test_health_reports_the_real_limits_and_current_load():
    with TestClient(main.app) as client:
        body = client.get("/health").json()
    assert body["limits"]["max_concurrent_analyses"] == 1
    assert body["load"] == {"analyses_running": 0, "oldest_analysis_seconds": 0.0}
