from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError
from pytest_httpx import HTTPXMock

from agents.apps.chat.repositories.mcp_tools import fetch_mcp_tools
from agents.apps.chat.schemas import McpServer


def _model_schema(schema: object) -> type[BaseModel]:
    assert isinstance(schema, type)
    assert issubclass(schema, BaseModel)
    return schema


@pytest.mark.asyncio
async def test_fetch_mcp_tools_returns_empty_for_unreachable() -> None:
    tools = await fetch_mcp_tools([McpServer(name="x", url="http://127.0.0.1:1")])
    assert tools == []


@pytest.mark.asyncio
async def test_fetch_mcp_tools_wraps_listed_tool_and_calls_it(httpx_mock: HTTPXMock) -> None:
    server = McpServer(name="search", url="http://example.invalid/mcp")
    httpx_mock.add_response(
        url=server.url,
        method="POST",
        json={
            "result": {
                "tools": [
                    {
                        "name": "search_docs",
                        "description": "Search docs",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "q": {"type": "string", "description": "Query text"},
                            },
                            "required": ["q"],
                        },
                    }
                ]
            }
        },
    )
    httpx_mock.add_response(
        url=server.url,
        method="POST",
        json={
            "result": {
                "content": [{"type": "text", "text": "found docs"}],
            }
        },
    )

    tools = await fetch_mcp_tools([server])

    assert len(tools) == 1
    tool = tools[0]
    assert await tool.ainvoke({"q": "hello"}) == "found docs"


@pytest.mark.asyncio
async def test_required_tool_args_reject_missing_and_none(httpx_mock: HTTPXMock) -> None:
    server = McpServer(name="search", url="http://example.invalid/mcp")
    httpx_mock.add_response(
        url=server.url,
        method="POST",
        json={
            "result": {
                "tools": [
                    {
                        "name": "search_docs",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "q": {"type": "string"},
                            },
                            "required": ["q"],
                        },
                    }
                ]
            }
        },
    )

    tools = await fetch_mcp_tools([server])
    args_schema = _model_schema(tools[0].args_schema)

    with pytest.raises(ValidationError):
        args_schema.model_validate({})

    with pytest.raises(ValidationError):
        args_schema.model_validate({"q": None})
