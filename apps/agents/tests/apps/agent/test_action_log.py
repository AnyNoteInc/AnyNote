import pytest
import respx
from httpx import Response

from agents.apps.agent.repositories.action_log import ActionLogRepository


@pytest.mark.asyncio
@respx.mock
async def test_writes_log_entry():
    route = respx.post('https://web.test/api/agent/action-log').mock(
        return_value=Response(202, json={'ok': True})
    )
    repo = ActionLogRepository(web_base_url='https://web.test')
    await repo.write_batch(
        jwt='jwt-token',
        entries=[{
            'chatId': 'c1',
            'workspaceId': 'w1',
            'userId': 'u1',
            'toolName': 'anynote__createPage',
            'toolInput': {'title': 'X'},
            'toolOutput': {'id': 'p1'},
            'status': 'OK',
            'durationMs': 120,
        }],
    )
    assert route.called
    body = route.calls[0].request.content.decode()
    assert 'anynote__createPage' in body
    assert route.calls[0].request.headers['authorization'] == 'Bearer jwt-token'


@pytest.mark.asyncio
@respx.mock
async def test_failure_is_swallowed():
    respx.post('https://web.test/api/agent/action-log').mock(return_value=Response(500))
    repo = ActionLogRepository(web_base_url='https://web.test')
    # Should not raise — action logging is best-effort.
    await repo.write_batch(jwt='jwt', entries=[{}])
