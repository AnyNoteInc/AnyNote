"""Tests for the /health endpoint with stubbed dependencies."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

from dishka import Provider, Scope, make_async_container, provide
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from indexer.entrypoints.rest.health import router as health_router
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter


class _StubProvider(Provider):
    scope = Scope.APP

    def __init__(self, *, outbox: OutboxRepo, qdrant: QdrantWriter) -> None:
        super().__init__()
        self._outbox = outbox
        self._qdrant = qdrant

    @provide(scope=Scope.APP)
    def outbox(self) -> OutboxRepo:
        return self._outbox

    @provide(scope=Scope.APP)
    def qdrant(self) -> QdrantWriter:
        return self._qdrant


def _build_app(*, outbox: OutboxRepo, qdrant: QdrantWriter) -> FastAPI:
    app = FastAPI()
    app.include_router(health_router)
    container = make_async_container(_StubProvider(outbox=outbox, qdrant=qdrant))
    setup_dishka(container=container, app=app)
    return app


def _stub_outbox(lag: int) -> Any:
    outbox = MagicMock(spec=OutboxRepo)
    outbox.queue_lag = AsyncMock(return_value=lag)
    return outbox


def _stub_qdrant(reachable: bool) -> Any:
    qdrant = MagicMock(spec=QdrantWriter)
    qdrant.client = MagicMock()
    if reachable:
        qdrant.client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))
    else:
        qdrant.client.get_collections = AsyncMock(side_effect=RuntimeError("nope"))
    return qdrant


def test_health_ok() -> None:
    app = _build_app(outbox=_stub_outbox(3), qdrant=_stub_qdrant(reachable=True))
    with TestClient(app) as client:
        r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["queue_lag"] == 3
    assert body["qdrant"] == "reachable"


def test_health_qdrant_unreachable() -> None:
    app = _build_app(outbox=_stub_outbox(0), qdrant=_stub_qdrant(reachable=False))
    with TestClient(app) as client:
        r = client.get("/health")
    body = r.json()
    assert body["qdrant"] == "unreachable"
    assert body["status"] == "ok"
