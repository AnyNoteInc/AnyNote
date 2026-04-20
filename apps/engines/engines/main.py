"""Engines FastAPI app factory — mounts FastMCP under /mcp."""

from __future__ import annotations

import logging
from typing import Any

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Header, HTTPException

from engines.di.providers import AppProvider, AppSingletonsProvider
from engines.services.embeddings import OllamaEmbeddings
from engines.services.page_repo import PageRepo
from engines.services.search import SearchService
from engines.settings import Settings
from engines.tools.registry import build_mcp

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = Settings()
    logging.basicConfig(level=settings.engines_log_level)
    container = make_async_container(
        AppProvider(),
        AppSingletonsProvider(),
        context={Settings: settings},
    )

    app = FastAPI(title="AnyNote Engines", version="0.1.0")

    async def require_token(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {settings.engines_mcp_token}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {"status": "ok", "service": "engines", "version": "0.1.0"}

    # Build MCP using container-resolved singletons. Resolve eagerly at startup
    # so the MCP graph is bound once.
    @app.on_event("startup")
    async def _mount_mcp() -> None:
        page_repo = await container.get(PageRepo)
        search = await container.get(SearchService)
        embeddings = await container.get(OllamaEmbeddings)
        mcp = build_mcp(page_repo=page_repo, search=search, embeddings=embeddings)
        sub = mcp.http_app(path="/")
        app.mount("/mcp", sub, name="mcp")
        log.info("MCP server mounted at /mcp")

    # Apply auth middleware to /mcp paths
    @app.middleware("http")
    async def auth_middleware(request: Any, call_next: Any) -> Any:
        if request.url.path.startswith("/mcp"):
            await require_token(request.headers.get("authorization"))
        return await call_next(request)

    setup_dishka(container=container, app=app)
    return app
