from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager

from fast_clean.container import ContainerManager
from fast_clean.contrib.monitoring import use_monitoring
from fast_clean.contrib.sentry.sentry import use_sentry
from fast_clean.exceptions import use_exceptions_handlers
from fast_clean.loggers import use_logging
from fast_clean.middleware import use_middleware
from fast_clean.utils.toml import use_toml_info
from fastapi import FastAPI

from .settings import SettingsSchema


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Предварительная инициализация приложения.

    - устанавливаем настройки логгирования
    - устанавливаем настройки кеширования
    - устанавливаем настройки стриминга
    - создаём qdrant-коллекцию `pages`, если её ещё нет
    """
    from agents.apps.processing.repositories import VectorStoreRepository
    import logging

    container = ContainerManager.container
    if container is not None:
        try:
            async with container() as req:
                vsr = await req.get(VectorStoreRepository)
                await vsr.ensure_collection()
        except Exception as e:
            # Don't block boot if Qdrant is briefly unavailable.
            # Subsequent /vectorization calls will fail loudly until it's back up.
            logging.getLogger(__name__).warning(
                "could not ensure qdrant collection on boot, proceeding anyway: %s", e,
            )

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
    use_sentry(settings.sentry_dsn)

    use_middleware(app, settings.cors_origins)
    use_monitoring(app, app_name=project_info.name)
    use_exceptions_handlers(app, settings)

    for use_route in use_routes:
        use_route(app)

    return app
