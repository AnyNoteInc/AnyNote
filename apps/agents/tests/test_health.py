"""Unit tests for GET /health."""

from __future__ import annotations

from fastapi.testclient import TestClient

from agents.main import create_app


def test_health_ok() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"
    assert "database" in body
