"""Contract test — processing provider resolves service."""

from __future__ import annotations

import pytest
from dishka import make_async_container

from agents.apps.processing.depends import ProcessingProvider
from agents.apps.processing.services.normalizer import NormalizerService
from agents.settings import Settings


@pytest.mark.asyncio
async def test_provider_resolves_normalizer() -> None:
    container = make_async_container(
        ProcessingProvider(),
        context={Settings: Settings()},
    )
    try:
        async with container() as request_container:
            normalizer = await request_container.get(NormalizerService)
            assert isinstance(normalizer, NormalizerService)
    finally:
        await container.close()
