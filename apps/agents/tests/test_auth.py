"""Unit tests for bearer-token dependency."""

from __future__ import annotations

from dishka import Provider, Scope, from_context, make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from agents.entrypoints.rest.auth import require_bearer
from agents.exceptions import AuthError
from agents.settings import Settings


class _SettingsProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)


def _protected_app() -> FastAPI:
    app = FastAPI()
    settings = Settings()
    container = make_async_container(_SettingsProvider(), context={Settings: settings})

    @app.get("/protected")
    def endpoint(_: None = Depends(require_bearer)) -> dict[str, bool]:
        return {"ok": True}

    @app.exception_handler(AuthError)
    def handle_auth_error(_request: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": {"code": exc.code, "message": str(exc)}},
        )

    setup_dishka(container=container, app=app)
    return app


def test_missing_token_rejected() -> None:
    client = TestClient(_protected_app())
    r = client.get("/protected")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_wrong_token_rejected() -> None:
    client = TestClient(_protected_app())
    r = client.get("/protected", headers={"Authorization": "Bearer bogus"})
    assert r.status_code == 401


def test_correct_token_allowed() -> None:
    client = TestClient(_protected_app())
    r = client.get("/protected", headers={"Authorization": "Bearer test-token-123"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
