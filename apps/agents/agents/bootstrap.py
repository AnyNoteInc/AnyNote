"""FastAPI bootstrap for the agents service."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager, redirect_stdout
from io import StringIO
from pathlib import Path
from typing import cast

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka

try:
    from fast_clean.contrib.monitoring import use_monitoring  # type: ignore[attr-defined]
except ImportError:
    from aioprometheus.asgi.middleware import MetricsMiddleware as _MetricsMiddleware
    from aioprometheus.collectors import Counter
    from fast_clean.contrib.monitoring.router import router as _monitoring_router

    class _SafeMetricsMiddleware(_MetricsMiddleware):
        def create_metrics(self) -> None:
            try:
                super().create_metrics()  # type: ignore[no-untyped-call]
            except ValueError as exc:
                if "already registered" not in str(exc):
                    raise
                collectors = self.registry.collectors
                self.requests_counter = cast(Counter, collectors["requests_total_counter"])
                self.responses_counter = cast(Counter, collectors["responses_total_counter"])
                self.exceptions_counter = cast(Counter, collectors["exceptions_total_counter"])
                self.status_codes_counter = cast(Counter, collectors["status_codes_counter"])
                self.metrics_created = True

    def use_monitoring(app: FastAPI, app_name: str) -> None:
        _ = app_name
        app.add_middleware(_SafeMetricsMiddleware)
        if all(getattr(route, "path", None) != "/metrics" for route in app.routes):
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


def _agent_exception_handler(
    _request: Request,
    exc: ChatAgentException | LegacyAgentException,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def _use_fast_clean_hooks(app: FastAPI, settings: Settings) -> None:
    project_dir = Path(__file__).resolve().parents[1]
    try:
        with redirect_stdout(StringIO()):
            use_logging(project_dir)
    except SystemExit:
        # fast-clean exits when config files are absent; keep app bootstrapping in tests/dev.
        pass
    use_sentry(settings.sentry_dsn)
    use_middleware(app, "agents", settings.cors_origins)
    use_monitoring(app, app_name="agents")
    use_exceptions_handlers(app, settings)  # type: ignore[arg-type]


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
