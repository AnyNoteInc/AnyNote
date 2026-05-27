import pytest
from agents.apps.agent.repositories.mcp_client import McpClient, _strip_auto_fields
from agents.apps.agent.schemas import McpServerSchema


def make_server(**kwargs) -> McpServerSchema:
    defaults = dict(
        name='engines',
        url='http://engines:8082/mcp',
        transport='HTTP_JSONRPC',
        headers={'x-agents-user': 'u1'},
        tools=[],
        retries=1,
        verify=True,
    )
    defaults.update(kwargs)
    return McpServerSchema(**defaults)


@pytest.mark.asyncio
async def test_call_tool_injects_workspace_id(monkeypatch) -> None:
    captured: dict = {}

    async def fake_post(self, server, payload):
        captured['payload'] = payload
        return {'content': [{'type': 'text', 'text': 'ok'}]}

    monkeypatch.setattr(McpClient, '_post', fake_post)

    server = make_server(workspace_id='w1')
    client = McpClient()
    await client.call_tool(server, 'search_pages', {'query': 'q'})

    assert captured['payload']['params']['arguments'] == {
        'query': 'q',
        'workspaceId': 'w1',
    }


@pytest.mark.asyncio
async def test_call_tool_does_not_overwrite_existing_workspace_id(monkeypatch) -> None:
    """If workspaceId is already in args (shouldn't happen, but be safe), don't overwrite."""
    captured: dict = {}

    async def fake_post(self, server, payload):
        captured['payload'] = payload
        return {'content': [{'type': 'text', 'text': 'ok'}]}

    monkeypatch.setattr(McpClient, '_post', fake_post)

    server = make_server(workspace_id='w1')
    client = McpClient()
    await client.call_tool(server, 'search_pages', {'query': 'q', 'workspaceId': 'already-set'})

    assert captured['payload']['params']['arguments']['workspaceId'] == 'already-set'


@pytest.mark.asyncio
async def test_call_tool_no_injection_when_workspace_id_absent(monkeypatch) -> None:
    """Without workspace_id on the server, args are passed through unchanged."""
    captured: dict = {}

    async def fake_post(self, server, payload):
        captured['payload'] = payload
        return {'content': [{'type': 'text', 'text': 'ok'}]}

    monkeypatch.setattr(McpClient, '_post', fake_post)

    server = make_server()
    client = McpClient()
    await client.call_tool(server, 'echo', {'x': 1})

    assert 'workspaceId' not in captured['payload']['params']['arguments']


def test_strip_auto_fields_removes_workspace_id() -> None:
    schema = {
        'type': 'object',
        'properties': {
            'workspaceId': {'type': 'string'},
            'query': {'type': 'string'},
        },
        'required': ['workspaceId', 'query'],
    }
    result = _strip_auto_fields(schema)
    assert 'workspaceId' not in result['properties']
    assert 'workspaceId' not in result['required']
    assert result['required'] == ['query']
    assert 'query' in result['properties']


def test_strip_auto_fields_handles_missing_workspace_id() -> None:
    schema = {
        'type': 'object',
        'properties': {'query': {'type': 'string'}},
        'required': ['query'],
    }
    result = _strip_auto_fields(schema)
    assert result == schema


def test_strip_auto_fields_handles_empty_schema() -> None:
    result = _strip_auto_fields({})
    assert result == {'properties': {}, 'required': []}
