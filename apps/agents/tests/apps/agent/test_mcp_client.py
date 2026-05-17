from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
import respx
from agents.apps.agent.repositories.mcp_client import McpClient, McpToolDescriptor
from agents.apps.agent.schemas import McpServerSchema
from httpx import Response


def make_server(url: str, name: str = 'srv', transport: str = 'HTTP_JSONRPC',
                allowlist: list[str] | None = None) -> McpServerSchema:
    return McpServerSchema(
        name=name,
        description='',
        url=url,
        transport=transport,
        tools=allowlist or [],
        headers={},
        retries=1,
        verify=True,
    )


@pytest.mark.asyncio
@respx.mock
async def test_list_tools_http_jsonrpc() -> None:
    respx.post('https://mcp.test/').mock(
        return_value=Response(200, json={
            'jsonrpc': '2.0', 'id': 1,
            'result': {
                'tools': [
                    {'name': 'echo', 'description': 'echo back', 'inputSchema': {}},
                ],
            },
        })
    )
    client = McpClient()
    server = make_server('https://mcp.test/')
    tools = await client.list_tools(server)
    assert tools == [McpToolDescriptor(name='echo', description='echo back', input_schema={})]


@pytest.mark.asyncio
@respx.mock
async def test_call_tool_returns_text_content() -> None:
    respx.post('https://mcp.test/').mock(
        return_value=Response(200, json={
            'jsonrpc': '2.0', 'id': 2,
            'result': {'content': [{'type': 'text', 'text': 'hi'}]},
        })
    )
    client = McpClient()
    server = make_server('https://mcp.test/')
    result = await client.call_tool(server, 'echo', {'x': 1})
    assert result == 'hi'


@pytest.mark.asyncio
@respx.mock
async def test_allowlist_filters_tools() -> None:
    respx.post('https://mcp.test/').mock(
        return_value=Response(200, json={
            'jsonrpc': '2.0', 'id': 1,
            'result': {'tools': [
                {'name': 'allowed', 'description': '', 'inputSchema': {}},
                {'name': 'blocked', 'description': '', 'inputSchema': {}},
            ]},
        })
    )
    client = McpClient()
    server = make_server('https://mcp.test/', allowlist=['allowed'])
    tools = await client.list_tools(server)
    assert [t.name for t in tools] == ['allowed']


@pytest.mark.asyncio
async def test_sse_list_tools_delegates_to_mcp_sdk(monkeypatch) -> None:
    # Mock the SDK session factory used in mcp_client._sse_session
    fake_tool = AsyncMock()
    fake_tool.name = 'echo'
    fake_tool.description = 'd'
    fake_tool.inputSchema = {}

    fake_session = AsyncMock()
    fake_session.list_tools = AsyncMock(return_value=AsyncMock(tools=[fake_tool]))

    @asynccontextmanager
    async def fake_session_factory(*args, **kwargs):
        yield fake_session

    from agents.apps.agent.repositories import mcp_client as mc
    monkeypatch.setattr(mc, '_open_sse_session', fake_session_factory)

    client = McpClient()
    server = make_server('https://mcp.test/sse', transport='SSE')
    tools = await client.list_tools(server)
    assert tools and tools[0].name == 'echo'


@pytest.mark.asyncio
@respx.mock
async def test_discover_all_isolates_failure_per_server() -> None:
    respx.post('https://ok.test/').mock(
        return_value=Response(200, json={
            'jsonrpc': '2.0', 'id': 1,
            'result': {'tools': [{'name': 'echo', 'description': '', 'inputSchema': {}}]},
        })
    )
    respx.post('https://broken.test/').mock(return_value=Response(503))

    client = McpClient()
    servers = [
        make_server('https://ok.test/', name='ok'),
        make_server('https://broken.test/', name='broken'),
    ]
    results = await client.discover_all(servers)
    assert set(results.keys()) == {'ok'}
    assert results['ok'][0].name == 'echo'


@pytest.mark.asyncio
@respx.mock
async def test_build_langchain_tools_namespaces_by_server() -> None:
    respx.post('https://srv.test/').mock(
        return_value=Response(200, json={
            'jsonrpc': '2.0', 'id': 1,
            'result': {'tools': [
                {'name': 'echo', 'description': 'd',
                 'inputSchema': {'type': 'object',
                                 'properties': {'text': {'type': 'string'}},
                                 'required': ['text']}},
            ]},
        })
    )
    client = McpClient()
    server = make_server('https://srv.test/', name='Notion')
    discovered = await client.discover_all([server])
    tools = client.build_langchain_tools(discovered, [server])
    assert [t.name for t in tools] == ['Notion__echo']
