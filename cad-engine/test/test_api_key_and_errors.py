"""The API key is required in every environment, and an unexpected failure answers with an error id, never exception text."""
import logging

import pytest
from fastapi.testclient import TestClient

import main

STEP = {"file": ("part.step", b"ISO-10303-21;", "application/step")}


@pytest.fixture
def client() -> TestClient:
    return TestClient(main.app)


def test_an_engine_without_a_key_refuses_protected_routes_outside_production(client, monkeypatch):
    monkeypatch.setattr(main.config, "environment", "development")
    monkeypatch.setattr(main, "_CAD_API_KEY", "")
    response = client.post("/nest", json={}, headers={"X-API-Key": ""})
    assert response.status_code == 503
    assert "CAD_ENGINE_API_KEY" in response.json()["detail"]


@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong"}])
def test_a_missing_or_wrong_key_is_refused(client, headers):
    assert client.post("/nest", json={}, headers=headers).status_code == 403


def test_a_failed_analysis_returns_an_error_id_and_logs_the_traceback(client, monkeypatch, caplog):
    def boom(**kwargs):
        raise RuntimeError("secret detail: /srv/customer-acme/bracket.step")

    monkeypatch.setattr(main.StepReader, "read", lambda self, path: object())
    monkeypatch.setattr(main, "analyze_part", boom)
    with caplog.at_level(logging.ERROR):
        with client:  # startup builds app.state; then let any upload through validation
            monkeypatch.setattr(client.app.state.file_validator, "validate_file", lambda *a: (".step", 1))
            response = client.post("/analyze/geometry", files=STEP, headers={"X-API-Key": main._CAD_API_KEY})
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "secret" not in detail and "/srv" not in detail
    error_id = detail.split("(error ")[1].rstrip(").")
    assert len(error_id) == 32
    logged = [r for r in caplog.records if error_id in r.getMessage()]
    assert logged and logged[0].exc_info is not None and "secret detail" in str(logged[0].exc_info[1])
