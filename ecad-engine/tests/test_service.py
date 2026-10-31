"""The HTTP service: authentication, limits, error codes and the response shape. Needs no board files.

Board extraction and drawing are verified by uploading a real board set through the platform; nothing is bundled here.
"""
from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

os.environ["ECAD_ENGINE_API_KEY"] = "test-key-for-the-service-tests"

import main  # noqa: E402  (the key must be set before the app is imported)

KEY = {"X-API-Key": "test-key-for-the-service-tests"}
NAME = "layer.gtl"


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(main.app)


def post(client, path="/extract/board", headers=KEY, manifest_text=None, names=(NAME,), described=None):
    manifest = manifest_text if manifest_text is not None else json.dumps({"files": [{"name": n, "role": None} for n in (described if described is not None else names)]})
    return client.post(path, headers=headers, data={"manifest": manifest}, files=[("files", (n, b"x", "application/octet-stream")) for n in names])


def test_health_needs_no_key(client):
    assert client.get("/health").json()["status"] == "ok"


@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong"}])
@pytest.mark.parametrize("path", ["/extract/board", "/render/board"])
def test_requests_without_the_key_are_refused(client, headers, path):
    assert post(client, path, headers=headers).status_code == 401


def test_a_service_with_no_key_configured_refuses_everything(client, monkeypatch):
    monkeypatch.delenv("ECAD_ENGINE_API_KEY")
    assert post(client).status_code == 503


def test_a_bad_manifest_is_422(client):
    assert post(client, manifest_text="not json").json()["code"] == "invalid_manifest"


def test_a_file_missing_from_the_manifest_is_refused(client):
    response = post(client, described=[])
    assert response.status_code == 422 and response.json()["code"] == "invalid_manifest"


def test_too_many_files_is_413(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_FILES", 1)
    assert post(client, names=("a.gtl", "b.gtl")).status_code == 413


def test_an_oversized_file_is_413(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_FILE_BYTES", 0)
    assert post(client).status_code == 413


def test_a_set_without_an_outline_cannot_be_drawn(client):
    response = post(client, "/render/board")
    assert response.status_code == 422 and response.json()["code"] == "render_failed"


def test_root_describes_the_service(client):
    body = client.get("/").json()
    assert body["service"] == "mithran ecad-engine" and body["status"] == "running"


def test_health_reports_capabilities_limits_and_library_versions(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["contractVersion"] == "1.3"
    assert body["extractor"] == {"id": "ecad-engine-board", "version": "0.3.0"}
    assert body["libraries"]["gerbonara"] not in ("", "unknown") and body["libraries"]["openpyxl"] != "unknown"
    assert body["limits"]["maxFiles"] >= 16 and body["limits"]["maxFileSizeMb"] >= 1
    assert "board_outline" in body["renderedRoles"] and len(body["capabilities"]) >= 5
    assert "key" not in json.dumps(body).lower().replace("keyword", "")


def test_ready_is_true_only_when_the_key_is_configured(client, monkeypatch):
    assert client.get("/ready").json() == {"ready": True, "reason": None}
    monkeypatch.delenv("ECAD_ENGINE_API_KEY")
    response = client.get("/ready")
    assert response.status_code == 503 and response.json()["ready"] is False


def test_every_response_carries_a_request_id_and_echoes_the_callers(client):
    assert len(client.get("/health").headers["X-Request-ID"]) >= 16
    assert client.get("/health", headers={"X-Request-ID": "trace-123"}).headers["X-Request-ID"] == "trace-123"


def test_cors_allows_the_configured_origin_only(client):
    ok = client.options("/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    other = client.options("/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in other.headers


def test_an_unexpected_failure_is_a_500_with_a_code_and_no_leak(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail with customer content")

    monkeypatch.setattr(main, "extract_board", boom)
    quiet = TestClient(main.app, raise_server_exceptions=False)
    response = post(quiet)
    assert response.status_code == 500
    body = response.json()
    assert body["code"] == "internal_error" and body["requestId"] and "secret" not in json.dumps(body)


@pytest.mark.parametrize(
    ("raised", "code"),
    [(main.ExtractionError("secret: /srv/acme/board.gtl line 7"), "extraction_failed"), (ValueError("secret: GBK bytes 0xff"), "unreadable_file")],
)
def test_a_refused_set_answers_with_an_error_id_and_logs_the_reason(client, monkeypatch, caplog, raised, code):
    def refuse(*args, **kwargs):
        raise raised

    monkeypatch.setattr(main, "extract_board", refuse)
    with caplog.at_level("WARNING", logger="ecad-engine"):
        response = post(client)
    body = response.json()
    assert response.status_code == 422 and body["code"] == code
    assert "secret" not in json.dumps(body) and len(body["errorId"]) == 32 and body["errorId"] in body["message"]
    logged = [r for r in caplog.records if body["errorId"] in r.getMessage()]
    assert logged and logged[0].exc_info[1] is raised


def test_a_drawing_failure_does_not_echo_the_reason(client):
    body = post(client, "/render/board").json()
    assert body["code"] == "render_failed" and "outline" not in body["message"] and body["errorId"] in body["message"]


def test_an_unreadable_pick_place_file_is_reported_by_id_only(monkeypatch, caplog):
    from extraction import render

    monkeypatch.setattr(render, "read_tabular", lambda f: ("placement", object()))

    def refuse(table, layers):
        raise render.PlacementError("Pick Place layer 'secret-customer-layer' is not in the placement layer table")

    monkeypatch.setattr(render, "read_components", refuse)
    with caplog.at_level("WARNING", logger="extraction.render"):
        components, reason = render._scene_components([render.InputFile("pp.csv", b"x")], {})
    assert components == [] and "secret" not in reason
    assert any(r.exc_info and "secret" in str(r.exc_info[1]) for r in caplog.records)
