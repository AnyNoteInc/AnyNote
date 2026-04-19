"""Unit tests for bearer-token dependency."""

from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from agents.entrypoints.rest.auth import require_bearer
from agents.exceptions import AuthError


def _protected_app() -> FastAPI:
    app = FastAPI()

    @app.get("/protected")
    def endpoint(_: None = Depends(require_bearer)) -> dict[str, bool]:
        return {"ok": True}

    @app.exception_handler(AuthError)
    def handle_auth_error(_request: Request, exc: AuthError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.http_status,
            content={"error": {"code": exc.code, "message": str(exc)}},
        )

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
