import logging
from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager

import sentry_sdk
from fast_clean.container import ContainerManager
from fast_clean.contrib.monitoring import use_monitoring
from fast_clean.exceptions import use_exceptions_handlers
from fast_clean.loggers import use_logging
from fast_clean.middleware import use_middleware
from fast_clean.utils.toml import use_toml_info
from fastapi import FastAPI
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

from .settings import SettingsSchema


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Предварительная инициализация приложения.

    - устанавливаем настройки логгирования
    - устанавливаем настройки кеширования
    - устанавливаем настройки стриминга
    - qdrant-коллекции создаются лениво для пары provider/model при векторизации
    """
    yield

    await ContainerManager.close()


def create_app(use_routes: Iterable[Callable[[FastAPI], None]]) -> FastAPI:
    settings = SettingsSchema()
    project_info = use_toml_info(settings.base_dir)
    app = FastAPI(
        title=project_info.name,
        debug=settings.debug,
        description=project_info.description or '',
        lifespan=lifespan,
        docs_url='/docs',
        openapi_url='/docs.json',
        version=project_info.version,
    )

    ContainerManager.init_for_fastapi(app)

    use_logging(settings)
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
        integrations=[
            LoggingIntegration(level=logging.DEBUG, event_level=logging.ERROR),
            FastApiIntegration(),
        ],
    )
    sentry_sdk.set_tag('service', 'agents')

    use_middleware(app, settings.cors_origins)
    use_monitoring(app, app_name=project_info.name)
    use_exceptions_handlers(app, settings)

    for use_route in use_routes:
        use_route(app)

    return app
