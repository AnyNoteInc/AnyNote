from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
import respx
from agents.apps.agent.repositories.mcp_client import McpClient, McpToolDescriptor
from agents.apps.agent.schemas import McpServerSchema
from httpx import Response


class _Chunk:
    def __init__(self, type_: str, text: str) -> None:
        self.type = type_
        self.text = text


def _text_chunk(text: str) -> _Chunk:
    return _Chunk('text', text)


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
async def test_streamable_http_list_tools_delegates_to_mcp_sdk(monkeypatch) -> None:
    # Streamable HTTP (Context7) routes through _open_streamable_session, the
    # streamablehttp_client wrapper, NOT the stateless JSON-RPC POST path.
    fake_tool = AsyncMock()
    fake_tool.name = 'resolve-library-id'
    fake_tool.description = 'd'
    fake_tool.inputSchema = {}

    fake_session = AsyncMock()
    fake_session.list_tools = AsyncMock(return_value=AsyncMock(tools=[fake_tool]))

    @asynccontextmanager
    async def fake_session_factory(*args, **kwargs):
        yield fake_session

    from agents.apps.agent.repositories import mcp_client as mc
    monkeypatch.setattr(mc, '_open_streamable_session', fake_session_factory)

    client = McpClient()
    server = make_server('https://mcp.context7.com/mcp', transport='STREAMABLE_HTTP')
    tools = await client.list_tools(server)
    assert tools and tools[0].name == 'resolve-library-id'


@pytest.mark.asyncio
async def test_streamable_http_call_tool_delegates_to_mcp_sdk(monkeypatch) -> None:
    fake_session = AsyncMock()
    fake_session.call_tool = AsyncMock(
        return_value=AsyncMock(content=[_text_chunk('docs body')])
    )

    @asynccontextmanager
    async def fake_session_factory(*args, **kwargs):
        yield fake_session

    from agents.apps.agent.repositories import mcp_client as mc
    monkeypatch.setattr(mc, '_open_streamable_session', fake_session_factory)

    client = McpClient()
    server = make_server('https://mcp.context7.com/mcp', transport='STREAMABLE_HTTP')
    result = await client.call_tool(server, 'get-library-docs', {'context7CompatibleLibraryID': '/vercel/next.js'})
    assert result == 'docs body'


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


def test_array_params_preserve_item_type_for_llm_schema() -> None:
    """Array tool params must keep `items.type` through the pydantic round-trip.

    GigaChat rejects a function whose array `items` has no `type`
    (HTTP 422 'Type properties.X.items.type is wrong'). A bare `list`
    field serializes to `items: {}`, dropping the type. Regression guard
    for the createTask.assignees / createReminder.offsets 422.
    """
    client = McpClient()
    desc = McpToolDescriptor(
        name='createReminder',
        description='r',
        input_schema={
            'type': 'object',
            'properties': {
                'offsets': {'type': 'array', 'items': {'type': 'integer'}},
                'tags': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}},
            },
            'required': [],
        },
    )
    server = make_server('https://mcp.test/', name='anynote')
    tools = client.build_langchain_tools({'anynote': [desc]}, [server])
    schema = tools[0].args_schema.model_json_schema()

    def array_items(field: str) -> dict:
        spec = schema['properties'][field]
        if 'anyOf' in spec:  # optional fields become anyOf[array, null]
            spec = next(b for b in spec['anyOf'] if b.get('type') == 'array')
        return spec.get('items') or {}

    assert array_items('offsets').get('type') == 'integer'
    assert array_items('tags').get('type') == 'string'
