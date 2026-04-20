"""Smoke test that the Dishka container can be constructed with placeholder env."""

from __future__ import annotations

import pytest

from indexer.di.providers import AppProvider, AppSingletonsProvider
from indexer.settings import Settings


@pytest.mark.asyncio
async def test_container_resolves_settings() -> None:
    from dishka import make_async_container

    settings = Settings()
    container = make_async_container(
        AppProvider(), AppSingletonsProvider(), context={Settings: settings}
    )
    try:
        resolved = await container.get(Settings)
        assert resolved.indexer_qdrant_collection == "anynote-pages-test"
    finally:
        await container.close()
