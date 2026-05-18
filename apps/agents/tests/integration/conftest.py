import os

import pytest
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


@pytest.fixture
async def pg_saver():
    dsn = os.environ['AGENTS_DATABASE_URL']
    async with AsyncPostgresSaver.from_conn_string(dsn) as saver:
        await saver.setup()
        yield saver
