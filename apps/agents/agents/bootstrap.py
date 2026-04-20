"""FastAPI bootstrap for the agents service."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager
from pathlib import Path

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka

try:
    from fast_clean.contrib.monitoring import use_monitoring  # type: ignore[attr-defined]
except ImportError:
    from fast_clean.contrib.monitoring.middleware import (
        use_middleware as _use_monitoring_middleware,
    )
    from fast_clean.contrib.monitoring.router import router as _monitoring_router

    def use_monitoring(app: FastAPI, app_name: str) -> None:
        _ = app_name
        _use_monitoring_middleware(app)
        app.include_router(_monitoring_router)

try:
    from fast_clean.contrib.sentry.sentry import use_sentry  # type: ignore[import-not-found]
except ImportError:
    from fast_clean.contrib.logging.sentry import use_sentry

from fast_clean.exceptions import use_exceptions_handlers
from fast_clean.loggers import use_logging
from fast_clean.middleware import use_middleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agents.apps.chat.depends import (
    ChatAppProvider,
    ChatAppSingletonsProvider,
    ChatRequestProvider,
)
from agents.apps.chat.errors import AgentException as ChatAgentException
from agents.exceptions import AgentException as LegacyAgentException
from agents.settings import Settings

RouteApplier = Callable[[FastAPI], None]
_MONITORING_REGISTERED = False


def _agent_exception_handler(
    _request: Request,
    exc: ChatAgentException | LegacyAgentException,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def _use_fast_clean_hooks(app: FastAPI, settings: Settings) -> None:
    global _MONITORING_REGISTERED

    project_dir = Path(__file__).resolve().parents[1]
    if any((project_dir / filename).exists() for filename in (".logging.dev.yaml", ".logging.yaml")):
        use_logging(project_dir)
    use_sentry(settings.sentry_dsn)
    use_middleware(app, "agents", settings.cors_origins)
    if not _MONITORING_REGISTERED:
        use_monitoring(app, app_name="agents")
        _MONITORING_REGISTERED = True
    use_exceptions_handlers(app, settings)


def create_app(use_routes: Iterable[RouteApplier]) -> FastAPI:
    settings = Settings()
    container = make_async_container(
        ChatAppProvider(),
        ChatAppSingletonsProvider(),
        ChatRequestProvider(),
        context={Settings: settings},
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await container.close()

    app = FastAPI(
        title="AnyNote Agents",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )
    _use_fast_clean_hooks(app, settings)
    app.add_exception_handler(ChatAgentException, _agent_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(LegacyAgentException, _agent_exception_handler)  # type: ignore[arg-type]
    setup_dishka(container=container, app=app)

    for apply_route in use_routes:
        apply_route(app)

    return app
