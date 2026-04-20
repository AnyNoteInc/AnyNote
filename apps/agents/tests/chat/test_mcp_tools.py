from __future__ import annotations

import pytest

from agents.apps.chat.repositories.mcp_tools import fetch_mcp_tools
from agents.apps.chat.schemas import McpServer


@pytest.mark.asyncio
async def test_fetch_mcp_tools_returns_empty_for_unreachable() -> None:
    tools = await fetch_mcp_tools([McpServer(name="x", url="http://127.0.0.1:1")])
    assert tools == []
