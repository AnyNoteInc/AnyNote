from agents.apps.chat.router import serialize_server_event
from agents.apps.chat.schemas import ServerEvent
from sse_starlette.event import ensure_bytes


def test_serialize_server_event_wraps_payload_as_json_sse_data() -> None:
    encoded = ensure_bytes(serialize_server_event(ServerEvent.token('hello')), sep='\n').decode()

    assert encoded == 'data: {"type":"token","text":"hello"}\n\n'
