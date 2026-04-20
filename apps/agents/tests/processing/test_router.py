"""HTTP contract test for /processing/normalize."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agents.main import create_app


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_normalize_endpoint_returns_normalized_text(client: TestClient) -> None:
    response = client.post(
        "/processing/normalize",
        json={"text": "Быстрые собаки бегают.", "language": "ru"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "ru"
    assert isinstance(body["normalized"], str)
    assert "собака" in body["normalized"].split()


def test_normalize_endpoint_auto_detects(client: TestClient) -> None:
    response = client.post(
        "/processing/normalize",
        json={"text": "Quick brown fox jumps over lazy dog", "language": "auto"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "en"
    assert "fox" in body["normalized"].split()


def test_normalize_endpoint_rejects_invalid_body(client: TestClient) -> None:
    response = client.post("/processing/normalize", json={})
    assert response.status_code == 422
