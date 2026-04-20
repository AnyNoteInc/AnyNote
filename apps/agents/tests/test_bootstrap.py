from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from agents.apps.chat.errors import InvalidPayloadError
from agents.bootstrap import create_app
from agents.entrypoints.rest.auth import require_bearer
from agents.exceptions import AuthError
from agents.router import apply_routes


def test_create_app_registers_routes() -> None:
    app = create_app([apply_routes])
    paths = {route.path for route in app.routes if isinstance(route, APIRoute)}
    assert "/api/v1/generate" in paths


def test_create_app_formats_legacy_agent_exception() -> None:
    app = create_app([])
    router = APIRouter()

    @router.get("/boom")
    async def boom() -> None:
        raise AuthError("Invalid bearer token")

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/boom")

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "UNAUTHORIZED", "message": "Invalid bearer token"},
    }


def test_create_app_formats_legacy_exception_from_auth_dependency() -> None:
    app = create_app([])
    router = APIRouter()

    @router.get("/secure", dependencies=[Depends(require_bearer)])
    async def secure() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/secure")

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "UNAUTHORIZED",
            "message": "Missing or malformed Authorization header",
        }
    }


def test_create_app_formats_chat_agent_exception() -> None:
    app = create_app([])
    router = APIRouter()

    @router.get("/chat-error")
    async def chat_error() -> None:
        raise InvalidPayloadError("bad payload")

    app.include_router(router)

    with TestClient(app) as client:
        response = client.get("/chat-error")

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "INVALID_PAYLOAD", "message": "bad payload"},
    }


def test_create_app_calls_use_logging_hook(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False

    def _use_logging_stub(_base_dir: object) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr("agents.bootstrap.use_logging", _use_logging_stub)
    monkeypatch.setattr("agents.bootstrap.use_sentry", lambda _dsn: None)
    monkeypatch.setattr("agents.bootstrap.use_middleware", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("agents.bootstrap.use_monitoring", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "agents.bootstrap.use_exceptions_handlers",
        lambda *_args, **_kwargs: None,
    )

    create_app([])

    assert called is True


def test_create_app_registers_monitoring_per_instance() -> None:
    first_app = create_app([])
    second_app = create_app([])

    first_paths = {route.path for route in first_app.routes if isinstance(route, APIRoute)}
    second_paths = {route.path for route in second_app.routes if isinstance(route, APIRoute)}

    assert "/metrics" in first_paths
    assert "/metrics" in second_paths
